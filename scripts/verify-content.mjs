import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:https'
import { createServer as createViteServer } from 'vite'
import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
const require = createRequire(import.meta.url)
const { createAdminService, createAccount } = require('../cloudfunctions/adminAuth/service.js')
const { createHttpHandler } = require('../cloudfunctions/adminAuth/http.js')
const { createContentService, PUBLIC_ACTIONS } = require('../cloudfunctions/adminAuth/content.js')
const { createCompetitionService, PUBLIC_ACTIONS: COMPETITION_PUBLIC_ACTIONS } = require('../cloudfunctions/adminAuth/competitions.js')
const { createMatchService, PUBLIC_ACTIONS: MATCH_PUBLIC_ACTIONS } = require('../cloudfunctions/adminAuth/matches.js')
const { createStandingsService, PUBLIC_ACTIONS: STANDINGS_PUBLIC_ACTIONS } = require('../cloudfunctions/adminAuth/standings.js')
const { createAdminTeamService } = require('../cloudfunctions/adminAuth/teams.js')
const { createAdminRegistrationService } = require('../cloudfunctions/adminAuth/registrations.js')
const { createMemoryStore } = require('../tests/helpers/admin-store.cjs')
const { createContentMemoryStore } = require('../tests/helpers/content-store.cjs')
const { createNewsImageStorage } = require('../tests/helpers/news-image-storage.cjs')
const { createNewsImageService } = require('../cloudfunctions/adminAuth/news-images.js')
const { PNG } = createRequire(resolve('cloudfunctions/adminAuth/package.json'))('pngjs')
const { createMatchMemoryStore } = require('../tests/helpers/match-store.cjs')
const { registrationId } = require('../cloudfunctions/adminAuth/registration-model.js')
const out = 'artifacts/content'
await fs.mkdir(out, { recursive: true }); await fs.mkdir('.tools', { recursive: true })
let now = Date.parse('2026-11-16T08:00:00.000Z')
const timestamp = new Date(now).toISOString(), password = randomBytes(24).toString('base64url'), authNow = now
const auth = createAdminService({ store: createMemoryStore(await createAccount('admin', password, now)).store, now: () => authNow, logger: { error() {} } })
const authorize = token => auth({ action: 'session', token })
const memory = createContentMemoryStore(), { collections, store } = memory
const cid = 'c_' + '1'.repeat(32), teamId = 't_' + 'a'.repeat(64), awayId = 't_' + 'b'.repeat(64), playerId = 'p_' + '1'.repeat(32), matchId = 'm_' + '1'.repeat(32)
collections.competitions.set(cid, { _id: cid, name: '社区杯', description: '浏览器隔离测试', format: 'round_robin', formatDescription: '单循环', startDate: '2026-11-20', endDate: '2026-12-31', venue: '社区球场', registrationRequirements: '提交材料', registrationStartAt: null, registrationEndAt: null, registrationEnabled: false, displayEnabled: true, version: 1, createdAt: now, updatedAt: now })
for (const [id, name] of [[teamId, '社区联队'], [awayId, '社区星火']]) {
  collections.teams.set(id, { _id: id, name, district: '虹口区', description: '社区足球队', contactPhone: '021-11112222', status: 'active', version: 1, leaderUserId: 'private-user', roster: [{ id: id === teamId ? playerId : 'p_' + '2'.repeat(32), name: id === teamId ? '社区球员' : '星火球员', number: 7, position: 'forward' }], createdAt: timestamp, updatedAt: timestamp })
  const rid = registrationId(cid, id); collections.registrations.set(rid, { _id: rid, competitionId: cid, teamId: id, status: 'approved' })
}
collections.matches.set(matchId, { _id: matchId, competitionId: cid, stage: 'group', round: 1, groupId: 'A', slot: null, homeTeamId: teamId, awayTeamId: awayId, homeFrom: null, awayFrom: null, status: 'scheduled', homeScore: null, awayScore: null, scheduledAt: '2026-11-20T08:00:00.000Z', venue: '社区球场', version: 1, createdAt: now, updatedAt: now })
const matchesMemory = createMatchMemoryStore({ competitions: collections.competitions, teams: collections.teams, registrations: collections.registrations, records: collections.matches })
const imageMemory = createNewsImageStorage()
const content = createContentService({ store, storage: imageMemory.storage, authorize, now: () => now, logger: { error() {} } })
const newsImages = createNewsImageService({ store, storage: imageMemory.storage, authorize, enabled: true, now: () => now, logger: { error() {} } })
const competitions = createCompetitionService({ store: { read: id => store.read('competitions', id), async list({ publicOnly, cursor, limit }) { return [...collections.competitions.values()].filter(c => (!publicOnly || c.displayEnabled) && (!cursor || c._id > cursor)).slice(0, limit) } }, authorize, now: () => now, logger: { error() {} } })
const teams = createAdminTeamService({ store: { read: id => store.read('teams', id), async user() { return { nickname: '测试领队' } }, async list(cursor, limit) { return [...collections.teams.values()].filter(t => !cursor || t._id > cursor).slice(0, limit) } }, authorize })
const matches = createMatchService({ store: matchesMemory.store, authorize, now: () => now, logger: { error() {} } })
const standings = createStandingsService({ store: matchesMemory.standingsStore, authorize, now: () => now, logger: { error() {} } })
const registrations = createAdminRegistrationService({ store: { competition: matchesMemory.store.competition, async list() { return [] } }, authorize })
let failNews = false, slowSearch = false, failImageChunk = false, slowImageChunk = false, failImageRequests = false, rejectNextImageChunk = false
const imageRequests = []
const router = async event => {
  if (event.action.startsWith('news.images.')) {
    imageRequests.push(structuredClone(event))
    if (slowImageChunk && event.action === 'news.images.chunk') await new Promise(resolve => setTimeout(resolve, 500))
    const result = await newsImages(event)
    if (failImageChunk && event.action === 'news.images.chunk' && event.index === 1) { failImageChunk = false; return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '模拟连接中断，请重试上传。' } } }
    return result
  }
  if (event.action === 'news.listPublic' && failNews) { failNews = false; return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '内容暂不可用，请重新加载。' } } }
  if (event.action === 'search.public' && event.query === '慢响应' && slowSearch) await new Promise(resolve => setTimeout(resolve, 700))
  return /^(news|search|directory|content)\./.test(event.action) ? content(event) : event.action.startsWith('competitions.') ? competitions(event) : event.action.startsWith('teams.') ? teams(event) : event.action.startsWith('matches.') ? matches(event) : event.action.startsWith('standings.') ? standings(event) : event.action.startsWith('registrations.') ? registrations(event) : auth(event)
}
const adminOrigin = 'http://127.0.0.1:5184', publicOrigin = 'http://127.0.0.1:5183', certDir = await fs.mkdtemp('/tmp/community-football-content-')
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${certDir}/key.pem`, '-out', `${certDir}/cert.pem`, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })
const http = createHttpHandler(router, [adminOrigin, publicOrigin], [...PUBLIC_ACTIONS, ...COMPETITION_PUBLIC_ACTIONS, ...MATCH_PUBLIC_ACTIONS, ...STANDINGS_PUBLIC_ACTIONS])
const cover = await fs.readFile('src/static/images/football.jpg')
const server = createServer({ key: await fs.readFile(`${certDir}/key.pem`), cert: await fs.readFile(`${certDir}/cert.pem`) }, async (req, res) => {
  if (req.url === '/image.jpg') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(cover); return }
  if (req.url?.startsWith('/news-image?')) {
    const id = new URL(req.url, 'https://127.0.0.1').searchParams.get('id'), bytes = imageMemory.objects.get(id)
    if (!bytes || failImageRequests) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'Content-Type': id.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-store' }); res.end(bytes); return
  }
  let body = ''; for await (const chunk of req) body += chunk
  if (Buffer.byteLength(body) > 100000 || rejectNextImageChunk && body.includes('"action":"news.images.chunk"')) {
    rejectNextImageChunk = false
    res.writeHead(413, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': req.headers.origin || adminOrigin })
    res.end(JSON.stringify({ code: 'EXCEED_MAX_PAYLOAD_SIZE' })); return
  }
  const result = await http({ httpMethod: req.method, headers: req.headers, body }); res.writeHead(result.statusCode, result.headers); res.end(result.body)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const endpoint = `https://127.0.0.1:${server.address().port}/api`, imageUrl = endpoint.replace('/api', '/image.jpg')
