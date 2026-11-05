import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:https'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { createServer as createViteServer } from 'vite'
import { chromium } from 'playwright'
const require = createRequire(import.meta.url)
const { createAdminService, createAccount } = require('../cloudfunctions/adminAuth/service.js')
const { createCompetitionService, createApplicationRouter, PUBLIC_ACTIONS } = require('../cloudfunctions/adminAuth/competitions.js')
const { createHttpHandler } = require('../cloudfunctions/adminAuth/http.js')
const { createMemoryStore } = require('../tests/helpers/admin-store.cjs')
const { createCompetitionMemoryStore } = require('../tests/helpers/competition-store.cjs')
const out = 'artifacts/competitions'
await mkdir(out, { recursive: true })
const certDir = await mkdtemp(join(tmpdir(), 'football-d03-'))
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })
const password = randomBytes(24).toString('base64url')
const clock = Date.parse('2026-11-05T00:00:00Z')
const authMemory = createMemoryStore(await createAccount('admin', password, clock))
const auth = createAdminService({ store: authMemory.store, now: () => clock, logger: { error() {} } })
const memory = createCompetitionMemoryStore()
const competitions = createCompetitionService({ store: memory.store, authorize: token => auth({ action: 'session', token }), now: () => clock, logger: { error() {} } })
const router = createApplicationRouter(auth, competitions)
const adminBase = 'http://127.0.0.1:5176', publicBase = 'http://127.0.0.1:5178'
const http = createHttpHandler(router, [adminBase, publicBase], PUBLIC_ACTIONS)
const server = createServer({ key: await readFile(join(certDir, 'key.pem')), cert: await readFile(join(certDir, 'cert.pem')) }, async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const result = await http({ httpMethod: req.method, headers: req.headers, body })
  res.writeHead(result.statusCode, result.headers); res.end(result.body)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const apiUrl = `https://127.0.0.1:${server.address().port}/api`
process.env.VITE_ADMIN_API_URL = apiUrl
const vite = await createViteServer({ configFile: 'admin/vite.config.ts', mode: 'test', server: { host: '127.0.0.1', port: 5176, strictPort: true, watch: { usePolling: true, interval: 250 }, hmr: false } })
await vite.listen()
const publicServer = spawn('node', ['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js', '--host', '127.0.0.1', '--port', '5178'], { detached: true, env: { ...process.env, CHOKIDAR_USEPOLLING: 'true', VITE_COMPETITION_API_URL: apiUrl }, stdio: ['ignore', 'pipe', 'pipe'] })
let publicLog = ''
publicServer.stdout.on('data', d => { publicLog += d }); publicServer.stderr.on('data', d => { publicLog += d })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', ignoreHTTPSErrors: true })
const admin = await context.newPage(), user = await context.newPage()
context.setDefaultTimeout(10_000)
const errors = [], checks = []
for (const p of [admin, user]) p.on('pageerror', e => errors.push(e.message))
const check = name => { checks.push(name); console.log('PASS ' + name) }
const noOverflow = async p => assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
const refresh = async () => { await user.getByText('刷新赛事', { exact: true }).click(); await user.getByText('正在加载赛事…', { exact: true }).waitFor({ state: 'hidden' }) }
const card = () => admin.locator('.competition-admin-card').first()
const visibility = () => card().getByRole('switch', { name: /小程序展示/ })
const registration = () => card().getByRole('switch', { name: /赛事报名/ })
async function save() { await admin.getByRole('button', { name: '保存赛事', exact: true }).click(); await admin.locator('.competition-form').waitFor({ state: 'detached' }); await card().waitFor() }
try {
  const deadline = Date.now() + 30_000
  while (true) {
    if (publicServer.exitCode !== null) throw new Error('Public preview exited: ' + publicLog.slice(-3000))
    try { if ((await fetch(publicBase, { signal: AbortSignal.timeout(1000) })).ok) break } catch {}
    if (Date.now() > deadline) throw new Error('Public preview did not start: ' + publicLog.slice(-2000))
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  await admin.goto(adminBase, { waitUntil: 'networkidle' })
  await admin.getByLabel('管理员账号', { exact: true }).fill('admin'); await admin.getByLabel('登录密码', { exact: true }).fill(password)
  await admin.getByRole('button', { name: '登录管理后台' }).click(); await admin.locator('.workspace').waitFor()
  await admin.getByRole('button', { name: '赛事管理', exact: true }).click()
  await admin.getByRole('button', { name: '新建赛事', exact: true }).click()
  for (const [selector, value] of Object.entries({ '#competition-name': '联调测试·社区足球赛', '#competition-description': '真实服务联调\n第二行介绍', '#competition-venue': '上海社区球场', '#competition-rules': '循环赛，每队依次交手。', '#competition-start': '2026-11-20', '#competition-end': '2026-12-01', '#competition-requirements': '领队提交完整名单。' })) await admin.locator(selector).fill(value)
  await admin.locator('#competition-format').selectOption('round_robin'); await save()
  assert.equal(memory.records.size, 1)
  const id = [...memory.records.keys()][0]
  await user.goto(publicBase + '/#/pages/index/index?tab=tournament', { waitUntil: 'networkidle' })
  await user.getByText('暂无公开赛事', { exact: true }).waitFor()
  await user.goto(publicBase + '/#/pages/competition/detail?id=' + id, { waitUntil: 'networkidle' })
  await user.getByText('赛事不存在或暂未公开。', { exact: true }).waitFor()
  check('new admin competition is hidden from both public list and direct detail')

  await registration().click(); await admin.getByRole('alert').filter({ hasText: '开启报名前' }).waitFor()
  assert.equal(await registration().getAttribute('aria-checked'), 'false')
  await card().getByRole('button', { name: '编辑赛事' }).click()
  await admin.locator('#registration-start').fill('2026-11-01T08:00'); await admin.locator('#registration-end').fill('2026-11-15T08:00'); await save()
  assert.equal(memory.records.get(id).registrationStartAt, '2026-11-01T00:00:00.000Z')
  await visibility().click(); await visibility().filter({ hasText: '已展示' }).waitFor()
  await user.goto(publicBase + '/#/pages/index/index?tab=tournament', { waitUntil: 'networkidle' })
  await user.locator('.public-competition-card').waitFor()
  assert.match(await user.locator('.public-competitions').innerText(), /报名未开放/)
  await user.locator('.public-competition-card').click(); await user.locator('.competition-intro').waitFor()
  assert.match(await user.locator('.competition-intro').innerText(), /联调测试·社区足球赛/)
  assert.match(await user.locator('.competition-detail').innerText(), /2026-11-01 08:00/)
  assert.match(await user.locator('.competition-detail').innerText(), /循环赛，每队依次交手/)
  check('publish exposes actual form fields and Beijing registration times without opening registration')

  await registration().click(); await registration().filter({ hasText: '已开启' }).waitFor(); await refresh()
  assert.match(await user.locator('.competition-detail').innerText(), /报名开放中/)
  await registration().click(); await registration().filter({ hasText: '已关闭' }).waitFor(); await refresh()
  assert.match(await user.locator('.competition-detail').innerText(), /报名未开放/)
  assert.equal(await visibility().getAttribute('aria-checked'), 'true')
  check('registration changes independently and detail refresh reflects real server state')

  await card().getByRole('button', { name: '编辑赛事' }).click()
  await admin.locator('#competition-name').fill('联调测试·更新后的赛事'); await save(); await refresh()
  await user.getByText('联调测试·更新后的赛事', { exact: true }).waitFor()
  await admin.getByRole('button', { name: '刷新列表' }).click(); await card().waitFor()
  memory.records.get(id).version++
  await visibility().click(); await admin.getByRole('alert').filter({ hasText: '其他页面更新' }).waitFor()
  assert.equal(memory.records.get(id).displayEnabled, true)
  await admin.getByRole('button', { name: '刷新列表' }).click(); await admin.getByRole('button', { name: '刷新列表' }).waitFor({ state: 'visible' })
  await admin.waitForFunction(() => !document.querySelector('.competition-actions button').disabled)
  check('edits reach the public detail and stale versions fail with a conflict')

  for (const width of [390, 320]) {
    await admin.setViewportSize({ width, height: 844 }); await user.setViewportSize({ width, height: 844 })
    await noOverflow(admin); await noOverflow(user)
    await admin.bringToFront()
    await admin.screenshot({ path: `${out}/admin-${width}.png`, animations: 'disabled', timeout: 10_000 })
    await user.bringToFront()
    await user.screenshot({ path: `${out}/detail-${width}.png`, fullPage: true, animations: 'disabled', timeout: 10_000 })
    await card().getByRole('button', { name: '编辑赛事' }).click(); await noOverflow(admin)
    await admin.getByRole('button', { name: '取消', exact: true }).click()
    await admin.getByRole('button', { name: '账号与访问', exact: true }).click()
    await admin.getByRole('button', { name: '退出登录', exact: true }).waitFor()
    await admin.getByRole('button', { name: '赛事管理', exact: true }).click(); await card().waitFor()
    await user.goto(publicBase + '/#/pages/index/index?tab=tournament', { waitUntil: 'networkidle' })
    await user.locator('.public-competition-card').waitFor(); await noOverflow(user)
    await user.locator('.public-competition-card').click(); await user.locator('.competition-intro').waitFor()
    check(`${width}px competition form, switches and public detail avoid page overflow`)
  }
  memory.failures.read = true; await refresh()
  await user.getByText('赛事服务暂不可用，请稍后重试。', { exact: true }).waitFor()
  assert.equal(await user.locator('.competition-intro').count(), 0)
  memory.failures.read = false; await refresh(); await user.locator('.competition-intro').waitFor()
  check('failed detail refresh clears old content and recovery reads the real service')

  await visibility().click(); await visibility().filter({ hasText: '已隐藏' }).waitFor(); await refresh()
  await user.getByText('赛事不存在或暂未公开。', { exact: true }).waitFor()
  assert.equal(await user.locator('.competition-intro').count(), 0)
  await user.goto(publicBase + '/#/pages/index/index?tab=tournament', { waitUntil: 'networkidle' })
  await user.getByText('暂无公开赛事', { exact: true }).waitFor()
  check('hiding removes published competition from list and direct detail on refresh')
  assert.deepEqual(errors, [])
  await writeFile(`${out}/report.json`, JSON.stringify({ checks, errors, validation: 'Real Vue admin/H5 pages and HTTPS auth/competition handlers with isolated transactional memory stores; not cloud deployment evidence.', generatedAt: new Date().toISOString() }, null, 2))
  console.log(`Verified ${checks.length} competition browser flows.`)
} catch (e) {
  await admin.locator('#password').fill('', { timeout: 500 }).catch(() => {})
  await admin.screenshot({ path: `${out}/failure-admin.png`, fullPage: true }).catch(() => {})
  await user.screenshot({ path: `${out}/failure-public.png`, fullPage: true }).catch(() => {})
  await writeFile(`${out}/failure.txt`, (await admin.locator('body').innerText()) + '\nPUBLIC\n' + (await user.locator('body').innerText()))
  throw e
} finally {
  await browser.close(); await vite.close()
  try { process.kill(-publicServer.pid, 'SIGTERM') } catch {}
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(certDir, { recursive: true, force: true })
}
