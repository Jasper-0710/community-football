import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:https'
import { execFileSync, spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
const require = createRequire(import.meta.url)
const { createDirectoryFixture } = require('../tests/helpers/directory-fixture.cjs')
const { PUBLIC_ACTIONS: CONTENT_PUBLIC } = require('../cloudfunctions/adminAuth/content')
const { createCompetitionService, PUBLIC_ACTIONS: COMPETITION_PUBLIC } = require('../cloudfunctions/adminAuth/competitions')
const { PUBLIC_ACTIONS: MATCH_PUBLIC } = require('../cloudfunctions/adminAuth/matches')
const { PUBLIC_ACTIONS: STANDINGS_PUBLIC } = require('../cloudfunctions/adminAuth/standings')
const { createSettingsService, PUBLIC_ACTIONS: SETTINGS_PUBLIC } = require('../cloudfunctions/adminAuth/platform-settings')
const { createHttpHandler } = require('../cloudfunctions/adminAuth/http')
const { createPublicCache } = require('../cloudfunctions/adminAuth/public-cache')
const { createPublicReadService, PUBLIC_ACTIONS: CACHE_PUBLIC } = require('../cloudfunctions/publicRead/service')
const out = 'artifacts/directory', origin = 'http://127.0.0.1:5211'
await fs.mkdir(out, { recursive: true }); await fs.mkdir('.tools', { recursive: true })
const f = await createDirectoryFixture(), { collections, cid, tid, pid, mid } = f
const authorize = async () => ({ ok: false, error: { code: 'UNAUTHORIZED', message: '仅公开验收' } })
const competitions = createCompetitionService({ store: { read: id => f.store.read('competitions', id), async list({ publicOnly, cursor, limit }) { return [...collections.competitions.values()].filter(c => (!publicOnly || c.displayEnabled) && (!cursor || c._id > cursor)).sort((a, b) => a._id.localeCompare(b._id)).slice(0, limit) } }, authorize })
const settings = createSettingsService({ store: f.store, authorize })
const actions = [...CONTENT_PUBLIC, ...COMPETITION_PUBLIC, ...MATCH_PUBLIC, ...STANDINGS_PUBLIC, ...SETTINGS_PUBLIC]
let failDirectory = false, failFallback = false, slowSelected = false, slowEntered, releaseSlow
const requests = [], objects = new Map(), cacheStorage = { async upload(path, bytes) { objects.set(path, Buffer.from(bytes)) }, async download(path) { if (!objects.has(path)) throw new Error('Cache miss'); return objects.get(path) } }
const cache = createPublicCache({ storage: cacheStorage, environment: 'isolated-directory', enabled: true, logger: { error() {} } })
const fallback = createPublicReadService({ storage: cacheStorage, environment: 'isolated-directory', logger: { error() {} } })
const business = e => e.action.startsWith('settings.') ? settings(e) : e.action.startsWith('competitions.') ? competitions(e) : e.action.startsWith('matches.') ? f.matches(e) : e.action.startsWith('standings.') ? f.standings(e) : f.content(e)
const router = async e => {
  const trace = { action: e.action, id: e.id, teamId: e.teamId, competitionId: e.competitionId }
  requests.push(trace)
  if (failDirectory && e.action.startsWith('directory.')) return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '隔离首页档案服务暂不可用。' } }
  if (slowSelected && e.action === 'directory.playerProfilePublic' && e.competitionId === cid(2)) {
    slowSelected = false; const saved = await cache(e, business); slowEntered?.(); await new Promise(resolve => { releaseSlow = resolve }); return saved
  }
  const response = await cache(e, business)
  trace.error = response.error?.code
  return response
}
const http = createHttpHandler(router, [origin], actions), fallbackHttp = createHttpHandler(e => failFallback ? { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '隔离备用服务暂不可用。' } } : fallback(e), [origin], CACHE_PUBLIC)
const cert = await fs.mkdtemp('/tmp/community-football-directory-')
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${cert}/key.pem`, '-out', `${cert}/cert.pem`, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })
const server = createServer({ key: await fs.readFile(`${cert}/key.pem`), cert: await fs.readFile(`${cert}/cert.pem`) }, async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk
  const response = await (req.url === '/fallback' ? fallbackHttp : http)({ httpMethod: req.method, headers: req.headers, body })
  res.writeHead(response.statusCode, response.headers); res.end(response.body)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const endpoint = `https://127.0.0.1:${server.address().port}/api`, fallbackEndpoint = endpoint.replace('/api', '/fallback'), config = resolve('.tools/directory-public.vite.config.ts')
