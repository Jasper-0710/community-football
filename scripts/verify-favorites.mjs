import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:https'
import { execFileSync, spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const require = createRequire(import.meta.url)
const { createFavoritesHandler } = require('../cloudfunctions/userProfile/favorites.js')
const { createUserProfileHandler, DEFAULT_APP_ID, userId } = require('../cloudfunctions/userProfile/service.js')
const { createFavoritesMemoryStore } = require('../tests/helpers/favorites-store.cjs')
const { createContentService } = require('../cloudfunctions/adminAuth/content.js')
const { createSettingsService } = require('../cloudfunctions/adminAuth/platform-settings.js')
const { createCompetitionService } = require('../cloudfunctions/adminAuth/competitions.js')
const memory = createFavoritesMemoryStore(), { store, collections, database, favoritesStore } = memory
const now = Date.parse('2026-11-18T04:00:00Z'), cid = 'c_' + '1'.repeat(32), home = 't_' + '1'.repeat(64), away = 't_' + '2'.repeat(64)
collections.competitions.set(cid, { _id: cid, name: '收藏验证社区杯', description: '隔离测试数据', format: 'round_robin', formatDescription: '单循环', startDate: '2026-11-20', endDate: '2026-12-31', venue: '社区球场', registrationRequirements: '提交材料', registrationStartAt: null, registrationEndAt: null, registrationEnabled: false, displayEnabled: true, version: 1, createdAt: now, updatedAt: now })
for (const [id, name] of [[home, '邻里联队'], [away, '社区星火']]) {
  collections.teams.set(id, { _id: id, name, district: '浦东新区', description: '公开参赛球队', status: 'active', roster: [] })
  collections.registrations.set(id, { _id: id, competitionId: cid, teamId: id, status: 'approved' })
}
const authorize = async () => ({ ok: false }), logger = { error() {} }
const content = createContentService({ store, authorize, logger }), settings = createSettingsService({ store, authorize, logger })
const competitions = createCompetitionService({ store: { async list() { return [...collections.competitions.values()] }, read: id => store.read('competitions', id) }, authorize, now: () => now, logger })
const origin = 'http://127.0.0.1:5195', out = 'artifacts/favorites'
await fs.mkdir(out, { recursive: true }); await fs.mkdir('.tools', { recursive: true })
const certDir = await fs.mkdtemp('/tmp/community-football-favorites-')
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${certDir}/key.pem`, '-out', `${certDir}/cert.pem`, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })
let loseNextAck = false, delayNextSet = false, failReads = false, setRequests = 0
const https = createServer({ key: await fs.readFile(`${certDir}/key.pem`), cert: await fs.readFile(`${certDir}/cert.pem`) }, async (req, res) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
  if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return }
  try {
    let body = ''; for await (const chunk of req) body += chunk
    const input = JSON.parse(body)
    let result
    if (input.functionName === 'userProfile') {
      const context = () => ({ OPENID: input.testIdentity, APPID: DEFAULT_APP_ID })
      const favorites = createFavoritesHandler({ store: favoritesStore, context, logger })
      const profile = createUserProfileHandler({ cloud: { database: () => database, getWXContext: context }, logger })
      if (input.data.action === 'favorites.get' && failReads) result = { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '收藏读取失败，请重新同步。' } }
      else {
        if (input.data.action === 'favorites.set') { setRequests++; if (delayNextSet) { delayNextSet = false; await new Promise(r => setTimeout(r, 350)) } }
        result = await (input.data.action.startsWith('favorites.') ? favorites(input.data) : profile(input.data))
        if (input.data.action === 'favorites.set' && loseNextAck) { loseNextAck = false; res.writeHead(200, headers); res.end('{"ok":'); return }
      }
    } else result = input.action.startsWith('settings.') ? await settings(input) : input.action.startsWith('competitions.') ? await competitions(input) : await content(input)
    res.writeHead(200, headers); res.end(JSON.stringify(result))
  } catch { res.writeHead(500, headers); res.end(JSON.stringify({ ok: false, error: { code: 'TEST_FAILURE', message: 'Test bridge failed' } })) }
})
await new Promise(r => https.listen(0, '127.0.0.1', r))
const endpoint = `https://127.0.0.1:${https.address().port}/api`
const config = resolve('.tools/favorites.vite.config.ts')
// Test-only SDK boundary. The browser executes the real Vue UI, services and cloud
// handlers. No authentication bypass or bridge is included in a production build.
await fs.writeFile(config, `import base from '../vite.config';
export default env => ({ ...base(env), cacheDir: '.tools/favorites-vite-cache', plugins: [{name:'favorites-test-sdk',enforce:'pre',transform(source,id){
 if(id.endsWith('/src/services/user-profile.ts'))return source.replace(/export function supportsWechatProfile\\(\\): boolean \\{[\\s\\S]*?\\n\\}/,'export function supportsWechatProfile(): boolean { return true }');
 if(id.endsWith('/src/services/wechat-cloud.ts'))return ${JSON.stringify(`export class WechatCloudError extends Error { constructor(public code:string,message:string){super(message)} } export function initializeWechatCloud(){} export async function callWechatCloudFunction(functionName:string,data:any){ const response=await fetch(${JSON.stringify(endpoint)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({functionName,data,testIdentity:localStorage.getItem('__test_wechat')||'alice'})}); return response.json() }`)};
}},...base(env).plugins],server:{host:'127.0.0.1',port:5195,strictPort:true,hmr:false} });\n`)
const vite = spawn('node', ['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js', '--config', config, '--host', '127.0.0.1', '--port', '5195'], { detached: true, env: { ...process.env, VITE_COMPETITION_API_URL: endpoint, CHOKIDAR_USEPOLLING: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''; for (const stream of [vite.stdout, vite.stderr]) stream.on('data', b => { log += b })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const contexts = await Promise.all([0, 1].map(() => browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', ignoreHTTPSErrors: true })))
const [first, second] = await Promise.all(contexts.map(c => c.newPage())), checks = [], errors = []
for (const page of [first, second]) { page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message)) }
const check = name => { checks.push(name); console.log(`PASS ${name}`) }
let visit = 0
const hasIntent = page => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('community-football:wechat-login-intent') || 'null')?.data === true } catch { return false } })
const profile = async page => {
  await page.goto(`${origin}/?testVisit=${++visit}#/pages/index/index?tab=profile`); await page.locator('.favorites-panel').waitFor()
  if (await hasIntent(page)) await page.getByText('已同步当前账号的云端收藏', { exact: true }).waitFor()
}
const login = async page => { await page.locator('.login-button').click(); await page.locator('.favorites-sync-bar').getByText('已同步当前账号的云端收藏', { exact: true }).waitFor() }
const openTeam = async (page, id = home) => {
  await page.goto(`${origin}/?testVisit=${++visit}#/pages/team/detail?id=${id}`); await page.locator('#public-team-follow').waitFor()
  if (await hasIntent(page)) await page.getByText('收藏随当前微信账号保存，可在其他设备恢复', { exact: true }).waitFor()
  await page.waitForFunction(() => !document.querySelector('#public-team-follow')?.hasAttribute('disabled'))
}
const row = (page, id) => page.locator(`[data-favorite-id="${id}"]`)
const cloudIds = (openId = 'alice') => collections.users.get(userId(DEFAULT_APP_ID, openId))?.favorites?.teamIds || []
try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(origin)).ok) break } catch {} await new Promise(r => setTimeout(r, 250)); if (i === 119) throw new Error(log) }
  await profile(first)
  await first.getByRole('button', { name: '发现球队', exact: true }).click(); await first.locator('.public-team-finder').waitFor()
  await first.locator('.team-finder-search input').fill('邻里'); await first.locator('.public-team-result').waitFor(); await first.locator('.public-team-result').click()
  await first.locator('#public-team-follow').waitFor(); await first.locator('#public-team-follow').click(); await first.getByText('已保存在本机游客收藏。', { exact: true }).waitFor()
  assert.deepEqual(cloudIds(), []); await profile(first); await row(first, home).waitFor()
  await first.reload(); await row(first, home).waitFor(); check('个人中心发现入口可达，真实球队游客关注仅保存本机并可刷新恢复')

  await login(first); assert.equal(await row(first, home).count(), 0); await first.locator('.guest-favorites-merge').waitFor(); assert.deepEqual(cloudIds(), [])
  await first.locator('#favorites-merge').click(); await first.getByText('游客收藏已合并到当前账号。', { exact: true }).waitFor(); await row(first, home).waitFor()
  assert.deepEqual(cloudIds(), [home]); assert.equal(await first.locator('.guest-favorites-merge').count(), 0)
  check('登录不自动搬运游客记录，显式合并云端成功后才清理游客收藏')

  await profile(second); await login(second); await row(second, home).waitFor(); check('独立浏览器上下文以同一身份重新登录可恢复云端收藏')
  await openTeam(first, away); delayNextSet = true; const before = setRequests; await first.locator('#public-team-follow').click()
  await first.locator('#public-team-follow[disabled]').waitFor(); await first.getByText('已关注，收藏已保存到云端。', { exact: true }).waitFor(); assert.equal(setRequests, before + 1)
  await second.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await row(second, away).waitFor()
  check('真实球队主页云端关注、保存中禁用和另一设备回前台同步正常')

  await profile(first); await row(first, away).waitFor()
  await row(second, home).getByRole('button', { name: '取消关注 邻里联队', exact: true }).click(); await row(second, home).waitFor({ state: 'detached' })
  await row(first, away).getByRole('button', { name: '取消关注 社区星火', exact: true }).click(); await first.getByText('收藏已在其他设备更新，请重新同步后操作。', { exact: true }).waitFor()
  assert.deepEqual(cloudIds(), [away]); await first.getByRole('button', { name: '重新同步收藏', exact: true }).click(); await row(first, home).waitFor({ state: 'detached' })
  await row(first, away).getByRole('button', { name: '取消关注 社区星火', exact: true }).click(); await row(first, away).waitFor({ state: 'detached' }); assert.deepEqual(cloudIds(), [])
  check('多设备版本冲突阻止覆盖，重新同步后可正常取消关注')

  await openTeam(first); loseNextAck = true; await first.locator('#public-team-follow').click(); await first.locator('.public-team-follow [role="alert"]').waitFor()
  assert.deepEqual(cloudIds(), [home]); await first.locator('#public-team-follow[disabled]').waitFor()
  await first.getByRole('button', { name: '重新同步收藏', exact: true }).click(); await first.locator('#public-team-follow[aria-pressed="true"]').waitFor()
  check('保存响应中断不显示虚假成功，重新读取可确认已提交的真实结果')

  await profile(first); failReads = true; await first.getByRole('button', { name: '重新同步收藏', exact: true }).click(); await first.getByText('收藏读取失败，请重新同步。', { exact: true }).waitFor()
  assert.equal(await row(first, home).count(), 1); failReads = false; await first.getByRole('button', { name: '重新同步收藏', exact: true }).click(); await first.getByText('已同步当前账号的云端收藏', { exact: true }).waitFor()
  check('同步失败保留上次确认的列表并显示失败，重试恢复')

  collections.competitions.get(cid).displayEnabled = false
  await first.getByRole('button', { name: '重新同步收藏', exact: true }).click(); await row(first, home).getByText('球队暂不可用', { exact: true }).waitFor()
  assert.notEqual(await row(first, home).locator('.favorite-team-link').getAttribute('disabled'), null)
  await row(first, home).getByRole('button', { name: '取消关注 不可用球队', exact: true }).click(); await row(first, home).waitFor({ state: 'detached' }); assert.deepEqual(cloudIds(), [])
  collections.competitions.get(cid).displayEnabled = true; check('赛事隐藏后收藏不泄露原球队资料，不可用记录仍可取消')

  await openTeam(first); await first.locator('#public-team-follow').click(); await first.getByText('已关注，收藏已保存到云端。', { exact: true }).waitFor()
  await profile(first); await first.locator('.sign-out-button').click(); assert.equal(await row(first, home).count(), 0)
  await first.evaluate(() => localStorage.setItem('__test_wechat', 'bob')); await login(first); assert.equal(await row(first, home).count(), 0); assert.deepEqual(cloudIds('bob'), [])
  await first.locator('.sign-out-button').click(); await first.evaluate(() => localStorage.setItem('__test_wechat', 'alice')); await login(first); await row(first, home).waitFor()
  check('退出立即隐藏账号列表，第二身份为空，重新登录原身份恢复收藏')

  for (const width of [1440, 390, 320]) {
    await first.setViewportSize({ width, height: 1000 }); assert.equal(await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    await first.locator('.favorites-panel .follow-button').scrollIntoViewIfNeeded()
    await first.screenshot({ path: `${out}/profile-${width}.png`, fullPage: true })
    await first.locator('.favorites-panel').screenshot({ path: `${out}/favorites-${width}.png` })
  }
  await row(first, home).getByRole('button', { name: '取消关注 邻里联队', exact: true }).click(); await row(first, home).waitFor({ state: 'detached' }); assert.deepEqual(cloudIds(), [])
  await openTeam(first)
  for (const width of [390, 320]) { await first.setViewportSize({ width, height: 1000 }); assert.equal(await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await first.screenshot({ path: `${out}/team-${width}.png`, fullPage: true }) }
  await profile(first); await first.getByRole('button', { name: '发现球队', exact: true }).click(); await first.locator('.team-finder-search input').fill('邻里'); await first.locator('.public-team-result').waitFor()
  await first.locator('.public-team-finder').screenshot({ path: `${out}/finder-320.png` }); assert.equal(await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  check('个人中心与球队关注入口在1440/390/320px布局无横向溢出')
  assert.deepEqual(errors, [])
  await fs.writeFile(`${out}/report.json`, JSON.stringify({ date: '2026-11-18', generatedAt: new Date().toISOString(), checks, errors, scope: 'Real Vue UI and cloud handlers, test-only SDK identity bridge and isolated transactional stores; not customer-cloud, native WeChat, physical-device or actual second-account acceptance.' }, null, 2))
  console.log(`Verified ${checks.length} favorites browser flows.`)
} catch (failure) {
  console.error(failure)
  await fs.writeFile(`${out}/failure.txt`, `FIRST\n${await first.locator('body').innerText().catch(() => '')}\nSECOND\n${await second.locator('body').innerText().catch(() => '')}\nERRORS\n${JSON.stringify(errors)}\nLOG\n${log}`)
  throw failure
} finally {
  await browser.close(); try { process.kill(-vite.pid, 'SIGTERM') } catch {}
  https.closeAllConnections(); https.close(); await fs.rm(certDir, { recursive: true, force: true })
}
