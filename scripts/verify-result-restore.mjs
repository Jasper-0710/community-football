import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:https'
import { execFileSync, spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { createServer as createViteServer } from 'vite'
import { chromium } from 'playwright'
const require = createRequire(import.meta.url)
const { createResultRestoreFixture } = require('../tests/helpers/result-restore-fixture.cjs')
const { createAdminService, createAccount } = require('../cloudfunctions/adminAuth/service')
const { createMemoryStore } = require('../tests/helpers/admin-store.cjs')
const { createContentMemoryStore } = require('../tests/helpers/content-store.cjs')
const { createCompetitionService } = require('../cloudfunctions/adminAuth/competitions')
const { createAdminTeamService } = require('../cloudfunctions/adminAuth/teams')
const { createAdminRegistrationService } = require('../cloudfunctions/adminAuth/registrations')
const { createSettingsService } = require('../cloudfunctions/adminAuth/platform-settings')
const { createHttpHandler } = require('../cloudfunctions/adminAuth/http')
const out = 'artifacts/result-restore', adminOrigin = 'http://127.0.0.1:5213', publicOrigin = 'http://127.0.0.1:5214'
await fs.mkdir(out, { recursive: true }); await fs.mkdir('.tools', { recursive: true })
const password = randomBytes(24).toString('base64url'), authMemory = createMemoryStore(await createAccount('admin', password, Date.now()))
const auth = createAdminService({ store: authMemory.store, logger: { error() {} } })
const f = createResultRestoreFixture({ authorize: token => auth({ action: 'session', token }) }), { cid, tid, pid } = f
const copy = value => value == null ? value : structuredClone(value)
const competitions = createCompetitionService({ authorize: f.authorize, store: { read: async id => copy(f.competitions.get(id)), async list() { return [...f.competitions.values()].map(copy) } } })
const teams = createAdminTeamService({ authorize: f.authorize, store: { async list() { return [...f.teams.values()].map(copy) }, async read(id) { return copy(f.teams.get(id)) }, async user() { return { nickname: '模拟领队' } } } })
const registrations = createAdminRegistrationService({ authorize: f.authorize, store: { competition: f.store.competition, async list() { return [...f.registrations.values()].map(copy) } } })
const settings = createSettingsService({ authorize: f.authorize, store: createContentMemoryStore().store })
const id = await f.create(), b = await f.create(3, 4, { groupId: 'B' }); await f.rules(); await f.save(b, f.result(1, 0, 3, 4))
const full = f.result(2, 1, 1, 2, { goals: [f.goal(1), f.goal(1, { ownGoal: true, scorerId: null, assistId: null }), f.goal(2)], cards: [{ teamId: tid(2), minute: 72, kind: 'red', playerId: pid(4) }], substitutions: [{ teamId: tid(1), minute: 65, playerInId: pid(3), playerOutId: pid(2) }], stats: { possession: [58, 42], shots: [12, 6], shotsOnTarget: [5, 2], corners: [4, 1], fouls: [7, 9], offsides: [1, 2] } })
await f.save(id, full); const target = (await f.history(id)).revisions[0]
await f.save(id, f.result(2, 1, 1, 2, { goals: [f.goal(1, { scorerId: pid(3), assistId: null, minute: 50 }), f.goal(1), f.goal(2)] }))
const semi = await f.create(null, null, { stage: 'semi', groupId: null, slot: 1, scheduledAt: '2026-12-10T08:00:00.000Z' })
await f.standings(f.command('bindMatch', semi, { homeQualification: { groupId: 'A', rank: 1 }, awayQualification: { groupId: 'B', rank: 1 } }))
const final = await f.create(null, 4, { stage: 'final', groupId: null, slot: 1, homeFrom: semi, scheduledAt: '2026-12-20T08:00:00.000Z' })
let dropResponse = false, delayPreview = false, entered, release
const restoreRequests = [], errors = [], unexpected = [], checks = []
const check = name => { checks.push(name); console.log('PASS ' + name) }
const business = async e => {
  if (e.action === 'standings.restoreResult') restoreRequests.push(copy(e))
  const handler = e.action.startsWith('standings.') ? f.standings : e.action.startsWith('matches.') ? f.matches : e.action.startsWith('competitions.') ? competitions : e.action.startsWith('teams.') ? teams : e.action.startsWith('registrations.') ? registrations : e.action.startsWith('settings.') ? settings : auth
  const result = await handler(e)
  if (delayPreview && e.action === 'standings.previewRestoreResult') { delayPreview = false; entered?.(); await new Promise(resolve => { release = resolve }) }
  return result
}
const allowed = ['competitions.listPublic', 'competitions.getPublic', 'matches.listPublic', 'matches.getPublic', 'standings.getPublic', 'settings.getPublic']
const http = createHttpHandler(business, [adminOrigin, publicOrigin], allowed)
const cert = await fs.mkdtemp('/tmp/community-football-result-restore-')
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${cert}/key.pem`, '-out', `${cert}/cert.pem`, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })
const server = createServer({ key: await fs.readFile(`${cert}/key.pem`), cert: await fs.readFile(`${cert}/cert.pem`) }, async (req, res) => {
  let body = ''; for await (const part of req) body += part
  const result = await http({ httpMethod: req.method, headers: req.headers, body })
  // A complete malformed response avoids Chromium transparently retrying a
  // dropped socket, so the actual application retry UI is exercised.
  if (dropResponse && body.includes('"standings.restoreResult"') && result.statusCode === 200) { dropResponse = false; res.writeHead(200, result.headers); res.end('{"ok":'); return }
  res.writeHead(result.statusCode, result.headers); res.end(result.body)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const endpoint = `https://127.0.0.1:${server.address().port}/api`, config = resolve('.tools/result-restore-public.vite.config.ts')
await fs.writeFile(config, `import base from '../vite.config';export default env=>{const c=base(env);return{...c,define:{...c.define,'import.meta.env.VITE_COMPETITION_API_URL':${JSON.stringify(JSON.stringify(endpoint))},'import.meta.env.VITE_PUBLIC_FALLBACK_API_URL':'""'},cacheDir:'.tools/result-restore-public-cache',server:{host:'127.0.0.1',port:5214,strictPort:true,hmr:false}}}\n`)
process.env.VITE_ADMIN_API_URL = endpoint
const adminVite = await createViteServer({ configFile: 'admin/vite.config.ts', mode: 'test', define: { 'import.meta.env.VITE_ADMIN_API_URL': JSON.stringify(endpoint), 'import.meta.env.VITE_CLOUD_ENVIRONMENT_NAME': JSON.stringify('隔离验收环境'), 'import.meta.env.VITE_WECHAT_CLOUD_ENV_ID': JSON.stringify('isolated-result-restore') }, cacheDir: resolve('.tools/result-restore-admin-cache'), server: { host: '127.0.0.1', port: 5213, strictPort: true, hmr: false } }); await adminVite.listen()
const preview = spawn('node', ['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js', '--config', config, '--host', '127.0.0.1', '--port', '5214'], { detached: true, env: { ...process.env, CHOKIDAR_USEPOLLING: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] })
let log = '', browser, context, admin, user
for (const stream of [preview.stdout, preview.stderr]) stream.on('data', chunk => { log += chunk })
const row = () => admin.locator('.standings-match-row').filter({ hasText: '小组赛 · A' })
const panel = () => admin.getByRole('region', { name: '历史赛果恢复预览' })
const historyRow = version => admin.locator(`.result-history-row[data-version="${version}"]`)
async function openHistory() { await row().getByRole('button', { name: '更正历史', exact: true }).click(); await historyRow(target.version).waitFor() }
async function restorePreview() { await historyRow(target.version).getByRole('button', { name: `预览恢复 v${target.version}`, exact: true }).click(); await panel().waitFor() }
async function refreshAdmin() { await admin.getByRole('button', { name: '刷新数据', exact: true }).click(); await row().waitFor(); await row().getByRole('button', { name: '更正历史', exact: true }).waitFor({ state: 'visible' }) }
async function fillConfirmation(reason = '核对技术台原始记录后恢复') { await panel().getByLabel('恢复原因', { exact: true }).fill(reason); await panel().getByRole('checkbox').check() }
async function publicStandings() { await user.goto(`${publicOrigin}/?case=${Date.now()}#/pages/index/index?tab=stats`); await user.locator('.live-standing-group').first().waitFor() }
async function noOverflow(page) { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true) }
try {
  const deadline = Date.now() + 30000
  for (;;) { if (preview.exitCode !== null) throw new Error(log.slice(-3000)); try { if ((await fetch(publicOrigin, { signal: AbortSignal.timeout(1000) })).ok) break } catch {} if (Date.now() > deadline) throw new Error(log.slice(-3000)); await new Promise(r => setTimeout(r, 200)) }
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', ignoreHTTPSErrors: true }); context.setDefaultTimeout(15000)
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.protocol.startsWith('http') && !['127.0.0.1', 'localhost'].includes(url.hostname)) { unexpected.push(url.origin); return route.abort() } return route.continue() })
  admin = await context.newPage(); user = await context.newPage(); for (const p of [admin, user]) p.on('pageerror', error => errors.push(error.message))
  await admin.goto(adminOrigin); await admin.getByLabel('管理员账号', { exact: true }).fill('admin'); await admin.getByLabel('登录密码', { exact: true }).fill(password); await admin.getByRole('button', { name: '登录管理后台' }).click(); await admin.locator('.sidebar').getByRole('button', { name: '榜单与晋级', exact: true }).click()
  await openHistory(); assert.equal(await historyRow(f.records.get(id).version).getByRole('button', { name: /^预览恢复/ }).count(), 0)
  const before = copy([...f.revisions]); await restorePreview()
  assert.deepEqual([...f.revisions], before); assert.equal(await panel().getByRole('button', { name: '确认恢复历史赛果' }).isDisabled(), true)
  const intended = panel().getByRole('region', { name: '拟恢复赛果', exact: true })
  for (const text of ['2 : 1', '乌龙球', '红牌', '换入', '58% / 42%', '历史前锋1', '历史中场1']) assert.ok((await intended.innerText()).includes(text), text)
  assert.ok(!(await panel().getByRole('region', { name: '当前赛果', exact: true }).innerText()).includes('58% / 42%'))
  await admin.locator('.result-editor').evaluate(form => form.requestSubmit()); assert.equal(restoreRequests.length, 0)
  await panel().screenshot({ path: `${out}/preview-desktop.png` }); check('管理员选择精确历史版本，全事件/统计对比、只读预览和确认门槛可用，同比分不混淆版本')
  for (const width of [390, 320]) { await admin.setViewportSize({ width, height: 844 }); await noOverflow(admin); assert.equal(await intended.evaluate(el => getComputedStyle(el.parentElement).gridTemplateColumns.split(' ').length), 1); await panel().screenshot({ path: `${out}/preview-${width}.png` }) }
  await admin.setViewportSize({ width: 1440, height: 1000 }); check('390px与320px预览改为上下对比，整页无横向溢出')
  await fillConfirmation(); dropResponse = true
  await panel().getByRole('button', { name: '确认恢复历史赛果', exact: true }).click(); await panel().getByRole('button', { name: '重试确认恢复', exact: true }).waitFor()
  const count = f.revisions.size, version = f.records.get(id).version
  assert.equal(await panel().getByLabel('恢复原因').isDisabled(), true)
  await panel().getByRole('button', { name: '重试确认恢复', exact: true }).click(); await admin.getByRole('status').filter({ hasText: '已将历史' }).waitFor()
  assert.equal(f.revisions.size, count); assert.equal(f.records.get(id).version, version); assert.deepEqual(restoreRequests[0], restoreRequests[1])
  await openHistory(); await historyRow(version).getByText(`从历史 v${target.version} 恢复生成，原版本记录保留。`, { exact: true }).waitFor(); check('恢复响应损坏后保留原请求重试，仅生成一次新修订并展示来源审计')
  await publicStandings(); await user.getByRole('button', { name: '射手榜', exact: true }).click(); assert.equal(await user.locator('.live-player-row').filter({ hasText: '历史中场1' }).count(), 0)
  await user.getByRole('button', { name: '助攻榜', exact: true }).click(); await user.locator('.live-player-row').filter({ hasText: '历史中场1' }).waitFor()
  await user.goto(`${publicOrigin}/#/pages/match/detail?id=${id}`); await user.locator('.timeline-event').first().waitFor(); assert.equal(await user.locator('.timeline-event').count(), 5); assert.ok((await user.locator('.stat-bars').innerText()).includes('58%'))
  await user.screenshot({ path: `${out}/restored-public-detail.png`, fullPage: true }); check('真实客户端比赛详情同步恢复进球/乌龙/牌面/换人和统计，射手助攻按所选事件重算')
  await restorePreview(); await fillConfirmation('预览后并发修改校验'); f.teams.get(tid(1)).version++
  const unchanged = f.revisions.size; await panel().getByRole('button', { name: '确认恢复历史赛果', exact: true }).click(); await admin.getByRole('alert').filter({ hasText: '预览后数据已变化' }).waitFor(); assert.equal(await panel().count(), 0); assert.equal(f.revisions.size, unchanged)
  check('预览后球队版本变化阻止提交，原数据与历史保持一致')
  await f.save(id, f.result(0, 1)); await f.save(semi, f.result(1, 0, 2, 3, { state: 'live', minute: 40 }))
  await refreshAdmin(); await openHistory(); await historyRow(target.version).getByRole('button', { name: `预览恢复 v${target.version}` }).click(); await admin.getByRole('alert').filter({ hasText: '后续比赛赛果' }).waitFor(); assert.equal(await panel().count(), 0)
  await f.revoke(semi); await refreshAdmin(); await openHistory(); await restorePreview(); await fillConfirmation('先撤销后轮，再恢复小组赛原始记录'); await panel().getByRole('button', { name: '确认恢复历史赛果', exact: true }).click(); await admin.getByRole('status').filter({ hasText: '已将历史' }).waitFor()
  await user.goto(`${publicOrigin}/?graph=${Date.now()}#/pages/index/index?tab=tournament`); await user.getByRole('button', { name: '晋级对阵', exact: true }).click(); const semiCard = user.locator(`.knockout-match[data-match-id="${semi}"]`); await semiCard.getByText('【模拟】球队1', { exact: true }).waitFor(); assert.equal(await user.locator(`.knockout-match[data-match-id="${final}"] .is-pending`).count(), 1)
  check('已有进行中后轮时拒绝恢复，撤销后轮后可恢复并更新真实晋级图')
  await f.save(semi, f.result(1, 0, 1, 3)); await f.save(final, f.result(0, 0, 1, 4, { penalties: [5, 4] })); const finalTarget = (await f.history(final)).revisions[0]
  await f.save(final, f.result(0, 0, 1, 4, { penalties: [3, 4] })); await refreshAdmin()
  await admin.locator('.standings-match-row').filter({ hasText: /^决赛 ·/ }).getByRole('button', { name: '更正历史', exact: true }).click()
  await historyRow(finalTarget.version).getByRole('button', { name: `预览恢复 v${finalTarget.version}`, exact: true }).click(); await panel().waitFor(); assert.ok((await panel().getByRole('region', { name: '拟恢复赛果', exact: true }).innerText()).includes('点球 5 : 4'))
  await fillConfirmation('恢复决赛原始点球记录'); await panel().getByRole('button', { name: '确认恢复历史赛果', exact: true }).click(); await admin.getByRole('status').filter({ hasText: '已将历史' }).waitFor()
  await user.getByRole('button', { name: '刷新榜单', exact: true }).click(); await user.locator('.live-champion').getByText('【模拟】球队1', { exact: true }).waitFor(); check('后台恢复历史点球赛果后，真实淘汰赛图同步重算并展示冠军')
  await f.revoke(final); await f.revoke(semi)
  for (let n = 0; n < 21; n++) await f.save(id, f.result(n % 2, 0))
  await refreshAdmin(); await row().getByRole('button', { name: '更正历史', exact: true }).click(); await admin.getByRole('button', { name: '加载更多历史', exact: true }).waitFor()
  assert.equal(await admin.locator('.result-history-row').count(), 20); assert.equal(await historyRow(target.version).count(), 0)
  await admin.getByRole('button', { name: '加载更多历史', exact: true }).click(); await historyRow(target.version).waitFor(); await restorePreview(); await panel().getByRole('button', { name: '取消恢复预览', exact: true }).click()
  check('历史记录超过一页时仍可加载并选择旧版本')
  delayPreview = true; const waiting = new Promise(resolve => { entered = resolve })
  await historyRow(target.version).getByRole('button', { name: `预览恢复 v${target.version}`, exact: true }).click(); await waiting
  await admin.locator('.sidebar').getByRole('button', { name: '账号与访问', exact: true }).click(); release(); release = null
  await admin.locator('.sidebar').getByRole('button', { name: '榜单与晋级', exact: true }).click(); await row().waitFor(); assert.equal(await panel().count(), 0)
  check('预览响应迟到时切换页面，不覆盖新页面也不产生卸载错误')
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
  await fs.writeFile(`${out}/report.json`, JSON.stringify({ date: '2026-11-23', scope: 'D 单场历史赛果恢复', environment: 'isolated HTTPS, actual admin/client and business services', customerEnvironmentModified: false, checks, pageErrors: errors, unexpectedExternalOrigins: unexpected }, null, 2) + '\n'); console.log(`PASS ${checks.length} result restore browser checks`)
} catch (error) { if (admin) { await admin.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {}); await fs.writeFile(`${out}/failure.txt`, `${error.stack}\n${(await admin.locator('body').innerText()).slice(-14000)}\n${log.slice(-4000)}`) } throw error }
finally { release?.(); server.closeAllConnections(); await context?.close(); await browser?.close(); await adminVite.close(); try { process.kill(-preview.pid, 'SIGTERM') } catch {} await new Promise(resolve => server.close(resolve)); await fs.rm(cert, { recursive: true, force: true }) }
