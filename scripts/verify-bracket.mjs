import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:https'
import { execFileSync, spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
const require = createRequire(import.meta.url)
const { createBracketFixture } = require('../tests/helpers/bracket-fixture.cjs')
const { createHttpHandler } = require('../cloudfunctions/adminAuth/http')
const { createPublicCache } = require('../cloudfunctions/adminAuth/public-cache')
const { createPublicReadService } = require('../cloudfunctions/publicRead/service')
const out = 'artifacts/bracket', origin = 'http://127.0.0.1:5212'
await fs.mkdir(out, { recursive: true }); await fs.mkdir('.tools', { recursive: true })
const f = await createBracketFixture(), { cid, mid, tid } = f
const actions = ['competitions.listPublic', 'competitions.getPublic', 'matches.listPublic', 'matches.getPublic', 'standings.getPublic', 'settings.getPublic']
const objects = new Map(), storage = { async upload(path, bytes) { objects.set(path, Buffer.from(bytes)) }, async download(path) { if (!objects.has(path)) throw new Error('Missing'); return objects.get(path) } }
const cache = createPublicCache({ storage, environment: 'isolated-bracket', enabled: true, logger: { error() {} } }), fallback = createPublicReadService({ storage, environment: 'isolated-bracket', logger: { error() {} } })
let failPrimary = false, failFallback = false, authoritativeFailure = false, delayNext = false, release, entered
const business = e => e.action.startsWith('settings.') ? f.settings(e) : e.action.startsWith('competitions.') ? f.competitions(e) : e.action.startsWith('standings.') ? f.standings(e) : f.matches(e)
const unavailable = () => ({ ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '隔离服务暂不可用。' } })
const primary = async e => {
  if (e.action === 'standings.getPublic') {
    if (authoritativeFailure) return { ok: false, error: { code: 'NOT_FOUND', message: '赛事不存在或暂未公开。' } }
    if (failPrimary) return unavailable()
    if (delayNext) { delayNext = false; const saved = await cache(e, business); entered?.(); await new Promise(resolve => { release = resolve }); return saved }
  }
  return cache(e, business)
}
const http = createHttpHandler(primary, [origin], actions), fallbackHttp = createHttpHandler(e => failFallback ? unavailable() : fallback(e), [origin], actions)
const cert = await fs.mkdtemp('/tmp/community-football-bracket-')
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${cert}/key.pem`, '-out', `${cert}/cert.pem`, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })
const server = createServer({ key: await fs.readFile(`${cert}/key.pem`), cert: await fs.readFile(`${cert}/cert.pem`) }, async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk
  const response = await (req.url === '/fallback' ? fallbackHttp : http)({ httpMethod: req.method, headers: req.headers, body })
  res.writeHead(response.statusCode, response.headers); res.end(response.body)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const endpoint = `https://127.0.0.1:${server.address().port}/api`, config = resolve('.tools/bracket-public.vite.config.ts')