imageMemory.storage.link = async id => {
  if (!imageMemory.objects.has(id)) throw new Error('Missing image')
  return endpoint.replace('/api', `/news-image?id=${encodeURIComponent(id)}&v=${++imageMemory.controls.version}`)
}
process.env.VITE_ADMIN_API_URL = endpoint
const config = resolve('.tools/d09-public.vite.config.ts')
await fs.writeFile(config, "import base from '../vite.config'; export default env => ({ ...base(env), cacheDir: '.tools/d09-public-cache', server: { host: '127.0.0.1', port: 5183, strictPort: true, hmr: false } })\n")
const adminVite = await createViteServer({ configFile: 'admin/vite.config.ts', mode: 'test', cacheDir: resolve('.tools/d09-admin-cache'), server: { host: '127.0.0.1', port: 5184, strictPort: true, hmr: false } }); await adminVite.listen()
const publicServer = spawn('node', ['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js', '--config', config, '--host', '127.0.0.1', '--port', '5183'], { detached: true, env: { ...process.env, CHOKIDAR_USEPOLLING: 'true', VITE_COMPETITION_API_URL: endpoint }, stdio: ['ignore', 'pipe', 'pipe'] })
let publicLog = ''; for (const stream of [publicServer.stdout, publicServer.stderr]) stream.on('data', chunk => { publicLog += chunk })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', ignoreHTTPSErrors: true })
context.setDefaultTimeout(15000)
const admin = await context.newPage(), user = await context.newPage(), checks = [], errors = []
for (const page of [admin, user]) page.on('pageerror', e => errors.push(e.message))
const check = name => { checks.push(name); console.log(`PASS ${name}`) }
const newsTab = () => admin.getByRole('button', { name: '新闻与公告', exact: true }).click()
const publicNews = async () => { await user.goto(`${publicOrigin}/#/pages/index/index?tab=news`); await user.reload(); await user.locator('.public-news').waitFor() }
const openSearch = async () => { await user.goto(publicOrigin); await user.locator('.search-trigger').click(); await user.locator('.search-panel').waitFor() }
const fillSearch = value => user.locator('.search-input input').fill(value)
try {
  const unauthorized = await context.request.post(endpoint, { data: { action: 'news.create' } }); assert.equal(unauthorized.status(), 401)
  await admin.goto(adminOrigin); await admin.getByLabel('管理员账号', { exact: true }).fill('admin'); await admin.getByLabel('登录密码', { exact: true }).fill(password); await admin.getByRole('button', { name: '登录管理后台' }).click(); await admin.locator('.workspace').waitFor(); await newsTab(); await admin.getByRole('button', { name: '新建内容', exact: true }).click()
  await admin.getByLabel('标题', { exact: true }).fill('社区杯观赛公告'); await admin.getByLabel('分类', { exact: true }).selectOption('公告'); await admin.getByLabel('摘要', { exact: true }).fill('周末来为社区球队加油'); await admin.getByLabel('正文文字', { exact: true }).fill('观赛须知\n<script>window.d09Injected = true</script>'); await admin.getByRole('button', { name: '保存内容', exact: true }).click(); await admin.getByText('草稿已保存，仅管理员可见。', { exact: true }).waitFor()
  const articleId = [...collections.newsArticles.keys()][0]
  await publicNews(); await user.getByText('暂无已发布内容', { exact: true }).waitFor(); assert.equal((await content({ action: 'news.getPublic', id: articleId })).error.code, 'NOT_FOUND'); check('后台保存草稿，公开列表、直达和未登录管理接口正确隔离')
  await admin.getByRole('button', { name: '编辑内容', exact: true }).click(); await admin.getByLabel('发布状态', { exact: true }).selectOption('published'); await admin.getByLabel('置顶', { exact: true }).selectOption('true'); await admin.getByLabel('封面HTTPS地址', { exact: true }).fill(imageUrl); await admin.getByRole('button', { name: '添加图片', exact: true }).click(); await admin.getByLabel('图片HTTPS地址', { exact: true }).fill(imageUrl); await admin.getByLabel('图片说明', { exact: true }).fill('社区球场'); await admin.getByRole('button', { name: '保存内容', exact: true }).click(); await admin.getByText('内容已发布，公开列表、首页和搜索将读取最新内容。', { exact: true }).waitFor()
  await user.getByRole('button', { name: '刷新动态', exact: true }).click(); await user.locator('.news-item').waitFor(); assert.equal(await user.locator('.news-item-title').innerText(), '社区杯观赛公告'); assert.equal(await user.locator('.pinned').innerText(), '置顶'); check('发布和置顶后前台读取同一条记录，五类筛选可用')
  await user.getByRole('button', { name: '深度', exact: true }).click(); await user.getByText('暂无已发布内容', { exact: true }).waitFor(); await user.getByRole('button', { name: '公告', exact: true }).click(); await user.locator('.news-item').click(); await user.locator('.article-title').waitFor(); await user.getByText('<script>window.d09Injected = true</script>', { exact: false }).waitFor(); assert.equal(await user.evaluate(() => window.d09Injected), undefined); await user.locator('.article-inline-image').waitFor(); assert.equal(await user.locator('.article-block').count(), 2); check('图文详情保留段落与图片，正文标签作为文字显示')
  await user.screenshot({ path: `${out}/article-desktop.png`, fullPage: true }); await user.goto(publicOrigin); await user.locator('.announcement-text').getByText('社区杯观赛公告', { exact: true }).waitFor(); assert.equal(await user.locator('.story-title').first().innerText(), '社区杯观赛公告'); check('首页公告和新闻摘要接入已发布内容')
  await openSearch(); await fillSearch('社区'); await user.locator('.search-result').first().waitFor(); assert.equal(await user.locator('.search-result').count(), 6); await user.getByRole('button', { name: '球员 2', exact: true }).click(); await user.waitForFunction(() => document.querySelectorAll('.search-result').length === 2); await user.locator('.search-result').filter({ hasText: '社区球员' }).click(); await user.locator('.player-profile .page-title').getByText('社区球员', { exact: true }).waitFor(); await user.getByRole('button', { name: '查看所属球队', exact: true }).click(); await user.locator('.public-team-profile .page-title').waitFor(); assert.equal(await user.locator('.roster-card').count(), 1); check('四类公开搜索返回真实数据，球员与所属球队详情可跳转')
  await openSearch(); await user.getByRole('button', { name: '社区', exact: true }).click(); await user.locator('.search-result').first().waitFor(); await user.getByRole('button', { name: '清空搜索', exact: true }).click(); await user.getByRole('button', { name: '清空历史', exact: true }).click(); assert.equal(await user.locator('.search-history').count(), 0); check('搜索历史跨页面保存、复用和清空')
  slowSearch = true; await fillSearch('慢响应'); await user.waitForRequest(req => req.postData()?.includes('慢响应') || false); await fillSearch('社区球员'); await user.locator('.search-result').waitFor(); await user.waitForTimeout(850); assert.equal(await user.locator('.result-title').innerText(), '社区球员'); check('慢响应不能覆盖较新的搜索结果')
  await admin.getByRole('button', { name: '运营概览', exact: true }).click(); await admin.locator('.overview-grid').waitFor(); assert.equal(await admin.locator('.overview-number strong').allTextContents().then(a => a.join(',')), '2,1,0,1'); check('运营概览读取球队、比赛、完赛进球和新闻数量')
  await admin.getByRole('button', { name: '全局搜索', exact: true }).click(); await admin.getByLabel('搜索关键词').fill('社区杯观赛公告'); await admin.getByRole('button', { name: '搜索', exact: true }).click(); await admin.locator('.admin-search-result').click(); await admin.getByLabel('标题', { exact: true }).waitFor(); assert.equal(await admin.getByLabel('标题', { exact: true }).inputValue(), '社区杯观赛公告'); check('后台全局搜索进入对应新闻编辑记录')
  for (const [query, selector] of [['社区球员', '.admin-team-detail'], ['社区球场', '.result-editor']]) {
    await admin.getByRole('button', { name: '全局搜索', exact: true }).click(); await admin.getByLabel('搜索关键词').fill(query); await admin.getByRole('button', { name: '搜索', exact: true }).click(); await admin.locator('.admin-search-result').click(); await admin.locator(selector).waitFor()
  }
  check('后台球员搜索进入球队名单，比赛搜索定位对应赛事历史')
  await publicNews(); await user.locator('.news-item').waitFor(); failNews = true; await user.getByRole('button', { name: '刷新动态', exact: true }).click(); await user.getByRole('button', { name: '重新加载动态', exact: true }).waitFor(); assert.equal(await user.locator('.news-item').count(), 0); await user.getByRole('button', { name: '重新加载动态', exact: true }).click(); await user.locator('.news-item').waitFor(); check('公开请求失败清除旧内容并允许重试')
  for (let i = 2; i <= 25; i++) collections.newsArticles.set('n_' + i.toString(16).padStart(32, '0'), { ...structuredClone(collections.newsArticles.get(articleId)), _id: 'n_' + i.toString(16).padStart(32, '0'), title: `分页新闻${i}`, pinned: false, category: '深度' })
  await user.getByRole('button', { name: '全部动态', exact: true }).click(); await user.getByRole('button', { name: '加载更多动态', exact: true }).waitFor(); assert.equal(await user.locator('.news-item').count(), 20); await user.getByRole('button', { name: '加载更多动态', exact: true }).click(); await user.waitForFunction(() => document.querySelectorAll('.news-item').length === 25); check('新闻分页加载超过20条且无重复')
  await newsTab(); await admin.getByRole('button', { name: '编辑内容', exact: true }).first().click(); await admin.getByLabel('标题', { exact: true }).fill('社区杯修订公告'); await admin.getByRole('button', { name: '保存内容', exact: true }).click(); await admin.locator('.news-editor').waitFor({ state: 'hidden' }); assert.equal(collections.newsArticles.get(articleId).title, '社区杯修订公告'); check('后台更正新闻标题保留原发布记录')
  await admin.getByRole('button', { name: '编辑内容', exact: true }).first().click()
  for (const width of [390, 320]) {
    await admin.setViewportSize({ width, height: 844 }); await user.setViewportSize({ width, height: 844 }); await user.goto(`${publicOrigin}/#/pages/article/detail?id=${articleId}`); await user.locator('.article-title').waitFor()
    for (const page of [admin, user]) assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    await admin.screenshot({ path: `${out}/admin-${width}.png`, fullPage: true }); await user.screenshot({ path: `${out}/article-${width}.png`, fullPage: true }); await openSearch(); await fillSearch('社区'); await user.locator('.search-result').first().waitFor(); assert.equal(await user.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await user.screenshot({ path: `${out}/search-${width}.png`, fullPage: true })
    check(`${width}px后台图文编辑、文章与搜索无横向溢出`)
  }
  await admin.getByRole('button', { name: '删除此内容', exact: true }).click(); await admin.getByLabel('输入完整标题确认删除', { exact: true }).fill('社区杯修订公告'); await admin.getByRole('button', { name: '确认删除内容', exact: true }).click(); await admin.getByText('内容已删除，公开入口不再展示。', { exact: true }).waitFor(); await user.goto(`${publicOrigin}/#/pages/article/detail?id=${articleId}`); await user.getByText('内容不存在或暂未公开。', { exact: true }).waitFor(); assert.equal((await content({ action: 'search.public', query: '社区杯修订公告' })).total, 0); check('删除后的文章直达与搜索同步不可见')
  await admin.setViewportSize({ width: 1440, height: 1000 }); await user.setViewportSize({ width: 1440, height: 1000 })
  now += 60000
  await admin.getByRole('button', { name: '新建内容', exact: true }).click()
  await admin.getByLabel('标题', { exact: true }).fill('本地图片上传验收'); await admin.getByLabel('正文文字', { exact: true }).fill('上传正文段落'); await admin.getByLabel('发布状态', { exact: true }).selectOption('published')
  const pngBytes = PNG.sync.write({ width: 300, height: 300, data: randomBytes(360000) }), pngFile = { name: '社区球场.png', mimeType: 'image/png', buffer: pngBytes }
  const oversized = Buffer.from(pngBytes), beforeOversized = imageRequests.length
  oversized.writeUInt32BE(4201, 16); oversized.writeUInt32BE(2379, 20)
  await admin.getByLabel('封面上传图片', { exact: true }).setInputFiles({ name: 'wallpaper.png', mimeType: 'image/png', buffer: oversized })
  await admin.getByText('图片尺寸为4201×2379，边长不能超过4096像素，总像素不能超过800万。请缩小图片后重新选择。', { exact: true }).waitFor()
  assert.equal(imageRequests.length, beforeOversized)
  check('超大尺寸选图显示实际宽高和限制，在上传前拒绝且保留表单')
  failImageChunk = true
  await admin.getByLabel('封面上传图片', { exact: true }).setInputFiles(pngFile)
  await admin.getByText('模拟连接中断，请重试上传。', { exact: true }).waitFor()
  assert.equal(await admin.getByRole('button', { name: '保存内容', exact: true }).isDisabled(), true)
  await admin.getByRole('button', { name: '重试上传', exact: true }).click()
  await admin.getByRole('button', { name: '刷新图片链接', exact: true }).waitFor()
  const coverRecord = [...collections.newsImages.values()][0], uploadedArticleId = coverRecord.articleId
  assert.equal(imageRequests.filter(r => r.action === 'news.images.chunk' && r.id === coverRecord._id && r.index === 0).length, 1)
  assert.equal(collections.newsArticles.has(uploadedArticleId), false)
  check('新建文章保存前上传封面，丢失分片回执后重试复用已传分片，未完成时禁止保存')
  await admin.getByRole('button', { name: '添加图片', exact: true }).click(); await admin.getByLabel('图片说明', { exact: true }).fill('本地JPG图')
  slowImageChunk = true
  const chunkRequest = admin.waitForRequest(req => req.postData()?.includes('news.images.chunk') || false)
  await admin.getByLabel('正文上传图片', { exact: true }).setInputFiles({ name: '足球.jpg', mimeType: 'image/jpeg', buffer: cover }); await chunkRequest
  await admin.locator('.news-block').last().getByRole('button', { name: '上移', exact: true }).click()
  await admin.getByLabel('正文上传图片', { exact: true }).locator('..').locator('..').getByRole('button', { name: '刷新图片链接', exact: true }).waitFor()
  slowImageChunk = false
  assert.equal(await admin.locator('.news-block').first().getByLabel('图片说明', { exact: true }).inputValue(), '本地JPG图')
  check('JPG正文上传期间移动段落，完成后图片和说明仍绑定原段落')
  await admin.getByRole('button', { name: '保存内容', exact: true }).click(); await admin.locator('.news-editor').waitFor({ state: 'hidden' })
  const stored = collections.newsArticles.get(uploadedArticleId)
  assert.equal(stored.coverUrl, ''); assert.equal(stored.body[0].url, ''); assert.equal(stored.body[1].text, '上传正文段落')
  assert.equal(stored.status, 'published'); assert.equal((await content({ action: 'news.getPublic', id: uploadedArticleId })).ok, true)
  assert.equal(collections.newsImages.get(stored.coverImageId).referenced, true)
  await user.goto(`${publicOrigin}/#/pages/article/detail?id=${uploadedArticleId}`); await user.reload(); await user.getByText('本地图片上传验收', { exact: true }).waitFor(); await user.waitForFunction(() => [...document.querySelectorAll('.article-page img')].length >= 2 && [...document.querySelectorAll('.article-page img')].every(i => i.complete && i.naturalWidth > 0))
  check('保存只持久化图片标识，前台经真实HTTPS接口获取并加载封面和正文图片')
  await admin.locator('.content-row').filter({ hasText: '本地图片上传验收' }).getByRole('button', { name: '编辑内容', exact: true }).click()
  const coverControl = admin.locator('.news-image-input').first(), beforeLink = await coverControl.locator('img').getAttribute('src')
  await coverControl.locator('img').evaluate(img => img.decode())
  await coverControl.getByRole('button', { name: '刷新图片链接', exact: true }).click(); await admin.waitForFunction(old => document.querySelector('.news-image-input img').getAttribute('src') !== old, beforeLink)
  check('编辑回读保留图片标识，可手动刷新临时访问链接')
  rejectNextImageChunk = true
  await admin.getByLabel('封面上传图片', { exact: true }).setInputFiles(pngFile)
  await admin.getByText('上传请求超过云网关大小限制，请刷新后台后重新选择图片；如仍失败，请更新云函数。', { exact: true }).waitFor()
  assert.equal(await admin.getByRole('button', { name: '保存内容', exact: true }).isDisabled(), true)
  await coverControl.getByRole('button', { name: '取消本次选择', exact: true }).click()
  assert.equal(collections.newsArticles.get(uploadedArticleId).coverImageId, coverRecord._id)
  check('云网关413显示明确提示，取消候选后保留原图和保存入口')
  failImageChunk = true
  await admin.getByLabel('封面上传图片', { exact: true }).setInputFiles(pngFile); await admin.getByText('模拟连接中断，请重试上传。', { exact: true }).waitFor(); await coverControl.getByRole('button', { name: '取消本次选择', exact: true }).click()
  assert.equal(await admin.getByRole('button', { name: '保存内容', exact: true }).isEnabled(), true); assert.equal(collections.newsArticles.get(uploadedArticleId).coverImageId, coverRecord._id)
  await admin.getByRole('button', { name: '保存内容', exact: true }).click(); await admin.locator('.news-editor').waitFor({ state: 'hidden' })
  assert.equal(collections.newsImages.get(coverRecord._id).referenced, true)
  check('替换上传失败可取消选择，保存后原图及引用保持有效')
  await admin.locator('.content-row').filter({ hasText: '本地图片上传验收' }).getByRole('button', { name: '编辑内容', exact: true }).click()
  await admin.getByLabel('封面上传图片', { exact: true }).setInputFiles({ name: '新封面.png', mimeType: 'image/png', buffer: pngBytes })
  await coverControl.getByRole('button', { name: '刷新图片链接', exact: true }).waitFor(); await admin.getByRole('button', { name: '保存内容', exact: true }).click(); await admin.locator('.news-editor').waitFor({ state: 'hidden' })
  assert.notEqual(collections.newsArticles.get(uploadedArticleId).coverImageId, coverRecord._id); assert.equal(collections.newsImages.get(coverRecord._id).referenced, false)
  check('成功替换后保存新图引用，旧图解除引用并进入24小时保留期')
  failImageRequests = true
  await user.reload(); await user.getByRole('button', { name: '重新加载图片', exact: true }).waitFor(); failImageRequests = false
  await user.getByRole('button', { name: '重新加载图片', exact: true }).click(); await user.waitForFunction(() => [...document.querySelectorAll('.article-page img')].length >= 2 && [...document.querySelectorAll('.article-page img')].every(i => i.complete && i.naturalWidth > 0))
  check('公开图片加载失败显示重试入口，重读文章恢复图片')
  now += 24 * 3600000 + 10 * 60000 + 1
  const countBefore = imageMemory.objects.size
  await admin.getByRole('button', { name: '检查待清理图片', exact: true }).click(); await admin.getByRole('button', { name: '清理本批', exact: true }).waitFor(); assert.equal(imageMemory.objects.size, countBefore)
  await admin.getByRole('button', { name: '清理本批', exact: true }).click(); await admin.locator('.news-image-cleanup').getByText(/已清理[1-9]/).waitFor()
  assert.equal(imageMemory.objects.size, 2)
  for (const record of collections.newsImages.values()) if (record.referenced) assert.equal(imageMemory.objects.has(record.fileID), true)
  check('后台清理先预览再执行，移除过期候选和临时分片，保护文章封面与正文最终图片')
  await admin.locator('.content-row').filter({ hasText: '本地图片上传验收' }).getByRole('button', { name: '编辑内容', exact: true }).click()
  for (const width of [390, 320]) {
    await admin.setViewportSize({ width, height: 844 }); assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    await admin.screenshot({ path: `${out}/image-upload-${width}.png`, fullPage: true }); check(`${width}px封面与正文图片上传控件无横向溢出`)
  }
  assert.deepEqual(errors, [])
  await fs.writeFile(`${out}/report.json`, JSON.stringify({ date: '2026-11-17', generatedAt: new Date().toISOString(), checks, errors, gatewayMaxBodyBytes: 100000, validation: 'Local browsers against isolated HTTPS API using real services and in-memory transactional stores. Not customer cloud or physical-device evidence.' }, null, 2))
  console.log(`Verified ${checks.length} D09 browser flows.`)
} catch (e) { await fs.writeFile(`${out}/failure.txt`, `ADMIN\n${await admin.locator('body').innerText().catch(() => '')}\nPUBLIC\n${await user.locator('body').innerText().catch(() => '')}\nERRORS\n${JSON.stringify(errors)}\nLOG\n${publicLog}`); throw e }
finally { await browser.close(); await adminVite.close(); try { process.kill(-publicServer.pid, 'SIGTERM') } catch {} server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(certDir, { recursive: true, force: true }) }
