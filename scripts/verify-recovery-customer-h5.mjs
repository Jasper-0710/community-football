import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { chromium } from 'playwright'
import { loadCloudEnvironment } from './cloud-environment.mjs'
import { verifyPublicFallbackGateway } from './public-fallback-gateway.mjs'

const args = process.argv.slice(2)
assert.ok(args.length === 2 && args[0] === '--match-id' && /^m_[a-f0-9]{32}$/.test(args[1]), '用法：npm run test:recovery:customer-h5 -- --match-id <公开已完赛比赛ID>')
const target = loadCloudEnvironment('production'), matchId = args[1]
assert.ok(target.publicFallbackApiUrl, '尚未登记publicRead的独立HTTPS地址；先通过cloud:setup --public-fallback-url验证，不能以模拟入口替代客户验收。')
assert.equal(target.competitionApiUrl, target.adminApiUrl, '客户验收只允许共享配置中的正式主接口。')
const gateway = await verifyPublicFallbackGateway({ primaryEndpoint: target.competitionApiUrl, fallbackEndpoint: target.publicFallbackApiUrl })
const sampleResponse = await fetch(target.competitionApiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: gateway.origin }, body: JSON.stringify({ action: 'matches.getPublic', id: matchId }), credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000) })
const sample = await sampleResponse.json()
assert.equal(sampleResponse.status, 200)
assert.ok(sample.ok && sample.match?.id === matchId && sample.match.status === 'finished' && sample.match.homeScore !== null && sample.match.result?.goals?.length, '请指定有真实非空赛果事件的公开已完赛比赛。')

