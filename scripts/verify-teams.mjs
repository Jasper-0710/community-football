import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:https'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { createServer as createViteServer } from 'vite'
import { chromium } from 'playwright'

// Only this isolated preview replaces the transport. Production keeps WeChat identity checks.
const require = createRequire(import.meta.url)
const { createAdminService, createAccount } = require('../cloudfunctions/adminAuth/service.js')
const { createHttpHandler } = require('../cloudfunctions/adminAuth/http.js')
const { createAdminTeamService } = require('../cloudfunctions/adminAuth/teams.js')
const { createUserProfileHandler } = require('../cloudfunctions/userProfile/service.js')
const { createTeamService, APP_ID, userId } = require('../cloudfunctions/teamManagement/service.js')
const { createMemoryStore } = require('../tests/helpers/admin-store.cjs')
const { createTeamMemory } = require('../tests/helpers/team-store.cjs')
const { createNewsImageStorage } = require('../tests/helpers/news-image-storage.cjs')
const { createTeamBadgeService } = require('../cloudfunctions/teamManagement/team-badges.js')
const { createTeamBadgeCleanup } = require('../cloudfunctions/adminAuth/team-badge-cleanup.js')
const { createContentService, PUBLIC_ACTIONS } = require('../cloudfunctions/adminAuth/content.js')
const { PNG } = require('pngjs')
const out = process.env.TEAM_BROWSER_ARTIFACTS || 'artifacts/teams'
await mkdir(out, { recursive: true }); await mkdir('.tools', { recursive: true })
const certDir = await mkdtemp(join(tmpdir(), 'football-d04-'))
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })
const password = randomBytes(24).toString('base64url')
const authMemory = createMemoryStore(await createAccount('admin', password, Date.now()))
const auth = createAdminService({ store: authMemory.store, logger: { error() {} } })
const memory = createTeamMemory()
const identity = { APPID: APP_ID, OPENID: 'isolated-d04-browser-leader' }
const profile = createUserProfileHandler({ cloud: { getWXContext: () => identity, database: memory.database }, logger: { error() {} } })
assert.equal((await profile({ action: 'getOrCreate' })).ok, true)
assert.equal((await profile({ action: 'update', profile: { nickname: '测试领队' } })).ok, true)
const files = createNewsImageStorage(), authorize = token => auth({ action: 'session', token })
let badgeTime = Date.now(), failChunk = false, loseSave = false, badgeEnabled = true
const badgeRequests = []
const badgeStore = {
  read: async (collection, id) => memory.read(collection, id), atomic: memory.store.transaction,
  scan: async collection => [...memory.records].filter(([key]) => key.startsWith(collection + '/')).map(([, value]) => structuredClone(value)),
  listBadges: async (cursor, limit) => [...memory.records].filter(([key, value]) => key.startsWith('teamBadges/') && (!cursor || value._id > cursor)).map(([, value]) => structuredClone(value)).sort((a,b) => a._id.localeCompare(b._id)).slice(0, limit),
}
const owner = event => createTeamService({ store: memory.store, storage: files.storage, badgeUploadEnabled: badgeEnabled, context: () => identity, logger: { error() {} } })(event)
const badges = createTeamBadgeService({ store: memory.store, storage: files.storage, context: () => identity, enabled: true, now: () => badgeTime, logger: { error() {} } })
const cleanup = createTeamBadgeCleanup({ store: badgeStore, storage: files.storage, authorize, now: () => badgeTime, logger: { error() {} } })
const content = createContentService({ store: badgeStore, storage: files.storage, authorize, logger: { error() {} } })
const archives = createAdminTeamService({ store: memory.adminStore, storage: files.storage, authorize, logger: { error() {} } })
const adminBase = 'http://127.0.0.1:5186', userBase = 'http://127.0.0.1:5188'
const http = createHttpHandler(event => event.action === 'teams.badges.cleanup' ? cleanup(event) : event.action?.startsWith('teams.') ? archives(event) : PUBLIC_ACTIONS.includes(event.action) ? content(event) : auth(event), [adminBase, userBase], PUBLIC_ACTIONS)
const server = createServer({ key: await readFile(join(certDir, 'key.pem')), cert: await readFile(join(certDir, 'cert.pem')) }, async (req, res) => {
  if (req.url?.startsWith('/badge?')) {
    const id = new URL(req.url, 'https://127.0.0.1').searchParams.get('id'), bytes = files.objects.get(id)
    res.writeHead(bytes ? 200 : 404, { 'Content-Type': id?.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-store' }); res.end(bytes); return
  }
  let body = ''; for await (const chunk of req) body += chunk
  if (req.url.startsWith('/wx/')) {
    if (req.headers.origin !== userBase) { res.writeHead(403); res.end(); return }
    res.setHeader('Access-Control-Allow-Origin', userBase)
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    res.setHeader('Content-Type', 'application/json')
    const event = JSON.parse(body), isBadge = event.action?.startsWith('badges.')
    if (isBadge) badgeRequests.push(structuredClone(event))
    const fn = req.url === '/wx/userProfile' ? profile : isBadge ? badges : owner
    const result = await fn(event)
    if (failChunk && event.action === 'badges.chunk' && event.index === 1) { failChunk = false; res.end(JSON.stringify({ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'模拟上传中断，请重试保存。'}})); return }
    if (loseSave && event.action === 'badges.save' && result.ok) { loseSave = false; res.end(JSON.stringify({ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'保存回执丢失，请重新读取球队确认。'}})); return }
    res.end(JSON.stringify(result))
  } else {
    const result = await http({ httpMethod: req.method, headers: req.headers, body })
    res.writeHead(result.statusCode, result.headers); res.end(result.body)
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const endpoint = `https://127.0.0.1:${server.address().port}`
files.storage.link = async id => {
  if (files.controls.linkFails || !files.objects.has(id)) throw new Error('Badge link unavailable')
  return `${endpoint}/badge?id=${encodeURIComponent(id)}&v=${++files.controls.version}`
}
process.env.VITE_ADMIN_API_URL = endpoint + '/api'
const testConfig = resolve('.tools/d04-browser.vite.config.ts')
const transport = `export class WechatCloudError extends Error {}\nexport function initializeWechatCloud() {}\nexport async function callWechatCloudFunction(name,data) { const r=await fetch(${JSON.stringify(endpoint + '/wx/')}+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return r.json() }`
// H5 cannot use the native WeChat filesystem/compressor. Only preparation is
// replaced: the real picker, upload/resume client, Vue UI and server all run.
const prepare = `export async function prepareTeamBadge(path:string):Promise<BadgeDraft>{return createBadgeDraft(new Uint8Array(await (await fetch(path)).arrayBuffer()),path)}`
await writeFile(testConfig, `import {defineConfig} from 'vite';import uni from '@dcloudio/vite-plugin-uni';export default defineConfig({cacheDir:'.tools/d04-vite-cache',plugins:[{name:'isolated-d04-transport',enforce:'pre',transform(code,id){if(id.endsWith('/src/services/wechat-cloud.ts'))return ${JSON.stringify(transport)};if(id.endsWith('/src/services/team-badges.ts'))return code.replace('export async function prepareTeamBadge(', 'async function nativePrepareTeamBadge(')+${JSON.stringify('\n' + prepare)};if(id.endsWith('/src/services/user-profile.ts'))return code.replace(/export function supportsWechatProfile\\(\\): boolean \\{[\\s\\S]*?\\n\\}/,'export function supportsWechatProfile(): boolean { return true }')}},uni()],server:{host:'127.0.0.1',port:5188,strictPort:true,hmr:false}})`)
const vite = await createViteServer({ configFile: 'admin/vite.config.ts', mode: 'test', cacheDir: resolve('.tools/d04-admin-vite-cache'), server: { host: '127.0.0.1', port: 5186, strictPort: true, watch: { usePolling: true }, hmr: false } })
await vite.listen()
const userServer = spawn('node', ['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js', '--config', testConfig, '--host', '127.0.0.1', '--port', '5188'], { detached: true, env: { ...process.env, VITE_COMPETITION_API_URL: endpoint + '/api', CHOKIDAR_USEPOLLING: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] })
let previewLog = ''; userServer.stdout.on('data', d => { previewLog += d }); userServer.stderr.on('data', d => { previewLog += d })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', ignoreHTTPSErrors: true })
context.setDefaultTimeout(12_000)
const admin = await context.newPage(), user = await context.newPage()
const errors = [], checks = []
for (const page of [admin, user]) page.on('pageerror', e => errors.push(e.message))
const check = name => { checks.push(name); console.log('PASS ' + name) }
const fill = async (id, value) => user.locator(`#${id} input, input#${id}, #${id} textarea, textarea#${id}`).fill(value)
const click = text => user.getByText(text, { exact: true }).click()
const selectDefault = async label => {
  await user.getByRole('button', { name: label, exact: true }).click()
  await user.locator('.uni-picker-action-confirm:visible, .uni-picker-select .uni-picker-item.selected:visible').first().click()
}
const roster = () => user.locator('.managed-player-row')
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
const snapshot = async (page, name) => { await page.bringToFront(); await page.screenshot({ path: `${out}/${name}.png`, fullPage: true, animations: 'disabled', timeout: 10_000 }) }
async function addPlayer(name, number) {
  await click('添加球员'); await fill('player-name', name); await fill('player-number', number); await selectDefault('选择球员位置'); await click('保存球员')
}
async function chooseBadge(bytes) {
  const chooser = user.waitForEvent('filechooser')
  await user.locator('.team-badge-editor').getByText(/^(选择|更换)队徽$/).click()
  await (await chooser).setFiles({name:'team-badge.png',mimeType:'image/png',buffer:bytes})
  await user.locator('.team-badge-editor').getByText('已选择新队徽', {exact:true}).waitFor()
}
async function savedBadge() {
  await user.locator('.team-message.success').filter({hasText:'球队队徽已重新读取。'}).waitFor()
  await user.locator('.team-badge-editor').getByText('当前球队队徽', {exact:true}).waitFor()
}
const badgeBytes = PNG.sync.write({width:130,height:130,data:randomBytes(130*130*4)})
try {
  const deadline = Date.now() + 30_000
  while (true) {
    if (userServer.exitCode !== null) throw new Error('Test preview exited: ' + previewLog.slice(-3000))
    try { if ((await fetch(userBase, { signal: AbortSignal.timeout(1000) })).ok) break } catch {}
    if (Date.now() > deadline) throw new Error('Test preview did not start: ' + previewLog.slice(-3000))
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  await admin.goto(adminBase, { waitUntil: 'networkidle' })
  await admin.getByLabel('管理员账号', { exact: true }).fill('admin'); await admin.getByLabel('登录密码', { exact: true }).fill(password)
  await admin.getByRole('button', { name: '登录管理后台' }).click(); await admin.locator('.workspace').waitFor()
  await admin.getByRole('button', { name: '球队档案', exact: true }).click(); await admin.getByText('暂时还没有球队', { exact: true }).waitFor()
  await user.goto(userBase + '/#/pages/team/manage', { waitUntil: 'networkidle' })
  await user.getByText('登录后，管理你的球队', { exact: true }).waitFor(); await click('微信登录')
  await click('创建我的球队'); await click('创建球队并成为领队')
  await user.getByRole('alert').filter({ hasText: '请填写队名' }).waitFor()
  assert.equal([...memory.records.keys()].filter(k => k.startsWith('teams/')).length, 0)
  check('guest login and required-field validation prevent an empty team')
  await fill('team-name', '上海社区联调足球队'); await selectDefault('选择球队所属区')
  await fill('team-description', '每周相聚绿茵场\n团结、友谊、热爱'); await fill('team-phone', '021-55556666')
  await user.setViewportSize({ width: 390, height: 844 }); await noOverflow(user); await snapshot(user, 'create-390')
  await click('创建球队并成为领队'); await user.locator('.owned-team-card').waitFor()
  const uid = userId(APP_ID, identity.OPENID), id = memory.read('leaderTeamBindings', uid).teamId
  assert.equal(memory.read('users', uid).role, 'leader')
  await user.reload({ waitUntil: 'networkidle' }); await user.locator('.owned-team-card').waitFor()
  assert.equal(await user.getByText('创建我的球队', { exact: true }).count(), 0)
  assert.equal([...memory.records.keys()].filter(k => k.startsWith('teams/')).length, 1)
  check('create grants leader role and returning to the page restores exactly one team')
  badgeEnabled=false;await click('重新读取')
  await user.locator('.team-badge-editor').getByText(/当前环境尚未开放队徽上传/).waitFor()
  assert.equal(await user.getByText('选择队徽',{exact:true}).getAttribute('disabled'),'true')
  assert.equal(badgeRequests.length,0)
  badgeEnabled=true;await click('重新读取')
  await user.getByText('选择队徽',{exact:true}).waitFor()
  assert.notEqual(await user.getByText('选择队徽',{exact:true}).getAttribute('disabled'),'true')
  check('badge entry remains visible with a disabled picker and clear explanation while uploads are unavailable')
  await chooseBadge(badgeBytes)
  assert.equal(badgeRequests.length, 0)
  assert.equal(await user.getByText('编辑球队资料', {exact:true}).getAttribute('disabled'), 'true')
  await snapshot(user, 'badge-preview-390')
  await click('取消本次修改')
  assert.equal(memory.read('teams',id).badgeFileId, '')
  assert.equal(badgeRequests.length, 0)
  check('badge selection previews locally and cancel preserves the default without creating cloud objects')
  await chooseBadge(badgeBytes); await click('保存队徽'); await savedBadge()
  const firstBadge = memory.read('teams',id).badgeId
  assert.ok(firstBadge)
  assert.equal(badgeRequests.filter(r=>r.action==='badges.chunk').length,2)
  await user.reload({waitUntil:'networkidle'}); await user.locator('.team-badge-editor').getByText('当前球队队徽',{exact:true}).waitFor()
  await user.waitForFunction(()=>!!document.querySelector('.owned-team-card image img, .owned-team-card uni-image img')?.naturalWidth)
  await admin.getByRole('button',{name:'刷新档案',exact:true}).click(); await admin.locator('.admin-team-card img').waitFor()
  await admin.waitForFunction(()=>!!document.querySelector('.admin-team-card img')?.naturalWidth)
  check('multi-part badge upload saves once and persists after reload in both owner and admin views')
  const publicPage = await context.newPage()
  publicPage.on('pageerror',e=>errors.push(e.message))
  const competitionId='c_'+'1'.repeat(32)
  memory.seed('competitions',competitionId,{displayEnabled:true});memory.seed('registrations','public-badge',{competitionId,teamId:id,status:'approved'})
  await publicPage.goto(userBase+'/#/pages/team/detail?id='+id)
  await publicPage.locator('.public-team-profile .page-title').waitFor()
  await publicPage.waitForFunction(()=>!!document.querySelector('.public-team-heading image img, .public-team-heading uni-image img')?.naturalWidth)
  assert.equal(JSON.stringify((await content({action:'directory.teamPublic',id})).team).includes('badgeFileId'),false)
  memory.records.delete('registrations/public-badge')
  check('approved public team profile displays the same badge without exposing storage references or contact data')
  files.controls.linkFails=true
  await click('重新读取'); await user.getByText('重新读取队徽',{exact:true}).waitFor()
  assert.equal(await user.locator('.owned-team-card').count(),1)
  files.controls.linkFails=false;await click('重新读取队徽');await savedBadge()
  check('temporary signing failure preserves team data and the saved badge recovers on explicit refresh')
  await chooseBadge(badgeBytes);failChunk=true;await click('保存队徽')
  await user.getByRole('alert').filter({hasText:'模拟上传中断'}).waitFor()
  assert.equal(memory.read('teams',id).badgeId,firstBadge)
  const beforeRetry=badgeRequests.filter(r=>r.action==='badges.chunk').length
  await click('重试保存队徽');await savedBadge()
  assert.equal(badgeRequests.filter(r=>r.action==='badges.chunk').length,beforeRetry)
  const replacementBadge=memory.read('teams',id).badgeId
  assert.notEqual(replacementBadge,firstBadge)
  check('interrupted replacement preserves the old badge and retries only work not already acknowledged by the server')
  await chooseBadge(badgeBytes);loseSave=true;await click('保存队徽')
  await user.getByRole('alert').filter({hasText:'保存回执丢失'}).waitFor()
  const committedBadge=memory.read('teams',id).badgeId
  assert.notEqual(committedBadge,replacementBadge)
  assert.equal(await user.getByText('重试保存队徽',{exact:true}).count(),0)
  await click('重新读取队徽');await savedBadge();assert.equal(memory.read('teams',id).badgeId,committedBadge)
  check('lost successful save response requires a fresh read and recovers the committed badge without duplicate team creation')
  await click('恢复默认队徽');await click('取消本次修改');assert.equal(memory.read('teams',id).badgeId,committedBadge)
  await click('恢复默认队徽');await click('保存队徽');await user.locator('.team-badge-editor').getByText('使用默认队徽',{exact:true}).waitFor()
  assert.equal(memory.read('teams',id).badgeFileId,'')
  await chooseBadge(badgeBytes);await click('保存队徽');await savedBadge()
  check('restore-default cancellation retains the badge; confirmed removal and a later fresh upload both work')
  await publicPage.close()
  await click('添加球员'); await click('保存球员')
  const editor=user.locator('.team-player-editor')
  await editor.getByRole('alert').filter({hasText:'请填写球员姓名'}).waitFor()
  await editor.getByRole('alert').filter({hasText:'1–99'}).waitFor()
  await editor.getByRole('alert').filter({hasText:'请选择球员位置'}).waitFor()
  assert.equal(memory.read('teams',id).roster.length,0)
  await fill('player-name','测试无效号码');await fill('player-number','0');await selectDefault('选择球员位置');await click('保存球员')
  assert.equal(await editor.getByRole('alert').count(),1)
  const numberError=editor.getByRole('alert').filter({hasText:'1–99'})
  await editor.locator('.team-save-button').scrollIntoViewIfNeeded()
  assert.equal(await numberError.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}),true)
  await snapshot(user,'invalid-player-390')
  await editor.locator('.text-button').filter({hasText:'取消'}).click()
  check('empty player fields and zero number show specific inline errors next to the form without writing a player')
  await addPlayer('张一', '7'); await roster().waitFor()
  await addPlayer('李二', '7'); await editor.getByRole('alert').filter({ hasText: '号码已被' }).waitFor()
  await snapshot(user,'duplicate-player-390')
  assert.equal(memory.read('teams', id).roster.length, 1)
  await fill('player-number', '9'); await click('保存球员'); await user.locator('.team-player-editor').waitFor({ state: 'detached' })
  assert.equal(await roster().count(), 2)
  await roster().filter({ hasText: '张一' }).getByText('编辑', { exact: true }).click(); await fill('player-name', '张一更新'); await fill('player-number', '10'); await click('保存球员')
  await user.getByText('张一更新', { exact: true }).waitFor()
  assert.deepEqual(memory.read('teams', id).roster.map(p => p.number).sort((a,b)=>a-b), [9,10])
  check('add and edit players persist real roster changes; duplicate numbers remain editable after rejection')
  await click('编辑球队资料'); await fill('team-name', '上海社区足球队·已更新'); await fill('team-phone', '+86 13800000000'); await click('保存球队资料')
  await user.getByText('上海社区足球队·已更新', { exact: true }).waitFor()
  assert.equal(memory.read('users', uid).phone, '+86 13800000000')
  await admin.getByRole('button', { name: '刷新档案', exact: true }).click(); await admin.locator('.admin-team-card').waitFor()
  await admin.getByRole('button', { name: '查看球队与名单 →', exact: true }).click(); await admin.locator('.admin-team-detail').waitFor()
  assert.match(await admin.locator('.admin-team-detail').innerText(), /上海社区足球队·已更新/)
  assert.match(await admin.locator('.admin-team-detail').innerText(), /\+86 13800000000/)
  assert.match(await admin.locator('.admin-roster').innerText(), /张一更新/)
  await snapshot(admin, 'admin-desktop')
  check('admin archive reads owner updates, contact details and the current roster from the same store')
  for (const width of [390, 320]) {
    await user.setViewportSize({ width, height: 844 }); await admin.setViewportSize({ width, height: 844 })
    await noOverflow(user); await noOverflow(admin); await snapshot(user, `team-${width}`); await snapshot(admin, `admin-${width}`)
    await click('编辑球队资料'); await noOverflow(user); await snapshot(user, `edit-${width}`); await user.locator('.team-edit-panel').locator('.text-button').filter({ hasText: '取消' }).click()
    await click('添加球员'); await noOverflow(user); await snapshot(user, `player-${width}`); await user.locator('.team-player-editor').locator('.text-button').filter({ hasText: '取消' }).click()
    const small = await user.locator('.manage-team-page').evaluate(el => [...el.querySelectorAll('*')].filter(e=>e.textContent.trim()&&e.children.length===0&&getComputedStyle(e).display!=='none'&&parseFloat(getComputedStyle(e).fontSize)<14).map(e=>e.textContent))
    assert.deepEqual(small, [])
    check(`${width}px team forms, roster and admin archive remain readable without page overflow`)
  }
  await roster().filter({ hasText: '李二' }).getByText('移出', { exact: true }).click(); await user.locator('.uni-modal__btn').filter({ hasText: /^取消$/ }).click()
  assert.equal(memory.read('teams', id).roster.length, 2)
  await roster().filter({ hasText: '李二' }).getByText('移出', { exact: true }).click(); await user.locator('.uni-modal__btn').getByText('移出名单', { exact: true }).click()
  await user.locator('.team-message.success').filter({hasText:'球员已移出当前名单。'}).waitFor()
  assert.equal(await roster().count(), 1)
  assert.equal([...memory.records.values()].filter(p=>p.status==='removed').length, 1)
  await admin.getByRole('button', { name: '刷新档案', exact: true }).click(); await admin.locator('.admin-team-detail').waitFor()
  assert.doesNotMatch(await admin.locator('.admin-roster').innerText(), /李二/)
  check('cancel removal preserves the roster; confirmed removal archives the player and updates admin view')
  await click('编辑球队资料'); await fill('team-name', '不应覆盖的过期资料')
  memory.records.get('teams/' + id).version++
  await click('保存球队资料'); await user.getByRole('alert').filter({ hasText: '其他页面更新' }).waitFor()
  assert.notEqual(memory.read('teams', id).name, '不应覆盖的过期资料')
  await click('重新读取球队'); await user.locator('.owned-team-card').waitFor()
  check('stale writes show a conflict and require a fresh read before continuing')
  memory.failures.read = true; await click('重新读取'); await user.getByText('暂时无法读取球队', { exact: true }).waitFor()
  assert.equal(await user.locator('.owned-team-card').count(), 0)
  await admin.getByRole('button', { name: '刷新档案', exact: true }).click(); await admin.getByRole('alert').waitFor()
  assert.equal(await admin.locator('.admin-team-detail').count(), 0)
  memory.failures.read = false; await click('重新加载球队'); await user.locator('.owned-team-card').waitFor()
  await admin.getByRole('button', { name: '刷新档案', exact: true }).click(); await admin.locator('.admin-team-card').waitFor()
  check('read failures hide stale private details and both views recover after retry')
  memory.seed('registrations','linked',{teamId:id})
  await click('解散球队');await user.getByRole('alert').filter({hasText:'关联报名'}).waitFor()
  assert.equal(await user.locator('.team-dissolve-confirm').count(),0)
  memory.records.delete('registrations/linked')
  await click('解散球队');await user.locator('.team-dissolve-confirm').waitFor()
  await fill('dissolve-team-name','错误队名')
  assert.equal(await user.getByText('确认解散球队',{exact:true}).getAttribute('disabled'),'true')
  await user.locator('.team-confirm-hint').filter({hasText:'尚未匹配'}).waitFor()
  await click('暂不解散');assert.equal(memory.read('teams',id).status,'active')
  check('linked teams cannot dissolve; wrong confirmation and cancellation preserve the team')
  await click('解散球队')
  const confirmation=user.locator('#dissolve-team-name input, input#dissolve-team-name')
  await fill('dissolve-team-name',memory.read('teams',id).name.replace('·','.'))
  assert.equal(await user.getByText('确认解散球队',{exact:true}).getAttribute('disabled'),'true')
  await fill('dissolve-team-name',' '+memory.read('teams',id).name+'　')
  await user.locator('.team-confirm-hint.matched').waitFor()
  assert.notEqual(await user.getByText('确认解散球队',{exact:true}).getAttribute('disabled'),'true')
  await confirmation.blur()
  await user.locator('.team-confirm-hint.matched').waitFor()
  check('confirmation reports exact punctuation mismatches and accepts outer whitespace without weakening the server name check')
  await user.setViewportSize({width:390,height:844});await noOverflow(user);await snapshot(user,'dissolve-390')
  await user.setViewportSize({width:320,height:800});await noOverflow(user);await snapshot(user,'dissolve-320')
  await click('确认解散球队');await user.getByText('创建我的球队',{exact:true}).waitFor()
  assert.equal(memory.read('teams',id).status,'dissolved');assert.equal(memory.read('users',uid).role,'user')
  await admin.getByRole('button',{name:'刷新档案',exact:true}).click();await admin.getByText('已解散',{exact:true}).waitFor()
  await admin.getByRole('button',{name:'查看球队与名单 →'}).click();await admin.locator('.admin-team-detail').waitFor()
  await admin.getByText('保留解散时的球员名单，供历史核对。',{exact:true}).waitFor();await snapshot(admin,'dissolved-admin')
  check('confirmed dissolution releases ownership and admin retains the final roster with archive status')
  const archivedFile=memory.read('teams',id).badgeFileId
  assert.ok(archivedFile)
  await admin.locator('.admin-team-detail img').waitFor()
  badgeTime+=25*3600000
  await admin.getByRole('button',{name:'← 返回球队列表',exact:true}).click()
  await admin.getByText('队徽存储维护',{exact:true}).click()
  await admin.getByRole('button',{name:'检查待清理队徽',exact:true}).click()
  await admin.getByRole('button',{name:'清理本批队徽',exact:true}).waitFor()
  const objectsBefore=files.objects.size
  await admin.getByRole('button',{name:'清理本批队徽',exact:true}).click()
  await admin.locator('.team-badge-maintenance').getByRole('status').filter({hasText:/已清理[1-9]/}).waitFor()
  assert.ok(files.objects.size<objectsBefore);assert.equal(files.objects.has(archivedFile),true)
  check('admin cleanup previews before deletion, removes expired replacements and keeps the dissolved archive badge')
  await click('创建我的球队');await fill('team-name','重新创建的球队');await selectDefault('选择球队所属区');await fill('team-phone','021-55556666');await click('创建球队并成为领队');await user.locator('.owned-team-card').waitFor()
  assert.notEqual(memory.read('leaderTeamBindings',uid).teamId,id);assert.equal(memory.read('teams',id).status,'dissolved')
  check('leader can recreate a different team while the old archive remains intact')
  assert.deepEqual(errors, [])
  await writeFile(`${out}/report.json`, JSON.stringify({ checks, errors, validation: 'Real Vue pages and real userProfile/teamManagement/adminAuth handlers with isolated transactional memory and byte storage. Test-only transport and H5 image preparation replacement; native WeChat compression/filesystem and customer cloud are not verified here.', generatedAt: new Date().toISOString() }, null, 2))
  console.log(`Verified ${checks.length} team browser flows.`)
} catch (error) {
  await snapshot(user, 'failure-user').catch(()=>{}); await snapshot(admin, 'failure-admin').catch(()=>{})
  await writeFile(`${out}/failure.txt`, await user.locator('body').innerText() + '\nADMIN\n' + await admin.locator('body').innerText())
  throw error
} finally {
  await browser.close(); await vite.close()
  try { process.kill(-userServer.pid, 'SIGTERM') } catch {}
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  await rm(testConfig, { force: true }); await rm(certDir, { recursive: true, force: true })
}