// Neither fixture transport can reach the customer's primary or fallback API.
await fs.writeFile(config, `import base from '../vite.config';export default env=>{const c=base(env);return{...c,define:{...c.define,'import.meta.env.VITE_COMPETITION_API_URL':${JSON.stringify(JSON.stringify(endpoint))},'import.meta.env.VITE_PUBLIC_FALLBACK_API_URL':${JSON.stringify(JSON.stringify(endpoint.replace('/api', '/fallback')))}},cacheDir:'.tools/bracket-public-cache',server:{host:'127.0.0.1',port:5212,strictPort:true,hmr:false}}}\n`)
const preview = spawn('node', ['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js', '--config', config, '--host', '127.0.0.1', '--port', '5212'], { detached: true, env: { ...process.env, CHOKIDAR_USEPOLLING: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] })
let log = '', browser, context, page, navigation = 0
for (const stream of [preview.stdout, preview.stderr]) stream.on('data', chunk => { log += chunk })
const checks = [], errors = [], unexpected = []
const check = name => { checks.push(name); console.log('PASS ' + name) }
const card = n => page.locator(`.knockout-match[data-match-id="${mid(n)}"]`)
async function until(fn) { const deadline = Date.now() + 15000; while (!await fn()) { if (Date.now() > deadline) throw new Error('Condition timed out'); await new Promise(r => setTimeout(r, 80)) } }
async function entry() { await page.goto(`${origin}/?bracketCase=${++navigation}#/pages/index/index?tab=tournament`); await page.getByRole('button', { name: '晋级对阵', exact: true }).click(); await card(11).waitFor() }
async function refresh() { await page.getByRole('button', { name: '刷新榜单', exact: true }).click(); await page.locator('.knockout').waitFor() }
async function select(c, expected) { await page.getByLabel('选择赛事', { exact: true }).selectOption(cid(c)); if (expected) await card(expected).waitFor(); else await page.getByText('尚无淘汰赛对阵', { exact: true }).waitFor() }
async function noOverflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true) }
try {
  const deadline = Date.now() + 30000
  for (;;) { if (preview.exitCode !== null) throw new Error(log.slice(-3000)); try { if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) break } catch {} if (Date.now() > deadline) throw new Error(log.slice(-3000)); await new Promise(r => setTimeout(r, 250)) }
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', ignoreHTTPSErrors: true })
  context.setDefaultTimeout(15000)
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.protocol.startsWith('http') && !['127.0.0.1', 'localhost'].includes(url.hostname)) { unexpected.push(url.origin); return route.abort() } return route.continue() })
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message))
  await entry()
  assert.equal(await page.locator('.knockout-match').count(), 7)
  assert.equal(await page.locator('.knockout-edge').count(), 7)
  assert.deepEqual(await page.locator('.knockout-match').evaluateAll(nodes => nodes.map(n => n.dataset.matchId)), [14, 12, 13, 11, 22, 21, 23].map(mid))
  await card(11).getByText('A组 第1名', { exact: true }).waitFor(); assert.equal(await card(11).locator('.is-pending').count(), 2)
  assert.match(await card(11).innerText(), /2026-12-10 16:15 北京时间/)
  assert.equal(await page.locator('.knockout-edge.confirmed').count(), 0)
  const geometry = await page.locator('.knockout-canvas').evaluate(canvas => {
    const cards = [...canvas.querySelectorAll('.knockout-match')]
    return [...canvas.querySelectorAll('.knockout-edge')].filter(e => e.dataset.side !== 'champion').map(edge => {
      const target = cards.find(c => c.dataset.matchId === edge.dataset.to), side = target.querySelectorAll('.knockout-side')[edge.dataset.side === 'home' ? 0 : 1].getBoundingClientRect(), end = edge.lastElementChild.getBoundingClientRect(), card = target.getBoundingClientRect()
      return { dx: Math.abs(end.right - card.left), dy: Math.abs(end.top - (side.top + side.height / 2)) }
    })
  })
  assert.ok(geometry.every(e => e.dx < 2 && e.dy < 2), JSON.stringify(geometry))
  await page.locator('.knockout').screenshot({ path: `${out}/pending-desktop.png` })
  check('真实八强签位按来源连至对应主客队，待定小组名次和北京时间正确')
  await card(11).click(); await page.waitForURL(url => url.hash.includes(`/pages/match/detail?id=${mid(11)}`)); await page.locator('.detail-status').waitFor()
  check('待定比赛卡片可进入对应真实比赛详情')
  await entry(); for (const n of [1, 2, 3, 4]) await f.result(n, 1, 0)
  await f.result(11, 2, 0, { state: 'live', minute: 40 }); await refresh()
  await card(11).getByText('进行中', { exact: true }).waitFor(); assert.equal(await card(11).locator('.is-winner').count(), 0)
  assert.equal(await page.locator(`.knockout-edge[data-from="${mid(11)}"].confirmed`).count(), 0)
  assert.equal(await card(21).locator('.is-pending').count(), 2)
  check('小组赛结果填充球队，进行中比分不会提前晋级')
  await f.result(11, 1, 1, { penalties: [3, 4] }); for (const n of [12, 13, 14, 21, 22]) await f.result(n, 1, 0); await f.result(23, 0, 0, { penalties: [4, 5] }); await refresh()
  await card(11).getByText('点球 3 : 4', { exact: true }).waitFor(); await card(23).getByText('点球 4 : 5', { exact: true }).waitFor()
  assert.equal(await page.locator('.knockout-edge.confirmed').count(), 7)
  await page.locator('.live-champion').getByText('【模拟】社区球队3', { exact: true }).waitFor()
  await page.locator('.knockout').screenshot({ path: `${out}/finished-desktop.png` })
  check('点球胜者、绿色晋级连线和冠军与同一服务快照一致')
  await f.revoke(23); await f.revoke(21); await f.result(11, 2, 0); await refresh()
  assert.equal(await page.locator('.live-champion').count(), 0); await page.getByText('冠军待定', { exact: true }).waitFor()
  await card(21).getByText('【模拟】社区球队1', { exact: true }).waitFor(); assert.equal(await card(23).locator('.is-pending').count(), 1)
  await f.result(21, 0, 1); await f.result(23, 0, 1); await refresh(); await page.locator('.live-champion').getByText('【模拟】社区球队1', { exact: true }).waitFor()
  check('撤销后轮、更正前轮再重发，签位、比分、连线与冠军同步更新')
  await select(2, 31); assert.equal(await page.locator('.knockout-match').count(), 3); assert.equal(await page.locator('.knockout-heading').count(), 3)
  await select(3); assert.equal(await page.locator('.knockout').count(), 0)
  assert.equal(await page.getByLabel('选择赛事').locator('option').count(), 3)
  await select(1, 11); check('赛事切换支持只有四强、未排赛与隐藏赛事过滤，不补造八强')
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await noOverflow()
    await page.locator('.knockout-jumps').getByRole('button', { name: '冠军', exact: true }).click()
    await until(() => page.locator('.knockout-scroll .uni-scroll-view').evaluateAll(nodes => nodes.some(el => el.scrollLeft > 500)))
    await page.locator('.knockout').screenshot({ path: `${out}/champion-${width}.png` })
    await page.locator('.knockout-jumps').getByRole('button', { name: '四分之一决赛', exact: true }).click()
    await until(() => page.locator('.knockout-scroll .uni-scroll-view').evaluateAll(nodes => nodes.every(el => el.scrollLeft < 2)))
    await page.locator('.knockout').screenshot({ path: `${out}/quarter-${width}.png` })
    await select(2, 31); await select(1, 11); await noOverflow()
    check(`${width}px整页无溢出，图内横滑、轮次定位和赛事选择可用`)
  }
  // Use actual settings service and theme application for a dark-theme snapshot.
  const settings = await f.settings({ action: 'settings.getPublic' })
  const dark = await f.settings({ action: 'settings.update', token: 'bracket-test', expectedVersion: settings.settings.version, requestId: 'f'.repeat(32), form: { ...settings.settings.form, mode: 'dark' } })
  assert.equal(dark.ok, true, JSON.stringify(dark)); await entry(); await page.locator('.theme-dark').waitFor()
  await page.locator('.knockout').screenshot({ path: `${out}/dark-320.png` }); check('深色外观下对阵、来源和连线沿用平台主题')
  failPrimary = true; await refresh(); await page.locator('.recovery-notice').waitFor(); await page.locator('.live-champion').waitFor()
  failFallback = true; await refresh(); await page.locator('.recovery-notice').waitFor(); await page.locator('.live-champion').waitFor()
  failPrimary = false; failFallback = false; await page.getByRole('button', { name: '重新连接', exact: true }).click(); await page.locator('.recovery-notice').waitFor({ state: 'hidden' })
  check('主服务故障沿用公开备用及本机快照，重连后恢复最新对阵')
  authoritativeFailure = true; await page.getByRole('button', { name: '刷新榜单', exact: true }).click(); await page.getByRole('button', { name: '重新加载榜单', exact: true }).waitFor(); assert.equal(await page.locator('.knockout-match').count(), 0)
  authoritativeFailure = false; await page.getByRole('button', { name: '重新加载榜单', exact: true }).click(); await card(11).waitFor(); check('权威不存在清除旧图，重试后恢复')
  delayNext = true; const waiting = new Promise(resolve => { entered = resolve }); await page.getByRole('button', { name: '刷新榜单', exact: true }).click(); await waiting
  await page.getByRole('button', { name: '真实赛程', exact: true }).click(); release(); release = null; await page.locator('.public-schedule-card').first().waitFor()
  await page.getByRole('button', { name: '晋级对阵', exact: true }).click(); await card(11).waitFor(); check('切换页面后迟到响应不覆盖新实例，也不产生卸载错误')
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.locator('.desktop-nav').getByRole('button', { name: '数据', exact: true }).click(); await page.getByRole('button', { name: '晋级对阵', exact: true }).click(); await card(11).waitFor(); assert.equal(await page.locator('.knockout-match').count(), 7)
  check('数据页的榜单与晋级入口复用相同真实对阵图')
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
  await fs.writeFile(`${out}/report.json`, JSON.stringify({ date: '2026-11-23', scope: 'C真实淘汰赛图', environment: 'isolated HTTPS, actual Vue and competition/match/standings/cache services', customerEnvironmentModified: false, checks, pageErrors: errors, unexpectedExternalOrigins: unexpected }, null, 2) + '\n')
  console.log(`PASS ${checks.length} bracket browser checks`)
} catch (error) { if (page) { await page.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {}); await fs.writeFile(`${out}/failure.txt`, `${error.stack}\n${(await page.locator('body').innerText()).slice(-14000)}\n${log.slice(-4000)}`) } throw error }
finally { release?.(); server.closeAllConnections(); await context?.close(); await browser?.close(); try { process.kill(-preview.pid, 'SIGTERM') } catch {} await new Promise(resolve => server.close(resolve)); await fs.rm(cert, { recursive: true, force: true }) }