const root = resolve('dist/build/h5'), out = resolve('artifacts/recovery-customer-h5')
const index = await fs.readFile(resolve(root, 'index.html'), 'utf8')
const assets = await fs.readdir(resolve(root, 'assets'))
const sources = await Promise.all(assets.filter(name => name.endsWith('.js')).map(name => fs.readFile(resolve(root, 'assets', name), 'utf8')))
assert.ok(sources.some(source => source.includes(target.publicFallbackApiUrl)), 'H5构建尚未包含已验证的备用地址，请先npm run build:h5。')
await fs.mkdir(out, { recursive: true })
const report = { startedAt: new Date().toISOString(), environment: target.envId, gateway, scope: 'Production H5 assets at an allowed local origin; actual customer HTTPS and browser CORS. Faults abort only this isolated browser context. No cloud service is stopped.', checks: [], requests: [], pageErrors: [], businessWrites: 0, administratorLogin: false }
let fault = 'none', phase = 'primary', browser
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
const check = name => { report.checks.push(name); console.log(`PASS ${name}`) }
const pageUrl = `${gateway.origin}/#/pages/match/detail?id=${matchId}`
const endpoints = [target.competitionApiUrl, target.publicFallbackApiUrl].map(value => new URL(value).href)
const publicActions = new Set(['settings.getPublic', 'matches.getPublic'])
async function attach(context) {
  // Serving built assets within this context avoids changing an already running dev server.
  // Customer API requests are never fulfilled with test data.
  await context.route(`${gateway.origin}/**`, async route => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname)
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!path.startsWith(root + sep)) return route.fulfill({ status: 403, body: '' })
    try { await route.fulfill({ status: 200, contentType: types[extname(path)] || 'application/octet-stream', body: path === resolve(root, 'index.html') ? index : await fs.readFile(path) }) }
    catch (error) { if (error.code === 'ENOENT') await route.fulfill({ status: 404, body: '' }); else throw error }
  })
  for (const [index, endpoint] of endpoints.entries()) await context.route(endpoint, async route => {
    const request = route.request(), kind = index === 0 ? 'primary' : 'fallback'
    const data = request.method() === 'POST' ? request.postDataJSON() : null
    assert.ok(!data || publicActions.has(data.action), `Unexpected non-read request: ${data?.action}`)
    const injectedFailure = fault === 'both' || fault === 'primary' && kind === 'primary'
    report.requests.push({ phase, kind, method: request.method(), action: data?.action, injectedFailure })
    if (injectedFailure) await route.abort('failed')
    else await route.continue()
  })
}
function observe(page) { page.on('pageerror', error => report.pageErrors.push(error.message)) }
async function view(page) {
  await page.locator('.match-detail-page').waitFor()
  assert.equal(await page.locator('.detail-score-label').innerText(), '全场比分')
  return { score: await page.locator('.detail-score').innerText(), teams: await page.locator('.detail-team').allInnerTexts(), statistics: await page.locator('.detail-stat-panel').innerText(), events: await page.locator('.timeline-event').allInnerTexts() }
}
async function storedMatch(page) {
  const row = await page.evaluate(id => {
    const key = Object.keys(localStorage).find(key => key.startsWith('community-football.public-snapshots.v1:'))
    const stored = key ? JSON.parse(localStorage.getItem(key)) : null
    return (stored?.data?.rows || stored?.rows || []).find(row => { const data = JSON.parse(row.key); return data.action === 'matches.getPublic' && data.id === id }) || null
  }, matchId)
  assert.ok(row, '缺少已确认主服务比赛快照。')
  return row
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  context.setDefaultTimeout(25_000)
  await attach(context)
  const page = await context.newPage(); observe(page)
  await page.goto(pageUrl)
  const original = await view(page)
  await page.locator('.recovery-notice').waitFor({ state: 'hidden' })
  const stored = await storedMatch(page)
  assert.equal(original.events.length, sample.match.result.goals.length + sample.match.result.cards.length + sample.match.result.substitutions.length)
  check('primary-nonempty-match-and-confirmed-local-snapshot')

  phase = 'primary-fault'; fault = 'primary'
  const responsePromise = page.waitForResponse(response => response.url() === endpoints[1] && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'matches.getPublic')
  await page.reload()
  await page.locator('.recovery-notice-title').getByText('正在使用云端备用读取', { exact: true }).waitFor()
  assert.deepEqual(await view(page), original)
  const fallbackResponse = await responsePromise
  assert.equal(fallbackResponse.status(), 200)
  const fallbackBody = await fallbackResponse.json()
  assert.equal(fallbackBody.recovery?.source, 'fallback')
  await page.locator('.recovery-notice').getByText('当前只读，恢复连接后重新读取再保存。', { exact: true }).waitFor()
  check('real-independent-https-fallback-and-readonly-notice')
  assert.deepEqual(await storedMatch(page), stored)
  check('fallback-does-not-overwrite-confirmed-primary-snapshot')

  phase = 'both-fault'; fault = 'both'
  await page.reload()
  await page.locator('.recovery-notice-title').getByText('正在显示本机公开快照', { exact: true }).waitFor()
  await page.locator('.recovery-notice').getByText(/北京时间/).waitFor()
  assert.deepEqual(await view(page), original)
  assert.deepEqual(await storedMatch(page), stored)
  check('both-transports-fail-uses-original-nonempty-snapshot-and-time')
  await page.screenshot({ path: resolve(out, 'snapshot-390.png'), fullPage: true })

  phase = 'reconnect'; fault = 'none'
  await page.getByRole('button', { name: '重新连接', exact: true }).click()
  await page.locator('.recovery-notice').waitFor({ state: 'hidden' })
  assert.deepEqual(await view(page), original)
  assert.ok((await storedMatch(page)).savedAt > stored.savedAt)
  check('reconnect-refreshes-primary-and-clears-fault-notice')

  phase = 'cold-both-fault'; fault = 'both'
  const cold = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  cold.setDefaultTimeout(25_000); await attach(cold)
  const coldPage = await cold.newPage(); observe(coldPage)
  await coldPage.goto(pageUrl)
  await coldPage.locator('.match-read-error').waitFor()
  assert.equal(await coldPage.locator('.match-detail-page').count(), 0)
  assert.equal(await coldPage.getByText('没有找到这场比赛', { exact: true }).count(), 0)
  check('uncached-both-fail-shows-read-error-without-fabricated-match')
  phase = 'cold-reconnect'; fault = 'none'
  await coldPage.getByRole('button', { name: '重新连接', exact: true }).click()
  await coldPage.locator('.recovery-notice').waitFor({ state: 'hidden' })
  assert.deepEqual(await view(coldPage), original)
  check('uncached-original-page-reconnects-to-real-match')
  assert.deepEqual(report.pageErrors, [])
  report.completedAt = new Date().toISOString()
  report.faultHooksDiscardedWithBrowserContext = true
} catch (error) {
  report.failure = error.message
  process.exitCode = 1
} finally {
  if (browser) await browser.close()
  await fs.writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify({ passed: !report.failure, checks: report.checks.length, pageErrors: report.pageErrors, ...(report.failure ? { failure: report.failure } : {}) }))
