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
const { createStandingsService, PUBLIC_ACTIONS: STANDINGS_PUBLIC_ACTIONS } = require('../cloudfunctions/adminAuth/standings.js')
const { createAdminTeamService } = require('../cloudfunctions/adminAuth/teams.js')
const { createAdminRegistrationService } = require('../cloudfunctions/adminAuth/registrations.js')
const { registrationId } = require('../cloudfunctions/adminAuth/registration-model.js')
const { createMatchMemoryStore } = require('../tests/helpers/match-store.cjs')
const { createHttpHandler } = require('../cloudfunctions/adminAuth/http.js')
const { createCompetitionMemoryStore } = require('../tests/helpers/competition-store.cjs')
const { createMemoryStore } = require('../tests/helpers/admin-store.cjs')

const out = 'artifacts/standings'
const skipScreenshots = process.env.SKIP_SCREENSHOTS === '1'
async function capture(page, name) { if (!skipScreenshots) await page.screenshot({ path: `${out}/${name}`, fullPage: true }) }
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
const third = 't_' + 'c'.repeat(64), fourth = 't_' + 'd'.repeat(64)
const pid = n => 'p_' + n.toString(16).padStart(32, '0')
const timestamp = new Date(now).toISOString()
competitionMemory.records.set(cid, { _id: cid, name: 'D08榜单联动测试赛', description: '后台赛程页面与前台公开赛程联调。', format: 'group_knockout', formatDescription: '循环赛。', startDate: '2026-11-20', endDate: '2026-12-01', venue: '社区足球场', registrationRequirements: '提交完整球队资料。', registrationStartAt: null, registrationEndAt: null, registrationEnabled: false, displayEnabled: true, registrationStats: { pending: 0, approved: 0, occupied: 0 }, registrationRulesVersion: 1, version: 1, createdAt: timestamp, updatedAt: timestamp })
const teamRecords = new Map([
  [home, { _id: home, name: '江湾联队', district: '虹口区', description: '', contactPhone: '021-11112222', status: 'active', version: 1, roster: [], createdAt: timestamp, updatedAt: timestamp, leaderUserId: 'u-home' }],
  [away, { _id: away, name: '徐汇星火', district: '徐汇区', description: '', contactPhone: '021-33334444', status: 'active', version: 1, roster: [], createdAt: timestamp, updatedAt: timestamp, leaderUserId: 'u-away' }],
  [pending, { _id: pending, name: '尚未审核球队', district: '杨浦区', description: '', contactPhone: '021-33335555', status: 'active', version: 1, roster: [], createdAt: timestamp, updatedAt: timestamp, leaderUserId: 'u-pending' }],
])
for (const [id, name, district] of [[third, '浦东远航', '浦东新区'], [fourth, '静安绿茵', '静安区']]) teamRecords.set(id, { ...teamRecords.get(home), _id: id, name, district, leaderUserId: 'u-' + id.slice(-4) })
for (const [index, team] of [...teamRecords.values()].entries()) team.roster = [{ id: pid(index * 2 + 1), name: team.name + '前锋', number: 9, position: 'forward' }, { id: pid(index * 2 + 2), name: team.name + '中场', number: 10, position: 'midfielder' }]
const users = new Map([['u-home', { nickname: '江湾领队' }], ['u-away', { nickname: '星火领队' }]])
const copy = value => value == null ? value : structuredClone(value)
const registrationRecords = new Map([...teamRecords.values()].map(team => {
  const id = registrationId(cid, team._id)
  return [id, { _id: id, competitionId: cid, teamId: team._id, status: team._id === pending ? 'pending' : 'approved', version: 1,
    form: { teamName: team.name, district: team.district, project: '社区组', leaderName: '演示领队', contactPhone: team.contactPhone },
    competitionSnapshot: { name: 'D08榜单联动测试赛', requirements: '完整材料', minPlayers: 5, maxPlayers: 18 },
    attachments: [{ id: 'f_' + '1'.repeat(32), name: '测试材料.pdf', size: 100, extension: 'pdf' }], createdAt: timestamp, submittedAt: timestamp, updatedAt: timestamp }]
}))
const { store: matchStore, standingsStore, records: matchRecords } = createMatchMemoryStore({ competitions: competitionMemory.records, teams: teamRecords, registrations: registrationRecords })
const registrationService = createAdminRegistrationService({ authorize: token => auth({ action: 'session', token }), store: {
  competition: matchStore.competition,
  async list({ competitionId, status, cursor, limit }) { return [...registrationRecords.values()].filter(record => record.competitionId === competitionId && (!status || record.status === status) && (!cursor || record._id > cursor)).sort((a, b) => a._id.localeCompare(b._id)).slice(0, limit).map(copy) },
}, logger: { error() {} } })
const teamService = createAdminTeamService({ authorize: token => auth({ action: 'session', token }), store: { async list(cursor, limit) { return [...teamRecords.values()].filter(record => !cursor || record._id > cursor).sort((a, b) => a._id.localeCompare(b._id)).slice(0, limit).map(copy) }, async read(id) { return copy(teamRecords.get(id)) }, async user(id) { return copy(users.get(id)) } }, logger: { error() {} } })
const competitions = createCompetitionService({ store: competitionMemory.store, authorize: token => auth({ action: 'session', token }), now: () => now, logger: { error() {} } })
const matches = createMatchService({ store: matchStore, authorize: token => auth({ action: 'session', token }), now: () => now, logger: { error() {} } })
const statistics = createStandingsService({ store: standingsStore, authorize: token => auth({ action: 'session', token }), now: () => now, logger: { error() {} } })
const baseRouter = createApplicationRouter(auth, competitions)
let failPublicRead = false
const router = event => {
  if (event?.action === 'standings.getPublic' && failPublicRead) { failPublicRead = false; return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '榜单服务暂不可用，请重新加载。' } } }
  return event?.action?.startsWith('standings.') ? statistics(event) : event?.action?.startsWith('registrations.') ? registrationService(event) : event?.action?.startsWith('teams.') ? teamService(event) : event?.action?.startsWith('matches.') ? matches(event) : baseRouter(event)
}
const adminOrigin = 'http://127.0.0.1:5180', publicOrigin = 'http://127.0.0.1:5182'
const certDir = await fs.mkdtemp('/tmp/community-football-standings-')
const { execFileSync } = await import('node:child_process')
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${certDir}/key.pem`, '-out', `${certDir}/cert.pem`, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })
const http = createHttpHandler(router, [adminOrigin, publicOrigin], [...COMPETITION_PUBLIC_ACTIONS, ...MATCH_PUBLIC_ACTIONS, ...STANDINGS_PUBLIC_ACTIONS])
const server = createHttpsServer({ key: await readFile(`${certDir}/key.pem`), cert: await readFile(`${certDir}/cert.pem`) }, async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; const result = await http({ httpMethod: req.method, headers: req.headers, body }); res.writeHead(result.statusCode, result.headers); res.end(result.body) })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const apiUrl = `https://127.0.0.1:${server.address().port}/api`
process.env.VITE_ADMIN_API_URL = apiUrl
await fs.mkdir('.tools', { recursive: true })
const publicConfig = resolve('.tools/d08-public.vite.config.ts')
await fs.writeFile(publicConfig, "import base from '../vite.config'; export default env => ({ ...base(env), cacheDir: '.tools/d08-public-vite-cache', server: { host: '127.0.0.1', port: 5182, strictPort: true, hmr: false } })\n")
const adminVite = await createViteServer({ configFile: 'admin/vite.config.ts', mode: 'test', cacheDir: resolve('.tools/d08-admin-vite-cache'), server: { host: '127.0.0.1', port: 5180, strictPort: true, hmr: false } }); await adminVite.listen()
const { spawn } = await import('node:child_process')
const publicServer = spawn('node', ['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js', '--config', publicConfig, '--host', '127.0.0.1', '--port', '5182'], { detached: true, env: { ...process.env, CHOKIDAR_USEPOLLING: 'true', VITE_COMPETITION_API_URL: apiUrl }, stdio: ['ignore', 'pipe', 'pipe'] })
let publicLog = ''; publicServer.stdout.on('data', chunk => { publicLog += chunk }); publicServer.stderr.on('data', chunk => { publicLog += chunk })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', ignoreHTTPSErrors: true })
const admin = await context.newPage(), user = await context.newPage(); context.setDefaultTimeout(15_000)
const errors = [], checks = []; for (const page of [admin, user]) page.on('pageerror', error => errors.push(error.message))
const check = name => { checks.push(name); console.log(`PASS ${name}`) }
const login = await auth({ action: 'login', username: 'admin', password })
assert.equal(login.ok, true)
async function seedMatch(n, form) {
  const r = await matches({ action: 'matches.create', token: login.token, requestId: n.toString(16).padStart(32, '0'), form: { competitionId: cid, stage: 'group', round: 1, groupId: 'A组', slot: null, homeTeamId: home, awayTeamId: away, homeFrom: null, awayFrom: null, scheduledAt: '2026-11-20T08:00:00.000Z', venue: '社区足球场', status: 'scheduled', ...form } })
  assert.equal(r.ok, true, JSON.stringify(r)); return r.match.id
}
const firstId = await seedMatch(1, {})
const secondId = await seedMatch(2, { groupId: 'B组', homeTeamId: third, awayTeamId: fourth })
const finalId = await seedMatch(3, { stage: 'final', groupId: null, homeTeamId: null, awayTeamId: null, scheduledAt: '2026-11-22T08:00:00.000Z' })
const teamPlayer = (id, index) => teamRecords.get(id).roster[index].id
async function fillGoals(ids, assists = true) {
  for (let i = 0; i < ids.length; i++) {
    await admin.locator(`#goal-minute-${i}`).fill(String(15 + i * 20))
    await admin.locator(`#goal-scorer-${i}`).selectOption(teamPlayer(ids[i], 0))
    if (assists) await admin.locator(`#goal-assist-${i}`).selectOption(teamPlayer(ids[i], 1))
  }
}
function matchRow(text) { return admin.locator('.standings-match-row').filter({ has: admin.getByRole('heading', { name: text, exact: true }) }) }
async function score(row, hs, as, ids, reason = '技术台确认赛果', penalties) {
  await row.getByRole('button', { name: /^(录入赛果|更正赛果)$/ }).click()
  await admin.locator('#result-state').selectOption('finished'); await admin.locator('#result-minute').fill('90')
  await admin.locator('#result-home').fill(String(hs)); await admin.locator('#result-away').fill(String(as))
  if (penalties) { await admin.locator('#result-home-penalty').fill(String(penalties[0])); await admin.locator('#result-away-penalty').fill(String(penalties[1])) }
  await admin.getByRole('button', { name: '按比分生成进球记录', exact: true }).click(); await fillGoals(ids)
  await admin.locator('#result-reason').fill(reason); await admin.getByRole('button', { name: '保存并发布赛果', exact: true }).click()
}
async function saved() { await admin.getByText('赛果已保存，榜单和晋级对阵已同步更新。', { exact: true }).waitFor(); await admin.locator('.result-editor').waitFor({ state: 'hidden' }) }
try {
  const unauthenticated = await context.request.post(apiUrl, { data: { action: 'standings.getAdmin', competitionId: cid } })
  assert.equal(unauthenticated.status(), 401)
  const publicResponse = await context.request.post(apiUrl, { data: { action: 'standings.getPublic', competitionId: cid } }); assert.equal(publicResponse.status(), 200)
  check('公开榜单允许游客读取，管理接口拒绝未登录请求')
  await admin.goto(adminOrigin, { waitUntil: 'networkidle' }); await admin.getByLabel('管理员账号', { exact: true }).fill('admin'); await admin.getByLabel('登录密码', { exact: true }).fill(password); await admin.getByRole('button', { name: '登录管理后台' }).click(); await admin.locator('.workspace').waitFor(); await admin.getByRole('button', { name: '榜单与晋级', exact: true }).click(); await admin.locator('.standings-match-row').first().waitFor()
  await admin.getByRole('button', { name: '积分与分组', exact: true }).click()
  for (const [index, name, ids] of [[0, 'A组', [home, away]], [1, 'B组', [third, fourth]]]) {
    await admin.getByRole('button', { name: '添加分组', exact: true }).click(); await admin.locator(`#rules-group-${index}`).fill(name)
    const group = admin.locator('.standings-group-editor').nth(index)
    for (const id of ids) await group.getByLabel(teamRecords.get(id).name, { exact: true }).check()
  }
  assert.equal(await admin.locator('.standings-group-editor').first().getByText('尚未审核球队', { exact: true }).count(), 0)
  await admin.getByRole('button', { name: '保存积分与分组', exact: true }).click(); await admin.getByText('积分与分组已保存，榜单和晋级对阵已重新计算。', { exact: true }).waitFor(); check('后台可配置审核参赛队分组及积分规则')
  await admin.getByRole('button', { name: '晋级来源', exact: true }).click(); await admin.getByRole('button', { name: '设置分组来源', exact: true }).click()
  await admin.locator('#qualification-home').selectOption(JSON.stringify({ groupId: 'A组', rank: 1 })); await admin.locator('#qualification-away').selectOption(JSON.stringify({ groupId: 'B组', rank: 1 })); await admin.getByRole('button', { name: '保存晋级来源', exact: true }).click(); await admin.getByText('晋级来源已保存，待定对阵已更新。', { exact: true }).waitFor(); check('决赛签位可绑定小组名次，未完赛时保持待定')
  await admin.getByRole('button', { name: '赛果与事件', exact: true }).click()
  await matchRow('江湾联队 vs 徐汇星火').getByRole('button', { name: '录入赛果', exact: true }).click()
  await admin.locator('#result-state').selectOption('live'); await admin.locator('#result-minute').fill('35')
  await admin.locator('#result-home').fill('1'); await admin.locator('#result-away').fill('0')
  await admin.getByRole('button', { name: '按比分生成进球记录', exact: true }).click(); await fillGoals([home])
  for (const [index, teamId, minute, kind, playerIndex] of [[0, home, 20, 'yellow', 1], [1, away, 28, 'red', 0]]) {
    await admin.getByRole('button', { name: '添加牌面', exact: true }).click()
    await admin.locator(`#card-team-${index}`).selectOption(teamId); await admin.locator(`#card-minute-${index}`).fill(String(minute))
    await admin.locator(`#card-kind-${index}`).selectOption(kind); await admin.locator(`#card-player-${index}`).selectOption(teamPlayer(teamId, playerIndex))
  }
  await admin.getByRole('button', { name: '添加换人', exact: true }).click()
  await admin.locator('#sub-team-0').selectOption(home); await admin.locator('#sub-minute-0').fill('32')
  await admin.locator('#sub-in-0').selectOption(teamPlayer(home, 1)); await admin.locator('#sub-out-0').selectOption(teamPlayer(home, 0))
  const expectedStats = { possession: [60, 40], shots: [8, 4], shotsOnTarget: [4, 2], corners: [3, 1], fouls: [5, 7], offsides: [1, 2] }
  for (const [field, values] of [['possession', expectedStats.possession], ['shots', expectedStats.shots], ['shots-target', expectedStats.shotsOnTarget], ['corners', expectedStats.corners], ['fouls', expectedStats.fouls], ['offsides', expectedStats.offsides]]) {
    await admin.locator(`#stats-${field}-home`).fill(String(values[0])); await admin.locator(`#stats-${field}-away`).fill(String(values[1]))
  }
  await admin.locator('#result-reason').fill('技术台进行中核对'); await admin.getByRole('button', { name: '保存并发布赛果', exact: true }).click(); await saved()
  assert.match(await matchRow('江湾联队 vs 徐汇星火').locator('.result-score').innerText(), /1 : 0.*35′/)
  const liveResponse = await context.request.post(apiUrl, { data: { action: 'matches.getPublic', id: firstId } })
  assert.equal(liveResponse.status(), 200)
  const liveMatch = (await liveResponse.json()).match
  assert.equal(liveMatch.status, 'live'); assert.equal(liveMatch.result.minute, 35); assert.equal(liveMatch.result.state, 'live')
  assert.equal(liveMatch.result.cards.length, 2); assert.equal(liveMatch.result.substitutions.length, 1); assert.deepEqual(liveMatch.result.stats, expectedStats)
  check('后台可发布进行中分钟、红黄牌、换人和六项技术统计，并返回同一份公开记录')
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await context.request.get(publicOrigin)).ok()) break } catch {}
    if (attempt === 99) throw new Error('Public Vite server did not start: ' + publicLog)
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  await user.goto(`${publicOrigin}/#/pages/index/index?tab=tournament`, { waitUntil: 'networkidle' })
  await user.getByRole('button', { name: '真实赛程', exact: true }).click()
  const liveCard = user.locator('.public-schedule-card').filter({ hasText: '江湾联队' }).filter({ hasText: '徐汇星火' })
  await liveCard.getByText('进行中', { exact: true }).waitFor(); await liveCard.click()
  await user.waitForURL(url => url.hash.includes(`/pages/match/detail?id=${firstId}`))
  await user.locator('.detail-status').filter({ hasText: '35′' }).waitFor()
  assert.match(await user.locator('.detail-score').innerText(), /1\s*:\s*0/)
  await user.getByText('当前比分 · 进行中', { exact: true }).waitFor()
  await user.locator('.detail-team').getByText('江湾联队', { exact: true }).waitFor(); await user.locator('.detail-team').getByText('徐汇星火', { exact: true }).waitFor()
  const timeline = user.locator('.timeline-event')
  assert.equal(await timeline.count(), 4)
  assert.deepEqual(await timeline.locator('.event-minute').allTextContents(), ['15′', '20′', '28′', '32′'])
  for (const [kind, minute, player] of [['进球', '15′', '江湾联队前锋'], ['黄牌', '20′', '江湾联队中场'], ['红牌', '28′', '徐汇星火前锋'], ['换人', '32′', '江湾联队中场']]) {
    const event = timeline.filter({ has: user.locator('.event-kind').filter({ hasText: new RegExp(`^${kind}$`) }) })
    assert.equal(await event.count(), 1); assert.equal(await event.locator('.event-minute').innerText(), minute)
    assert.match(await event.locator('.event-copy').innerText(), new RegExp(player))
  }
  assert.match(await timeline.filter({ hasText: '换人' }).innerText(), /江湾联队前锋 换下/)
  assert.match(await timeline.filter({ hasText: '进球' }).innerText(), /江湾联队中场 助攻/)
  check('公开赛程可进入真实比赛详情，进行中分钟、比分与按分钟排序的进球红黄牌换人展示正确')
  await user.getByRole('button', { name: '技术统计', exact: true }).click()
  assert.equal(await user.locator('.stat-bar-row').count(), 6); assert.equal(await user.locator('.timeline-event').count(), 0)
  for (const [label, values, suffix] of [['控球率', expectedStats.possession, '%'], ['射门', expectedStats.shots, ''], ['射正', expectedStats.shotsOnTarget, ''], ['角球', expectedStats.corners, ''], ['犯规', expectedStats.fouls, ''], ['越位', expectedStats.offsides, '']]) {
    const row = user.locator('.stat-bar-row').filter({ has: user.getByText(label, { exact: true }) })
    assert.deepEqual(await row.locator(':scope > uni-view > uni-text').allTextContents(), [`${values[0]}${suffix}`, label, `${values[1]}${suffix}`])
  }
  await user.getByRole('button', { name: '赛场事件', exact: true }).click(); assert.equal(await timeline.count(), 4); assert.equal(await user.locator('.stat-bar-row').count(), 0)
  check('比赛详情六项技术统计显示完整且技术统计和赛场事件栏目切换正确')
  const liveStandingsResponse = await context.request.post(apiUrl, { data: { action: 'standings.getPublic', competitionId: cid } })
  const liveStandings = await liveStandingsResponse.json()
  assert.equal(liveStandings.ok, true); assert.deepEqual(liveStandings.goals, []); assert.deepEqual(liveStandings.assists, [])
  assert.equal(liveStandings.groups.every(group => group.finishedMatches === 0 && group.rows.every(row => row.played === 0 && row.points === 0 && row.goalsFor === 0)), true)
  const unresolvedFinal = liveStandings.matches.find(match => match.id === finalId)
  assert.equal(unresolvedFinal.homeTeamId, null); assert.equal(unresolvedFinal.awayTeamId, null); assert.equal(liveStandings.championTeamId, null)
  await user.locator('.desktop-nav').getByRole('button', { name: '数据', exact: true }).click()
  await user.locator('.live-standing-row').filter({ hasText: '江湾联队' }).waitFor(); await user.getByText('已完赛 0/1', { exact: true }).first().waitFor()
  await user.getByRole('button', { name: '射手榜', exact: true }).click(); await user.getByText('暂无进球记录', { exact: true }).waitFor()
  await user.getByRole('button', { name: '助攻榜', exact: true }).click(); await user.getByText('暂无助攻记录', { exact: true }).waitFor()
  check('进行中比分与进球助攻不计入三榜，也不提前确定小组晋级与冠军')
  await score(matchRow('江湾联队 vs 徐汇星火'), 2, 0, [home, home]); await saved()
  assert.equal(matchRecords.get(firstId).result.state, 'finished'); assert.equal(matchRecords.get(firstId).result.minute, 90)
  assert.equal(matchRecords.get(firstId).result.cards.length, 2); assert.equal(matchRecords.get(firstId).result.substitutions.length, 1)
  assert.deepEqual(matchRecords.get(firstId).result.stats, expectedStats)
  await score(matchRow('浦东远航 vs 静安绿茵'), 1, 0, [third]); await saved()
  await matchRow('江湾联队 vs 浦东远航').waitFor(); check('进行中可转为完赛并保留牌面换人与技术统计，正式赛果自动填入决赛')
  await user.getByRole('button', { name: '积分榜', exact: true }).click(); await user.getByRole('button', { name: '刷新榜单', exact: true }).click(); await user.locator('.live-standing-row').filter({ hasText: '江湾联队' }).waitFor(); await user.getByText('本组已完赛', { exact: true }).first().waitFor(); assert.equal(await user.locator('.live-standing-group').count(), 2); check('前台积分榜读取真实分组、积分与完赛进度')
  await user.getByRole('button', { name: '射手榜', exact: true }).click(); assert.match(await user.locator('.live-player-row').nth(1).innerText(), /江湾联队前锋/); assert.equal(await user.locator('.live-player-row').nth(1).locator('.ranking-value').innerText(), '2')
  await user.getByRole('button', { name: '助攻榜', exact: true }).click(); assert.match(await user.locator('.live-player-row').nth(1).innerText(), /江湾联队中场/); check('射手榜和助攻榜从同一份有效进球事件计算')
  await score(matchRow('江湾联队 vs 浦东远航'), 1, 1, [home, third], '决赛含点球确认', [4, 3]); await saved()
  await user.getByRole('button', { name: '刷新榜单', exact: true }).click(); await user.getByRole('button', { name: '晋级对阵', exact: true }).click(); await user.locator('.live-champion').getByText('江湾联队', { exact: true }).waitFor(); await user.getByText('点球 4 : 3', { exact: true }).waitFor(); check('淘汰赛平局由点球决出胜者，前台显示冠军及晋级来源')
  const revisionBefore = competitionMemory.records.get(cid).scheduleMutationVersion
  await score(matchRow('江湾联队 vs 徐汇星火'), 0, 2, [away, away], '更正小组赛胜者')
  await admin.getByRole('alert').filter({ hasText: '更改会影响进行中或已有赛果的参赛球队' }).waitFor(); assert.equal(competitionMemory.records.get(cid).scheduleMutationVersion, revisionBefore); assert.equal(matchRecords.get(firstId).result.homeScore, 2)
  await admin.locator('.result-editor').getByRole('button', { name: '关闭', exact: true }).click(); check('更正前轮会改变已有后轮参赛球队时，服务端拒绝且不留下部分写入')
  await matchRow('江湾联队 vs 浦东远航').getByRole('button', { name: '撤销赛果', exact: true }).click(); await admin.locator('#result-reason').fill('先撤销决赛，再更正小组赛'); await admin.getByRole('button', { name: '确认撤销赛果', exact: true }).click(); await admin.getByText('赛果已撤销，榜单和晋级对阵已重新计算。', { exact: true }).waitFor(); await admin.locator('.result-editor').waitFor({ state: 'hidden' })
  await score(matchRow('江湾联队 vs 徐汇星火'), 0, 2, [away, away], '更正小组赛胜者'); await saved(); await matchRow('徐汇星火 vs 浦东远航').waitFor()
  await user.getByRole('button', { name: '刷新榜单', exact: true }).click(); await user.locator('.live-bracket-match').getByText('徐汇星火', { exact: true }).waitFor(); assert.equal(await user.locator('.live-champion').count(), 0)
  await user.getByRole('button', { name: '射手榜', exact: true }).click(); await user.locator('.live-player-row').filter({ hasText: '徐汇星火前锋' }).waitFor(); assert.equal(await user.locator('.live-player-row').filter({ hasText: '江湾联队前锋' }).count(), 0); check('撤销后轮并更正前轮后，个人榜单、晋级球队和冠军状态一致更新')
  await matchRow('江湾联队 vs 徐汇星火').getByRole('button', { name: '更正历史', exact: true }).click(); await admin.locator('.result-history-row').filter({ hasText: '技术台确认赛果' }).waitFor(); assert.equal(await admin.locator('.result-history-row').count(), 3); await admin.locator('.result-history-row').filter({ hasText: '技术台进行中核对' }).waitFor(); check('原始比分和更正原因保留在管理员历史中')
  failPublicRead = true; await user.getByRole('button', { name: '刷新榜单', exact: true }).click(); await user.getByRole('button', { name: '重新加载榜单', exact: true }).waitFor(); assert.equal(await user.locator('.live-player-row').count(), 0); await user.getByRole('button', { name: '重新加载榜单', exact: true }).click(); await user.locator('.live-player-row').first().waitFor(); check('榜单读取失败清除旧结果，重试后恢复且保留当前栏目')
  await user.getByRole('button', { name: '积分榜', exact: true }).click()
  for (const width of [390, 320]) { await admin.setViewportSize({ width, height: 844 }); await user.setViewportSize({ width, height: 844 }); assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); assert.equal(await user.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await capture(admin, `admin-${width}.png`); await capture(user, `standings-${width}.png`); check(`${width}px后台与前台积分榜无整页横向溢出`) }
  await user.getByRole('button', { name: '晋级对阵', exact: true }).click(); await capture(user, 'advancement-320.png')
  assert.deepEqual(errors, [])
  await fs.writeFile(`${out}/report.json`, JSON.stringify({ checks, errors, screenshots: skipScreenshots ? 'skipped' : 'captured', validation: 'D07-D08 isolated browser flows using real auth, competition, registration, schedule and standings services with atomic memory storage; not customer cloud or device evidence.', generatedAt: new Date().toISOString() }, null, 2))
  console.log(`Verified ${checks.length} D07-D08 browser flows.`)
} catch (error) { await fs.writeFile(`${out}/failure.txt`, (await admin.locator('body').innerText().catch(() => '')) + '\nPUBLIC\n' + (await user.locator('body').innerText().catch(() => '')) + '\nERRORS\n' + JSON.stringify(errors) + '\nLOG\n' + publicLog); throw error } finally { await browser.close(); await adminVite.close(); try { process.kill(-publicServer.pid, 'SIGTERM') } catch {} server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(certDir, { recursive: true, force: true }) }
