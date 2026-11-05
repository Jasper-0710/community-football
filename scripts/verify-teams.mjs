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
const out = 'artifacts/teams'
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
const owner = createTeamService({ store: memory.store, context: () => identity, logger: { error() {} } })
const archives = createAdminTeamService({ store: memory.adminStore, authorize: token => auth({ action: 'session', token }), logger: { error() {} } })
const adminBase = 'http://127.0.0.1:5186', userBase = 'http://127.0.0.1:5188'
const http = createHttpHandler(event => event.action?.startsWith('teams.') ? archives(event) : auth(event), [adminBase])
const server = createServer({ key: await readFile(join(certDir, 'key.pem')), cert: await readFile(join(certDir, 'cert.pem')) }, async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk
  if (req.url.startsWith('/wx/')) {
    if (req.headers.origin !== userBase) { res.writeHead(403); res.end(); return }
    res.setHeader('Access-Control-Allow-Origin', userBase)
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    res.setHeader('Content-Type', 'application/json')
    const fn = req.url === '/wx/userProfile' ? profile : owner
    res.end(JSON.stringify(await fn(JSON.parse(body))))
  } else {
    const result = await http({ httpMethod: req.method, headers: req.headers, body })
    res.writeHead(result.statusCode, result.headers); res.end(result.body)
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const endpoint = `https://127.0.0.1:${server.address().port}`
process.env.VITE_ADMIN_API_URL = endpoint + '/api'
const testConfig = resolve('.tools/d04-browser.vite.config.ts')
const transport = `export class WechatCloudError extends Error {}\nexport function initializeWechatCloud() {}\nexport async function callWechatCloudFunction(name,data) { const r=await fetch(${JSON.stringify(endpoint + '/wx/')}+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return r.json() }`
await writeFile(testConfig, `import {defineConfig} from 'vite';import uni from '@dcloudio/vite-plugin-uni';export default defineConfig({cacheDir:'.tools/d04-vite-cache',plugins:[{name:'isolated-d04-transport',enforce:'pre',transform(code,id){if(id.endsWith('/src/services/wechat-cloud.ts'))return ${JSON.stringify(transport)};if(id.endsWith('/src/services/user-profile.ts'))return code.replace(/export function supportsWechatProfile\\(\\): boolean \\{[\\s\\S]*?\\n\\}/,'export function supportsWechatProfile(): boolean { return true }')}},uni()],server:{host:'127.0.0.1',port:5188,strictPort:true,hmr:false}})`)
const vite = await createViteServer({ configFile: 'admin/vite.config.ts', mode: 'test', cacheDir: resolve('.tools/d04-admin-vite-cache'), server: { host: '127.0.0.1', port: 5186, strictPort: true, watch: { usePolling: true }, hmr: false } })
await vite.listen()
const userServer = spawn('node', ['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js', '--config', testConfig, '--host', '127.0.0.1', '--port', '5188'], { detached: true, env: { ...process.env, CHOKIDAR_USEPOLLING: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] })
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
  await addPlayer('张一', '7'); await roster().waitFor()
  await addPlayer('李二', '7'); await user.getByRole('alert').filter({ hasText: '号码已被' }).waitFor()
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
  await user.getByText('球员已移出当前名单。', { exact: true }).waitFor()
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
  await click('暂不解散');assert.equal(memory.read('teams',id).status,'active')
  check('linked teams cannot dissolve; wrong confirmation and cancellation preserve the team')
  await click('解散球队');await fill('dissolve-team-name',memory.read('teams',id).name)
  await user.setViewportSize({width:390,height:844});await noOverflow(user);await snapshot(user,'dissolve-390')
  await user.setViewportSize({width:320,height:800});await noOverflow(user);await snapshot(user,'dissolve-320')
  await click('确认解散球队');await user.getByText('创建我的球队',{exact:true}).waitFor()
  assert.equal(memory.read('teams',id).status,'dissolved');assert.equal(memory.read('users',uid).role,'user')
  await admin.getByRole('button',{name:'刷新档案',exact:true}).click();await admin.getByText('已解散',{exact:true}).waitFor()
  await admin.getByRole('button',{name:'查看球队与名单 →'}).click();await admin.locator('.admin-team-detail').waitFor()
  await admin.getByText('保留解散时的球员名单，供历史核对。',{exact:true}).waitFor();await snapshot(admin,'dissolved-admin')
  check('confirmed dissolution releases ownership and admin retains the final roster with archive status')
  await click('创建我的球队');await fill('team-name','重新创建的球队');await selectDefault('选择球队所属区');await fill('team-phone','021-55556666');await click('创建球队并成为领队');await user.locator('.owned-team-card').waitFor()
  assert.notEqual(memory.read('leaderTeamBindings',uid).teamId,id);assert.equal(memory.read('teams',id).status,'dissolved')
  check('leader can recreate a different team while the old archive remains intact')
  assert.deepEqual(errors, [])
  await writeFile(`${out}/report.json`, JSON.stringify({ checks, errors, validation: 'Real Vue pages and real userProfile/teamManagement/adminAuth handlers with isolated transactional memory storage and test-only transport replacement. Not native WeChat or cloud deployment evidence.', generatedAt: new Date().toISOString() }, null, 2))
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
