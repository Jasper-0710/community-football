import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { createServer as createHttpServer } from 'node:http'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createServer as createViteServer } from 'vite'
import { chromium } from 'playwright'

const require = createRequire(import.meta.url)
const { createAdminService, createAccount, SESSION_MS } = require('../cloudfunctions/adminAuth/service.js')
const { createHttpHandler } = require('../cloudfunctions/adminAuth/http.js')
const { createMemoryStore } = require('../tests/helpers/admin-store.cjs')
const out = 'artifacts/admin'
await fs.mkdir(out, { recursive: true })
const testPassword = randomBytes(24).toString('base64url')
let clock = Date.now()
const memory = createMemoryStore(await createAccount('admin', testPassword, clock))
const service = createAdminService({ store: memory.store, now: () => clock, logger: { error() {} } })
const base = 'http://127.0.0.1:5176'
const http = createHttpHandler(service, [base])
const server = createHttpServer(async (req, res) => {
  try {
    let body = ''
    for await (const chunk of req) { body += chunk.toString(); if (body.length > 8192) { res.writeHead(413).end(); return } }
    const result = await http({ httpMethod: req.method, headers: req.headers, body })
    res.writeHead(result.statusCode, result.headers); res.end(result.body)
  } catch { res.writeHead(500).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const apiUrl = `http://127.0.0.1:${server.address().port}/admin`
process.env.VITE_ADMIN_API_URL = apiUrl
const vite = await createViteServer({ configFile: 'admin/vite.config.ts', mode: 'test', server: { host: '127.0.0.1', port: 5176, strictPort: true, watch: { usePolling: true, interval: 250 }, hmr: false } })
await vite.listen()
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
const page = await context.newPage()
const errors = [], checks = []
page.on('pageerror', e => errors.push(e.message))
const check = name => { checks.push(name); console.log(`PASS ${name}`) }
const shot = name => page.screenshot({ path: `${out}/${name}.png`, fullPage: true })
const fillLogin = async () => {
  await page.getByLabel('管理员账号', { exact: true }).fill('admin')
  await page.getByLabel('登录密码', { exact: true }).fill(testPassword)
  await page.getByRole('button', { name: '登录管理后台' }).click()
  await page.locator('.workspace').waitFor()
}
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
try {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: '管理员登录' }).waitFor()
  await noOverflow(); await shot('login-desktop')
  assert.equal(await page.locator('.workspace').count(), 0)
  check('guest cannot view the workbench')

  await page.getByLabel('管理员账号', { exact: true }).fill('admin')
  await page.getByLabel('登录密码', { exact: true }).fill('incorrect')
  await page.getByRole('button', { name: '登录管理后台' }).click()
  await page.getByText('账号或密码不正确。', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('登录密码', { exact: true }).inputValue(), '')
  assert.equal(await page.locator('.workspace').count(), 0)
  check('wrong password is verified by the actual service and cleared from the form')

  await fillLogin(); await shot('workspace-desktop')
  const originalToken = await page.evaluate(() => sessionStorage.getItem('community-football.admin.session.v1'))
  assert.match(originalToken, /^[a-f0-9]{64}$/)
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('admin.session')), false)
  check('login opens a separately authorized workbench without mock business counts')

  await page.reload({ waitUntil: 'networkidle' }); await page.locator('.workspace').waitFor()
  check('refresh restores the session only after server validation')

  memory.failures.read = true
  await page.getByRole('button', { name: '检查登录状态' }).click()
  await page.getByRole('heading', { name: '暂时无法确认登录状态' }).waitFor()
  assert.equal(await page.locator('.workspace').count(), 0)
  memory.failures.read = false
  await page.getByRole('button', { name: '重新连接' }).click(); await page.locator('.workspace').waitFor()
  check('server failure hides account data and reconnection restores it')

  await context.setOffline(true)
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await page.getByText(/退出尚未完成/).waitFor()
  assert.equal(await page.locator('.workspace').count(), 1)
  await context.setOffline(false)
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await page.getByRole('heading', { name: '管理员登录' }).waitFor()
  assert.equal((await service({ action: 'overview', token: originalToken })).error.code, 'UNAUTHORIZED')
  assert.equal(await page.evaluate(() => sessionStorage.getItem('community-football.admin.session.v1')), null)
  check('failed logout stays visible; retry revokes the old token on the server')

  await page.evaluate(() => sessionStorage.setItem('community-football.admin.session.v1', 'a'.repeat(64)))
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: '管理员登录' }).waitFor()
  assert.equal(await page.locator('.workspace').count(), 0)
  check('forged session storage cannot enter the workbench')

  await fillLogin()
  clock += SESSION_MS
  await page.getByRole('button', { name: '检查登录状态' }).click()
  await page.getByRole('heading', { name: '管理员登录' }).waitFor()
  await page.getByText('登录已失效，请重新登录。', { exact: true }).waitFor()
  check('server-side expiration returns the user to login')

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await noOverflow(); await shot(`login-${width}`)
    await fillLogin(); await noOverflow(); await shot(`workspace-${width}`)
    await page.getByRole('button', { name: '退出登录', exact: true }).click()
    await page.getByRole('heading', { name: '管理员登录' }).waitFor()
    check(`${width}px login and workbench support real interactions without page overflow`)
  }
  assert.deepEqual(errors, [])
  await fs.writeFile(`${out}/report.json`, JSON.stringify({ checks, errors, validation: 'Actual HTTP/auth handlers with an isolated transactional test store; not cloud deployment evidence.', browser: await browser.version(), generatedAt: new Date().toISOString() }, null, 2))
  console.log(`Verified ${checks.length} admin browser flows.`)
} catch (e) {
  // Password field is explicitly cleared before taking any failure screenshot.
  await page.locator('#password').fill('').catch(() => {})
  await shot('failure').catch(() => {})
  throw e
} finally {
  await browser.close()
  await vite.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
