import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { createServer as createHttpsServer } from 'node:https'
import { createServer as createViteServer } from 'vite'
import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { createAdminService, createAccount } = require('../cloudfunctions/adminAuth/service.js')
const { createApplicationRouter, createCompetitionService, PUBLIC_ACTIONS: COMPETITION_PUBLIC_ACTIONS } = require('../cloudfunctions/adminAuth/competitions.js')
const { createMatchService, PUBLIC_ACTIONS: MATCH_PUBLIC_ACTIONS } = require('../cloudfunctions/adminAuth/matches.js')
const { createAdminTeamService } = require('../cloudfunctions/adminAuth/teams.js')
const { createAdminRegistrationService } = require('../cloudfunctions/adminAuth/registrations.js')
const { registrationId } = require('../cloudfunctions/adminAuth/registration-model.js')
const { createMatchMemoryStore } = require('../tests/helpers/match-store.cjs')
const { createHttpHandler } = require('../cloudfunctions/adminAuth/http.js')
const { createCompetitionMemoryStore } = require('../tests/helpers/competition-store.cjs')
const { createMemoryStore } = require('../tests/helpers/admin-store.cjs')

const out = 'artifacts/matches'
await fs.mkdir(out, { recursive: true })
const now = Date.parse('2026-11-11T00:00:00.000Z')
const password = randomBytes(24).toString('base64url')
const authMemory = createMemoryStore(await createAccount('admin', password, now))
const auth = createAdminService({ store: authMemory.store, now: () => now, logger: { error() {} } })
const competitionMemory = createCompetitionMemoryStore()
const cid = 'c_' + '1'.repeat(32)
const home = 't_' + 'a'.repeat(64)
const away = 't_' + 'b'.repeat(64)
const pending = 't_' + 'f'.repeat(64)
const timestamp = new Date(now).toISOString()
competitionMemory.records.set(cid, { _id: cid, name: 'D06真实赛程联调赛', description: '后台赛程页面与前台公开赛程联调。', format: 'round_robin', formatDescription: '循环赛。', startDate: '2026-11-20', endDate: '2026-12-01', venue: '社区足球场', registrationRequirements: '提交完整球队资料。', registrationStartAt: null, registrationEndAt: null, registrationEnabled: false, displayEnabled: true, registrationStats: { pending: 0, approved: 0, occupied: 0 }, registrationRulesVersion: 1, version: 1, createdAt: timestamp, updatedAt: timestamp })
const teamRecords = new Map([
  [home, { _id: home, name: '江湾联队', district: '虹口区', description: '', contactPhone: '021-11112222', status: 'active', version: 1, roster: [], createdAt: timestamp, updatedAt: timestamp, leaderUserId: 'u-home' }],
  [away, { _id: away, name: '徐汇星火', district: '徐汇区', description: '', contactPhone: '021-33334444', status: 'active', version: 1, roster: [], createdAt: timestamp, updatedAt: timestamp, leaderUserId: 'u-away' }],
  [pending, { _id: pending, name: '尚未审核球队', district: '杨浦区', description: '', contactPhone: '021-33335555', status: 'active', version: 1, roster: [], createdAt: timestamp, updatedAt: timestamp, leaderUserId: 'u-pending' }],
])
const users = new Map([['u-home', { nickname: '江湾领队' }], ['u-away', { nickname: '星火领队' }]])
const copy = value => value == null ? value : structuredClone(value)
const registrationRecords = new Map([...teamRecords.values()].map(team => {
  const id = registrationId(cid, team._id)
  return [id, { _id: id, competitionId: cid, teamId: team._id, status: team._id === pending ? 'pending' : 'approved', version: 1,
    form: { teamName: team.name, district: team.district, project: '社区组', leaderName: '演示领队', contactPhone: team.contactPhone },
    competitionSnapshot: { name: 'D06真实赛程联调赛', requirements: '完整材料', minPlayers: 5, maxPlayers: 18 },
    attachments: [{ id: 'f_' + '1'.repeat(32), name: '测试材料.pdf', size: 100, extension: 'pdf' }], createdAt: timestamp, submittedAt: timestamp, updatedAt: timestamp }]
}))
const { store: matchStore, records: matchRecords } = createMatchMemoryStore({ competitions: competitionMemory.records, teams: teamRecords, registrations: registrationRecords })
const registrationService = createAdminRegistrationService({ authorize: token => auth({ action: 'session', token }), store: {
  competition: matchStore.competition,
  async list({ competitionId, status, cursor, limit }) { return [...registrationRecords.values()].filter(record => record.competitionId === competitionId && (!status || record.status === status) && (!cursor || record._id > cursor)).sort((a, b) => a._id.localeCompare(b._id)).slice(0, limit).map(copy) },
}, logger: { error() {} } })
const teamService = createAdminTeamService({ authorize: token => auth({ action: 'session', token }), store: { async list(cursor, limit) { return [...teamRecords.values()].filter(record => !cursor || record._id > cursor).sort((a, b) => a._id.localeCompare(b._id)).slice(0, limit).map(copy) }, async read(id) { return copy(teamRecords.get(id)) }, async user(id) { return copy(users.get(id)) } }, logger: { error() {} } })
const competitions = createCompetitionService({ store: competitionMemory.store, authorize: token => auth({ action: 'session', token }), now: () => now, logger: { error() {} } })
const matches = createMatchService({ store: matchStore, authorize: token => auth({ action: 'session', token }), now: () => now, logger: { error() {} } })
const baseRouter = createApplicationRouter(auth, competitions)
let failPublicRead = false
const router = event => {
  if (event?.action === 'matches.listPublic' && failPublicRead) { failPublicRead = false; return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '赛程服务暂不可用，请重新加载。' } } }
  return event?.action?.startsWith('registrations.') ? registrationService(event) : event?.action?.startsWith('teams.') ? teamService(event) : event?.action?.startsWith('matches.') ? matches(event) : baseRouter(event)
}
const adminOrigin = 'http://127.0.0.1:5176', publicOrigin = 'http://127.0.0.1:5178'
const certDir = await fs.mkdtemp('/tmp/community-football-matches-')
const { execFileSync } = await import('node:child_process')
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${certDir}/key.pem`, '-out', `${certDir}/cert.pem`, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })
const http = createHttpHandler(router, [adminOrigin, publicOrigin], [...COMPETITION_PUBLIC_ACTIONS, ...MATCH_PUBLIC_ACTIONS])
const server = createHttpsServer({ key: await readFile(`${certDir}/key.pem`), cert: await readFile(`${certDir}/cert.pem`) }, async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; const result = await http({ httpMethod: req.method, headers: req.headers, body }); res.writeHead(result.statusCode, result.headers); res.end(result.body) })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const apiUrl = `https://127.0.0.1:${server.address().port}/api`
process.env.VITE_ADMIN_API_URL = apiUrl
await fs.mkdir('.tools', { recursive: true })
const publicConfig = resolve('.tools/d06-public.vite.config.ts')
await fs.writeFile(publicConfig, "import base from '../vite.config'; export default env => ({ ...base(env), cacheDir: '.tools/d06-public-vite-cache', server: { host: '127.0.0.1', port: 5178, strictPort: true, hmr: false } })\n")
const adminVite = await createViteServer({ configFile: 'admin/vite.config.ts', mode: 'test', cacheDir: resolve('.tools/d06-admin-vite-cache'), server: { host: '127.0.0.1', port: 5176, strictPort: true, hmr: false } }); await adminVite.listen()
const { spawn } = await import('node:child_process')
const publicServer = spawn('node', ['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js', '--config', publicConfig, '--host', '127.0.0.1', '--port', '5178'], { detached: true, env: { ...process.env, CHOKIDAR_USEPOLLING: 'true', VITE_COMPETITION_API_URL: apiUrl }, stdio: ['ignore', 'pipe', 'pipe'] })
let publicLog = ''; publicServer.stdout.on('data', chunk => { publicLog += chunk }); publicServer.stderr.on('data', chunk => { publicLog += chunk })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', ignoreHTTPSErrors: true })
const admin = await context.newPage(), user = await context.newPage(); context.setDefaultTimeout(15_000)
const errors = [], checks = []; for (const page of [admin, user]) page.on('pageerror', error => errors.push(error.message))
const check = name => { checks.push(name); console.log(`PASS ${name}`) }
try {
  const unauthenticated = await context.request.post(apiUrl, { data: { action: 'matches.listAdmin', competitionId: cid } })
  assert.equal(unauthenticated.status(), 401)
  const publicResponse = await context.request.post(apiUrl, { data: { action: 'matches.listPublic', competitionId: cid } })
  assert.equal(publicResponse.status(), 200); check('公开查询无需登录，管理赛程接口拒绝未授权请求')
  await admin.goto(adminOrigin, { waitUntil: 'networkidle' }); await admin.getByLabel('管理员账号', { exact: true }).fill('admin'); await admin.getByLabel('登录密码', { exact: true }).fill(password); await admin.getByRole('button', { name: '登录管理后台' }).click(); await admin.locator('.workspace').waitFor(); await admin.getByRole('button', { name: '赛程与对阵', exact: true }).click(); await admin.locator('.matches-admin').waitFor(); await admin.getByRole('button', { name: '新增比赛', exact: true }).click()
  await admin.locator('#match-home').waitFor(); assert.equal(await admin.locator('#match-home option').count(), 3); assert.equal(await admin.locator('#match-home').innerText().then(text => text.includes('尚未审核球队')), false); check('后台仅提供本赛事报名审核已通过的球队')
  await admin.locator('#match-stage').selectOption('group'); await admin.locator('#match-round').fill('1'); await admin.locator('#match-group').fill('A组'); await admin.locator('#match-home').selectOption(home); await admin.locator('#match-away').selectOption(away); await admin.locator('#match-time').fill('2026-11-20T16:00'); await admin.locator('#match-venue').fill('社区足球场'); await admin.getByRole('button', { name: '保存比赛', exact: true }).click(); await admin.getByText('比赛已排入赛程。', { exact: true }).waitFor(); assert.equal(matchRecords.size, 1); check('后台可以创建真实赛程并写入事务存储')
  await admin.getByRole('button', { name: '编辑', exact: true }).click(); await admin.locator('#match-time').fill('2026-11-20T17:00'); await admin.locator('#match-status').selectOption('postponed'); await admin.getByRole('button', { name: '保存比赛', exact: true }).click(); await admin.getByText('赛程已保存。', { exact: true }).waitFor(); assert.equal([...matchRecords.values()][0].status, 'postponed'); check('后台编辑使用版本控制并能标记延期')
  const firstId = [...matchRecords.keys()][0]
  await admin.getByRole('button', { name: '新增比赛', exact: true }).click(); await admin.locator('#match-home').selectOption(home); await admin.locator('#match-away').selectOption(away); await admin.locator('#match-time').fill('2026-11-21T01:00'); await admin.locator('#match-venue').fill('凌晨测试球场'); await admin.getByRole('button', { name: '保存比赛', exact: true }).click(); await admin.locator('.competition-form').waitFor({ state: 'hidden' })
  await admin.getByRole('button', { name: '新增比赛', exact: true }).click(); await admin.locator('#match-stage').selectOption('semi'); await admin.locator('#match-home-from').selectOption(firstId); await admin.locator('#match-time').fill('2026-11-22T15:00'); await admin.locator('#match-venue').fill('淘汰赛球场'); await admin.getByRole('button', { name: '保存比赛', exact: true }).click(); await admin.locator('.competition-form').waitFor({ state: 'hidden' }); assert.equal(matchRecords.size, 3); check('后台可安排北京时间凌晨比赛及选择前序比赛作为晋级来源')
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await context.request.get(publicOrigin)).ok()) break } catch {}
    if (attempt === 99) throw new Error('Public Vite server did not start: ' + publicLog)
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  await user.goto(`${publicOrigin}/#/pages/index/index?tab=tournament`, { waitUntil: 'networkidle' }); await user.getByRole('button', { name: '真实赛程', exact: true }).click(); await user.locator('.public-schedule .schedule-picker').first().getByText('D06真实赛程联调赛', { exact: true }).waitFor(); await user.locator('.public-schedule-card').filter({ hasText: '2026-11-20 17:00' }).getByText('已延期', { exact: true }).waitFor(); assert.equal(await user.locator('.public-schedule-card').count(), 3); check('前台完整赛程读取公开赛事、真实队名、北京时间和延期状态')
  await user.locator('.schedule-picker-control').nth(1).click(); await user.locator('.uni-picker-select:visible .uni-picker-item').getByText('徐汇星火', { exact: true }).click(); await user.locator('.schedule-day-heading').getByText('2 场比赛', { exact: true }).waitFor(); assert.equal(await user.locator('.public-schedule-card').count(), 2); check('单队筛选默认展示该队全部日期的比赛')
  await user.locator('#schedule-date-2026-11-21').click(); await user.locator('.schedule-day-heading').getByText('1 场比赛', { exact: true }).waitFor(); assert.match(await user.locator('.public-schedule-list').innerText(), /2026-11-21 01:00/); check('北京时间凌晨比赛归入正确日期')
  await user.locator('.filter-chips').getByRole('button', { name: '已延期', exact: true }).click(); await user.getByText('当前筛选下没有比赛', { exact: true }).waitFor(); await user.getByRole('button', { name: '清除筛选', exact: true }).click(); await user.locator('.schedule-day-heading').getByText('3 场比赛', { exact: true }).waitFor(); check('日期、球队和状态组合筛选及清除筛选可用')
  await user.locator('.filter-chips').getByRole('button', { name: '已延期', exact: true }).click(); await user.getByRole('button', { name: '刷新赛程', exact: true }).click(); await user.locator('.schedule-day-heading').getByText('1 场比赛', { exact: true }).waitFor(); check('刷新保留赛事与状态筛选')
  failPublicRead = true; await user.getByRole('button', { name: '刷新赛程', exact: true }).click(); await user.getByRole('button', { name: '重新加载赛程', exact: true }).waitFor(); assert.equal(await user.locator('.public-schedule-card').count(), 0); await user.getByRole('button', { name: '重新加载赛程', exact: true }).click(); await user.locator('.public-schedule-card').waitFor(); check('公开请求失败时不展示旧赛程，并支持重新加载')
  for (const width of [390, 320]) { await admin.setViewportSize({ width, height: 844 }); await user.setViewportSize({ width, height: 844 }); assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); assert.equal(await user.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await admin.screenshot({ path: `${out}/admin-${width}.png`, fullPage: true }); await user.screenshot({ path: `${out}/public-${width}.png`, fullPage: true }); check(`${width}px后台和前台赛程页面无横向溢出`) }
  assert.deepEqual(errors, [])
  await fs.writeFile(`${out}/report.json`, JSON.stringify({ checks, errors, validation: 'Isolated HTTPS API with transactional auth, competition, team and match stores; not cloud deployment evidence.', generatedAt: new Date().toISOString() }, null, 2))
  console.log(`Verified ${checks.length} D06 browser flows.`)
} catch (error) { await fs.writeFile(`${out}/failure.txt`, (await admin.locator('body').innerText().catch(() => '')) + '\nPUBLIC\n' + (await user.locator('body').innerText().catch(() => '')) + '\nERRORS\n' + JSON.stringify(errors) + '\nLOG\n' + publicLog); throw error } finally { await browser.close(); await adminVite.close(); try { process.kill(-publicServer.pid, 'SIGTERM') } catch {} server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(certDir, { recursive: true, force: true }) }
