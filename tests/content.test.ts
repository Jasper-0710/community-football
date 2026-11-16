import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { parseNewsArticle, parseNewsPage, parseSearchPage, parsePublicTeam, parseContentOverview, publicSearchUrl } from '../src/domain/content'
import { cleanSearchHistory, rememberSearch } from '../src/domain/search-history'
const require = createRequire(import.meta.url)
const { createContentService, PUBLIC_ACTIONS } = require('../cloudfunctions/adminAuth/content.js')
const { rankSearch } = require('../cloudfunctions/adminAuth/search-engine.js')
const { createContentMemoryStore } = require('./helpers/content-store.cjs')
const { createHttpHandler } = require('../cloudfunctions/adminAuth/http.js')
const TOKEN = 'a'.repeat(64), key = '1'.repeat(32), id = `n_${key}`, cid = `c_${key}`, hidden = `c_${'2'.repeat(32)}`, teamId = `t_${'a'.repeat(64)}`, privateTeamId = `t_${'b'.repeat(64)}`, playerId = `p_${key}`
const form = { title: '社区杯公告', category: '公告', excerpt: '欢迎观赛', author: '赛事运营', coverUrl: '', body: [{ type: 'text', text: '第一段\n第二行' }], status: 'draft', pinned: false, competitionId: null }
function fixture() {
  const memory = createContentMemoryStore(), clock = { value: Date.parse('2026-11-16T00:00:00Z') }
  memory.collections.competitions.set(cid, { _id: cid, name: '公开社区杯', displayEnabled: true })
  memory.collections.competitions.set(hidden, { _id: hidden, name: '隐藏社区杯', displayEnabled: false })
  for (const [id, name] of [[teamId, '社区联队'], [privateTeamId, '私有球队']]) memory.collections.teams.set(id, { _id: id, name, district: '虹口区', description: '球队介绍', status: 'active', contactPhone: 'secret-phone', leaderUserId: 'secret-user', roster: [{ id: id === teamId ? playerId : `p_${'2'.repeat(32)}`, name: id === teamId ? '社区球员' : '私有球员', number: 7, position: 'forward' }] })
  memory.collections.registrations.set('approved', { _id: 'approved', teamId, competitionId: cid, status: 'approved', attachments: ['secret-material'] })
  memory.collections.registrations.set('pending', { _id: 'pending', teamId: privateTeamId, competitionId: cid, status: 'pending' })
  for (const [key, competitionId] of [['1', cid], ['2', hidden]]) memory.collections.matches.set(`m_${key.repeat(32)}`, { _id: `m_${key.repeat(32)}`, competitionId, homeTeamId: teamId, awayTeamId: privateTeamId, scheduledAt: '2026-11-20T08:00:00.000Z', venue: '社区球场', stage: 'semi', status: 'finished', homeScore: 2, awayScore: 1, penalties: [4, 3] })
  const service = createContentService({ store: memory.store, authorize: async (token: string) => token === TOKEN ? { ok: true } : { ok: false, error: { code: 'UNAUTHORIZED', message: '请先登录' } }, now: () => clock.value, logger: { error() {} } })
  const call = (action: string, fields: Record<string, unknown> = {}) => service({ action, token: TOKEN, ...fields })
  const create = (changes = {}, requestId = key) => call('news.create', { requestId, form: { ...form, ...changes } })
  return { ...memory, clock, service, call, create }
}
test('content writes require server authorization and HTTP public allowlist excludes all admin actions', async () => {
  const f = fixture(), http = createHttpHandler(f.service, ['https://admin.example.com'], PUBLIC_ACTIONS)
  for (const action of ['news.create', 'news.update', 'news.delete', 'news.listAdmin', 'search.admin', 'content.overview']) {
    assert.equal((await f.call(action, { token: 'forged', userInfo: { admin: true } })).error.code, 'UNAUTHORIZED')
    const r = await http({ httpMethod: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
    assert.equal(r.statusCode, 401)
  }
  assert.equal((await f.service({ action: 'news.listPublic' })).ok, true)
  assert.equal(f.collections.newsArticles.size, 0)
})
test('news defaults follow explicit draft form, create retries are idempotent and conflicting reuse is rejected', async () => {
  const f = fixture(), results = await Promise.all([f.create(), f.create()])
  assert.deepEqual(results.map(r => r.created), [true, false]); assert.equal(f.collections.newsArticles.size, 1)
  assert.equal((await f.create({ title: '另一篇' })).error.code, 'CONFLICT')
  assert.deepEqual((await f.call('news.listPublic')).articles, [])
  assert.equal((await f.call('news.getPublic', { id })).error.code, 'NOT_FOUND')
  assert.equal(parseNewsArticle(results[0].article, true, true).body?.[0].type, 'text')
})
test('publish, edit, unpublish and delete update all public discovery paths without leaking draft fields', async () => {
  const f = fixture(); await f.create()
  let r = await f.call('news.update', { id, expectedVersion: 1, form: { ...form, status: 'published', pinned: true } })
  const publishedAt = r.article.publishedAt
  assert.equal(r.article.version, 2); assert.equal(parseNewsPage(await f.call('news.listPublic')).articles.length, 1)
  const publicArticle = (await f.call('news.getPublic', { id })).article
  assert.equal('version' in publicArticle, false); assert.equal('creationFingerprint' in publicArticle, false)
  assert.equal((await f.call('search.public', { query: '社区杯' })).results[0].kind, 'news')
  f.clock.value += 1000
  r = await f.call('news.update', { id, expectedVersion: 2, form: { ...form, status: 'published', title: '更新社区杯' } })
  assert.equal(r.article.publishedAt, publishedAt)
  await f.call('news.update', { id, expectedVersion: 3, form })
  assert.equal((await f.call('news.getPublic', { id })).error.code, 'NOT_FOUND')
  assert.equal((await f.call('search.public', { query: '社区杯', kind: 'news' })).total, 0)
  assert.equal((await f.call('news.delete', { id, expectedVersion: 4 })).ok, true)
  assert.equal((await f.call('news.getAdmin', { id })).error.code, 'NOT_FOUND')
  assert.equal((await f.create()).error.code, 'CONFLICT')
})
test('associated hidden competitions disappear from feed, direct article, search and public directory', async () => {
  const f = fixture(); await f.create({ status: 'published', competitionId: cid })
  f.collections.competitions.get(cid).displayEnabled = false
  assert.equal((await f.call('news.listPublic')).articles.length, 0)
  assert.equal((await f.call('news.getPublic', { id })).error.code, 'NOT_FOUND')
  assert.equal((await f.call('search.public', { query: '社区' })).total, 0)
  assert.equal((await f.call('directory.teamPublic', { id: teamId })).error.code, 'NOT_FOUND')
  assert.ok((await f.call('search.admin', { query: '社区' })).total > 0)
})
test('public four-type search only exposes approved active public teams and safe projections', async () => {
  const f = fixture(); await f.create({ status: 'published' })
  const r = parseSearchPage(await f.call('search.public', { query: '社区' }))
  assert.deepEqual(r.counts, { team: 1, player: 1, match: 1, news: 1 })
  const raw = JSON.stringify(r)
  for (const secret of ['secret-phone', 'secret-user', 'secret-material', hidden]) assert.equal(raw.includes(secret), false)
  assert.equal((await f.call('search.public', { query: '私有球员' })).total, 0)
  assert.equal((await f.call('search.admin', { query: '私有球员' })).total, 1)
  const team = parsePublicTeam((await f.call('directory.teamPublic', { id: teamId })).team)
  assert.equal('contactPhone' in team, false)
  assert.equal((await f.call('directory.playerPublic', { id: playerId, teamId })).player.name, '社区球员')
  assert.equal((await f.call('directory.playerPublic', { id: playerId, teamId: privateTeamId })).error.code, 'NOT_FOUND')
  f.collections.teams.get(teamId).status = 'dissolved'
  assert.equal((await f.call('search.public', { query: '社区', kind: 'player' })).total, 0)
})
test('ranking is shared, normalized, stable and prioritizes exact, prefix, title contains and other fields', () => {
  const items = [{ id: '4', kind: 'news', title: '其他', detail: '联队' }, { id: '3', kind: 'news', title: '上海联队', detail: '' }, { id: '2', kind: 'news', title: '联队公告', detail: '' }, { id: '1', kind: 'news', title: '联队', detail: '' }]
  assert.deepEqual(rankSearch(items, ' 联队 ').map(r => r.id), ['1', '2', '3', '4'])
  assert.deepEqual(rankSearch(items.reverse(), '联队').map(r => r.id), ['1', '2', '3', '4'])
  assert.equal(rankSearch([{ id: '1', kind: 'team', title: 'ABC', detail: '' }], 'ａｂｃ')[0].rank, 0)
  assert.equal(rankSearch(items, '.*').length, 0)
})
test('news supports all five categories, safe image/text blocks and server rejects forged fields or unsafe URLs', async () => {
  const f = fixture()
  for (const [index, category] of ['快讯', '战报', '公告', '深度', '独家'].entries()) assert.equal((await f.create({ category }, String(index + 2).repeat(32))).ok, true)
  const valid = await f.create({ coverUrl: 'https://images.example.com/cover.jpg', body: [{ type: 'text', text: '<script>alert(1)</script>' }, { type: 'image', url: 'https://images.example.com/body.jpg', caption: '赛场' }] })
  assert.equal(valid.ok, true)
  for (const change of [{ category: '故事' }, { title: ' ' }, { status: 'hidden' }, { pinned: 'true' }, { coverUrl: 'javascript:alert(1)' }, { coverUrl: 'http://unsafe.test/a.jpg' }, { coverUrl: 'https://name:password@images.example.com/a' }, { body: [{ type: 'html', html: '<b>bad</b>' }] }, { body: [] }, { title: '文'.repeat(81) }, { body: [{ type: 'text', text: '文'.repeat(2001) }] }, { version: 20 }, { deletedAt: 1 }, { competitionId: hidden + 'x' }, { competitionId: `c_${'f'.repeat(32)}` }]) {
    assert.equal((await f.create(change, 'f'.repeat(32))).error.code, 'INVALID_ARGUMENT', JSON.stringify(change))
  }
  assert.equal(f.collections.newsArticles.size, 6)
})
test('concurrent edits reject stale versions, rollback failures and preserve exact stored record', async () => {
  const f = fixture(); await f.create()
  const replies = await Promise.all(['甲', '乙'].map(title => f.call('news.update', { id, expectedVersion: 1, form: { ...form, title } })))
  assert.deepEqual(replies.map(r => r.ok), [true, false]); assert.equal(replies[1].error.code, 'CONFLICT')
  const before = structuredClone(f.collections.newsArticles.get(id)); f.failures.write = true
  assert.equal((await f.call('news.delete', { id, expectedVersion: 2 })).error.code, 'SERVICE_UNAVAILABLE')
  assert.deepEqual(f.collections.newsArticles.get(id), before)
  f.failures.scan = true
  assert.equal((await f.call('search.public', { query: '社区' })).error.code, 'SERVICE_UNAVAILABLE')
})
test('news and search paginate past default 20 rows and invalidate cursors after any relevant change', async () => {
  const f = fixture()
  for (let i = 1; i <= 45; i++) await f.create({ status: 'published', title: `社区内容${i}`, pinned: i === 45 }, i.toString(16).padStart(32, '0'))
  let cursor: string | null = null; const ids: string[] = []
  do { const p = parseNewsPage(await f.call('news.listPublic', cursor ? { cursor } : {})); ids.push(...p.articles.map(a => a.id)); cursor = p.nextCursor } while (cursor)
  assert.equal(ids[0], `n_${(45).toString(16).padStart(32, '0')}`); assert.equal(new Set(ids).size, 45)
  const search = await f.call('search.public', { query: '社区内容', kind: 'news' }), next = await f.call('search.public', { query: '社区内容', kind: 'news', cursor: search.nextCursor })
  assert.equal(search.results.length, 20); assert.equal(next.results.length, 20)
  assert.equal((await f.call('search.public', { query: '社区内容1', cursor: search.nextCursor })).error.code, 'CONFLICT')
  const first = await f.call('news.listPublic')
  assert.equal((await f.call('news.update', { id: `n_${'1'.padStart(32, '0')}`, expectedVersion: 1, form: { ...form, title: '社区变更', status: 'published' } })).ok, true)
  assert.equal((await f.call('news.listPublic', { cursor: first.nextCursor })).error.code, 'CONFLICT')
  assert.equal((await f.call('search.public', { query: '社区内容', kind: 'news', cursor: search.nextCursor })).error.code, 'CONFLICT')
})
test('operational counts and recent content reflect publication and deletion, goals exclude penalty shootout', async () => {
  const f = fixture(); await f.create(); await f.create({ status: 'published' }, '2'.repeat(32))
  const r = parseContentOverview(await f.call('content.overview'))
  assert.deepEqual(r.counts, { teams: 2, matches: 2, goals: 6, news: 2, publishedNews: 1 })
  assert.equal(r.recentNews.length, 2)
  await f.call('news.delete', { id, expectedVersion: 1 })
  assert.equal((await f.call('content.overview')).counts.news, 1)
})
test('parsers reject corrupt pages and URLs; navigation is constructed from validated ids', async () => {
  const f = fixture(), created = await f.create({ status: 'published' })
  assert.throws(() => parseNewsArticle({ ...created.article, coverUrl: 'javascript:alert(1)' }, true))
  assert.throws(() => parseNewsPage({ ok: true, articles: [], total: 0, nextCursor: 'forged' }))
  assert.throws(() => parseSearchPage({ ok: true, results: [{ kind: '__proto__', id: 'bad' }], counts: { team: 0, player: 0, match: 0, news: 0 }, total: 1, nextCursor: null }))
  const r = parseSearchPage(await f.call('search.public', { query: '社区球员' })).results[0]
  assert.equal(publicSearchUrl(r), `/pages/player/detail?id=${playerId}&teamId=${teamId}`)
})
test('search history deduplicates, bounds, validates and clears without server or account data', () => {
  assert.deepEqual(cleanSearchHistory(['  社区  ', '社区', null, 'a'.repeat(41), '']), ['社区'])
  assert.equal(rememberSearch(Array.from({ length: 20 }, (_, i) => `${i}`), '新词').length, 10)
  assert.deepEqual(rememberSearch(['甲', '乙'], '乙'), ['乙', '甲'])
  assert.deepEqual(cleanSearchHistory(null), [])
})
test('content identifiers, query bounds and gateway request size reject coercion and oversized input', async () => {
  const f = fixture()
  assert.equal((await f.call('news.create', { requestId: [key], form })).error.code, 'INVALID_ARGUMENT')
  assert.equal((await f.create({ competitionId: [cid] })).error.code, 'INVALID_ARGUMENT')
  for (const fields of [{ query: '' }, { query: '词'.repeat(41) }, { query: '社区', kind: ['team'] }, { query: '社区', cursor: 'bad' }]) assert.equal((await f.call('search.public', fields)).error.code, 'INVALID_ARGUMENT')
  const http = createHttpHandler(f.service, [], PUBLIC_ACTIONS)
  const r = await http({ httpMethod: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ action: 'news.create', requestId: key, form: { ...form, body: [{ type: 'text', text: '文'.repeat(2000) }, { type: 'text', text: '文'.repeat(2000) }] } }) })
  assert.equal(r.statusCode, 400); assert.equal(f.collections.newsArticles.size, 0)
})