// Explicit loopback transport overrides prevent any fixture requests reaching
// the customer's configured primary or fallback services.
await fs.writeFile(config, `import base from '../vite.config';export default env=>{const c=base(env);return{...c,define:{...c.define,'import.meta.env.VITE_COMPETITION_API_URL':${JSON.stringify(JSON.stringify(endpoint))},'import.meta.env.VITE_PUBLIC_FALLBACK_API_URL':${JSON.stringify(JSON.stringify(fallbackEndpoint))}},cacheDir:'.tools/directory-public-cache',server:{host:'127.0.0.1',port:5211,strictPort:true,hmr:false}}}\n`)
const preview = spawn('node', ['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js', '--config', config, '--host', '127.0.0.1', '--port', '5211'], { detached: true, env: { ...process.env, CHOKIDAR_USEPOLLING: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''; for (const stream of [preview.stdout, preview.stderr]) stream.on('data', chunk => { log += chunk })
let browser, context, page
const checks = [], errors = [], unexpected = []
const check = name => { checks.push(name); console.log('PASS ' + name) }
// These are independent cold deep-link entries. A hash-only page.goto can race
// an unfinished uni router boot (or reuse a prior page with old query params).
// In-app transitions below are tested separately through the actual buttons.
let navigation = 0
const go = path => page.goto(`${origin}/?directoryCase=${++navigation}#${path}`)
const home = async () => { await go('/pages/index/index'); await page.locator('[data-home-count="teams"]').getByText('3', { exact: true }).waitFor() }
const team = async () => { await go(`/pages/team/detail?id=${tid(1)}`); await page.locator('.public-team-profile .page-title').waitFor(); await page.locator('.record-metric-value').first().waitFor() }
const player = async () => { await go(`/pages/player/detail?id=${pid(1)}&teamId=${tid(1)}`); await page.locator('.player-profile .page-title').waitFor(); await page.locator('.record-metric-value').first().waitFor() }
const values = () => page.locator('.record-metric-value').allTextContents()
const select = name => page.getByLabel('统计范围', { exact: true }).selectOption({ label: name })
async function noOverflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true) }
try {
  const deadline = Date.now() + 30000
  for (;;) {
    if (preview.exitCode !== null) throw new Error('Preview exited: ' + log.slice(-3000))
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) break } catch {}
    if (Date.now() > deadline) throw new Error('Preview did not start: ' + log.slice(-3000))
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', ignoreHTTPSErrors: true })
  context.setDefaultTimeout(15000)
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.protocol.startsWith('http') && !['127.0.0.1', 'localhost'].includes(url.hostname)) { unexpected.push(url.origin); return route.abort() }
    return route.continue()
  })
  page = await context.newPage(); page.on('pageerror', e => errors.push(e.message))
  await home()
  assert.equal((await page.locator('[data-home-count="matches"]').innerText()).trim(), '6')
  assert.equal(await page.locator('.home-team-preview').count(), 3)
  await page.locator('.date-badge').getByText('11.23 / 周一', { exact: true }).waitFor()
  await page.locator('.home-match-wrap .directory-match-card').click(); await page.locator('.detail-score').getByText('当前比分 · 进行中', { exact: true }).waitFor()
  assert.ok(page.url().includes(mid(4))); check('首页统计、北京时间比赛日、球队预览来自公开服务，比赛进入真实详情')
  await home(); await page.getByRole('button', { name: '全部赛程', exact: true }).click(); await page.locator('.public-schedule-card').first().waitFor()
  await home(); await page.getByRole('button', { name: '认识球队', exact: true }).click(); await page.locator('.public-team-finder').waitFor()
  check('首页全部赛程和认识球队进入公开业务页面')
  await home(); await page.locator('.home-team-preview').first().click(); await page.locator('.public-team-profile .page-title').waitFor()
  assert.deepEqual(await values(), ['3', '2', '1', '0', '4', '2', '2'])
  assert.equal(await page.locator('.record-match-entry').count(), 6)
  await select('【验收】社区杯2'); await page.locator('.record-metric-value').first().getByText('1', { exact: true }).waitFor(); assert.deepEqual(await values(), ['1', '1', '0', '0', '1', '0', '1'])
  check('球队介绍、名单、完整战绩和赛程显示一致，赛事筛选重算')
  await page.locator('.roster-card').first().click(); await page.locator('.player-profile .page-title').waitFor()
  assert.deepEqual(await values(), ['2', '1', '1', '1'])
  assert.equal(await page.locator('.record-match-entry').count(), 3)
  await page.locator('.record-events').getByText('70′ 换下', { exact: true }).waitFor()
  await select('【验收】社区杯2'); await page.locator('.record-metric-value').first().getByText('0', { exact: true }).waitFor(); assert.deepEqual(await values(), ['0', '1', '0', '0'])
  await page.getByRole('button', { name: '查看所属球队', exact: true }).click(); await page.locator('.public-team-profile .page-title').waitFor()
  check('球员进球、助攻、红黄牌和换人事件可查看、按赛事筛选并返回所属球队')
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    for (const [name, load] of [['home', home], ['team', team], ['player', player]]) { await load(); await noOverflow(); await page.screenshot({ path: `${out}/${name}-${width}.png`, fullPage: true }) }
    await select('【验收】社区杯2'); await page.locator('.record-metric-value').first().getByText('0', { exact: true }).waitFor(); assert.deepEqual(await values(), ['0', '1', '0', '0'])
    check(`${width}px首页、球队与球员档案无横向溢出，移动选择器可筛选赛事`)
  }
  const settingsWriter = createSettingsService({ store: f.store, authorize: async () => ({ ok: true }) })
  const defaultForm = (await settings({ action: 'settings.getPublic' })).settings.form
  assert.equal((await settingsWriter({ action: 'settings.update', token: 'test-token', expectedVersion: 0, requestId: 'e'.repeat(32), form: { ...defaultForm, mode: 'dark' } })).ok, true)
  await page.reload()
  await page.setViewportSize({ width: 390, height: 844 })
  for (const [name, load] of [['home', home], ['team', team], ['player', player]]) { await load(); await page.locator('.app-shell.theme-dark').waitFor(); await noOverflow(); await page.screenshot({ path: `${out}/${name}-dark-390.png`, fullPage: true }) }
  assert.equal((await settingsWriter({ action: 'settings.update', token: 'test-token', expectedVersion: 1, requestId: 'f'.repeat(32), form: defaultForm })).ok, true)
  await page.reload()
  check('新增首页和档案跟随平台明暗设置，390px暗色布局正常')
  await player(); await page.getByRole('button', { name: '刷新档案', exact: true }).waitFor()
  await f.result(1, { homeScore: 0, awayScore: 1, goals: [f.goal(2, 2)] })
  await page.getByRole('button', { name: '刷新档案', exact: true }).click(); await page.locator('.record-metric-value').first().getByText('1', { exact: true }).waitFor(); assert.deepEqual(await values(), ['1', '1', '0', '0'])
  await f.result(5, null, true); await page.getByRole('button', { name: '刷新档案', exact: true }).click(); await page.locator('.record-metric-value').first().getByText('0', { exact: true }).waitFor()
  await team(); assert.equal(await page.locator('.record-match-entry').count(), 5)
  check('实际赛果服务更正和撤销后，球员统计、球队战绩与后轮参与记录同步更新')
  // Seed enough service-written records to exercise both pagination paths.
  for (let n = 8; n <= 29; n++) { await f.create(n, { scheduledAt: `2026-12-${String(n - 7).padStart(2, '0')}T08:00:00.000Z` }); await f.result(n, { homeScore: 1, awayScore: 0, goals: [f.goal(1, 1)] }) }
  for (const load of [team, player]) {
    await load(); assert.equal(await page.locator('.record-match-entry').count(), 20)
    await page.getByRole('button', { name: '加载更多比赛', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('.record-match-entry').length > 20)
    assert.equal(await page.getByRole('button', { name: '加载更多比赛', exact: true }).count(), 0)
  }
  check('球队和球员超过20场记录可连续分页，无重复或丢失')
  // The response for another scope must not repaint a different page after navigation.
  await player(); slowSelected = true
  const entered = new Promise(resolve => { slowEntered = resolve })
  await select('【验收】社区杯2'); await entered
  await go(`/pages/team/detail?id=${tid(2)}`); await page.locator('.public-team-profile .page-title').getByText('【验收】社区球队2', { exact: true }).waitFor()
  await page.locator('.roster-card').first().click(); await page.locator('.player-profile .page-title').getByText('【验收】球员2', { exact: true }).waitFor()
  releaseSlow(); await page.waitForTimeout(100); assert.equal((await page.locator('.player-profile .page-title').innerText()).trim(), '【验收】球员2')
  check('切换页面后旧赛事筛选的延迟响应不会覆盖当前球员')
  await player(); failDirectory = true
  await page.getByRole('button', { name: '刷新档案', exact: true }).click(); await page.locator('.recovery-notice-title').getByText('正在使用云端备用读取', { exact: true }).waitFor(); await page.locator('.record-metric-value').first().waitFor()
  failFallback = true; await page.getByRole('button', { name: '刷新档案', exact: true }).click(); await page.locator('.recovery-notice-title').getByText('正在显示本机公开快照', { exact: true }).waitFor()
  failDirectory = false; failFallback = false
  await page.getByRole('button', { name: '重新连接', exact: true }).click(); await page.locator('.recovery-notice').waitFor({ state: 'hidden' })
  check('新档案接口支持云端备用、本机已确认快照与重连，来源始终标识')
  await select('【验收】社区杯2'); await page.locator('.record-metric-value').first().getByText('0', { exact: true }).waitFor()
  collections.competitions.get(cid(2)).displayEnabled = false
  await page.getByRole('button', { name: '刷新档案', exact: true }).click(); await page.getByText('赛事不存在或该球队暂未公开参赛。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '查看全部公开赛事', exact: true }).click(); await page.locator('.record-metric-value').first().waitFor()
  assert.equal(await page.locator('.record-scope-field').getByText('【验收】社区杯2', { exact: true }).count(), 0)
  collections.competitions.get(cid(1)).displayEnabled = false
  await page.getByRole('button', { name: '刷新档案', exact: true }).click(); await page.getByText('档案不存在或暂未公开。', { exact: true }).waitFor()
  assert.equal(await page.locator('.record-metric-value').count(), 0); assert.equal(await page.locator('.recovery-notice').count(), 0)
  check('权威隐藏结果清空档案且不回退到旧快照')
  await go('/pages/index/index'); await page.locator('[data-home-count="teams"]').getByText('0', { exact: true }).waitFor(); await page.getByText('暂无公开赛程', { exact: true }).waitFor()
  check('没有公开赛事时首页显示真实零值与空态')
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', ignoreHTTPSErrors: true })
  const emptyPage = await fresh.newPage(); failDirectory = true; failFallback = true
  await emptyPage.goto(origin); await emptyPage.getByRole('button', { name: '重新读取首页', exact: true }).waitFor()
  assert.equal(await emptyPage.getByText('暂无公开赛程', { exact: true }).count(), 0)
  failDirectory = false; failFallback = false; await emptyPage.getByRole('button', { name: '重新读取首页', exact: true }).click(); await emptyPage.getByText('暂无公开赛程', { exact: true }).waitFor(); await fresh.close()
  check('首次读取失败不伪装空数据，首页重试后恢复')
  assert.deepEqual(errors, []); assert.deepEqual([...new Set(unexpected)], [])
  const report = { date: '2026-11-23', scope: 'A首页 + B公开档案', environment: 'isolated local HTTPS with real Vue/service/recovery code', customerEnvironmentModified: false, sampleData: 'explicitly labeled simulated fixtures', checks, errors, externalOrigins: [...new Set(unexpected)], requests: requests.length }
  await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(`PASS ${checks.length} browser checks; report ${out}/report.json`)
} catch (error) {
  if (page) { await page.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {}); await fs.writeFile(`${out}/failure.txt`, `${error.stack}\n${(await page.locator('body').innerText().catch(() => '')).slice(-14000)}\n${log.slice(-3000)}`) }
  await fs.writeFile(`${out}/failure-context.json`, JSON.stringify({ url: page?.url(), requests: requests.slice(-40), settings: await settings({ action: 'settings.getPublic' }), player: await f.content({ action: 'directory.playerProfilePublic', id: pid(1), teamId: tid(1) }) }, null, 2))
  throw error
} finally {
  releaseSlow?.(); server.closeAllConnections(); await context?.close(); await browser?.close()
  try { process.kill(-preview.pid, 'SIGTERM') } catch {}
  await new Promise(resolve => server.close(resolve))
}
