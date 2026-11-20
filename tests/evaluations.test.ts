import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEvaluationPublic, parseEvaluationAdmin, parseEvaluationConfig, evaluationBeijingTime, evaluationUtcTime } from '../src/domain/evaluation'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createEvaluationService, PUBLIC_ACTIONS } = require('../cloudfunctions/adminAuth/evaluations')
const { createContentMemoryStore } = require('./helpers/content-store.cjs')
const { registrationId } = require('../cloudfunctions/adminAuth/registration-model')
const { createHttpHandler } = require('../cloudfunctions/adminAuth/http')
const cid = 'c_' + '1'.repeat(32), mid = 'm_' + '2'.repeat(32), other = 'm_' + '3'.repeat(32)
const tid = (n: number) => 't_' + n.toString(16).padStart(64, '0')
const pid = (n: number) => 'p_' + n.toString(16).padStart(32, '0')
const rid = (n: number) => n.toString(16).padStart(32, '0')
const config = { enabled: true, commentsEnabled: true, scoreMin: 1, scoreMax: 10, openedAt: null, closedAt: null }
const mvp = { type: 'mvp', playerId: pid(1), position: null, rank: 1 }
function fixture() {
  const memory = createContentMemoryStore(); let now = Date.parse('2026-11-20T12:00:00.000Z')
  memory.collections.competitions.set(cid, { _id: cid, displayEnabled: true })
  for (const [n, roster] of [[1, [1, 2]], [2, [3]]] as const) {
    memory.collections.teams.set(tid(n), { _id: tid(n), name: `球队${n}`, status: 'active', roster: roster.map(i => ({ id: pid(i), name: `球员${i}`, number: i, position: 'forward' })) })
    const id = registrationId(cid, tid(n)); memory.collections.registrations.set(id, { _id: id, competitionId: cid, teamId: tid(n), status: 'approved' })
  }
  for (const id of [mid, other]) memory.collections.matches.set(id, { _id: id, competitionId: cid, status: 'finished', homeTeamId: tid(1), awayTeamId: tid(2) })
  let wx: any = { APPID: 'wx3230f06c755cef3a', OPENID: 'openid-a' }
  const service = createEvaluationService({ store: memory.store, authorize: async (token: string) => token === 'admin' ? { ok: true, admin: { username: 'admin' } } : { ok: false, error: { code: 'UNAUTHORIZED', message: '请登录。' } }, context: () => wx, expectedAppId: 'wx3230f06c755cef3a', now: () => now, logger: { error() {} } })
  const read = () => service({ action: 'evaluation.getPublic', matchId: mid })
  const admin = () => service({ action: 'evaluation.getAdmin', token: 'admin', matchId: mid })
  const configure = (fields = {}, expectedVersion = 0, requestId = rid(100)) => service({ action: 'evaluation.configure', token: 'admin', competitionId: cid, expectedVersion, requestId, config: { ...config, ...fields } })
  const rate = (score = 8, requestId = rid(1), playerId = pid(1)) => service({ action: 'evaluation.rate', matchId: mid, playerId, score, requestId })
  const comment = (content = '积极跑动\n继续加油', requestId = rid(2)) => service({ action: 'evaluation.comment', matchId: mid, playerId: pid(1), content, requestId })
  const publish = (awards = [mvp], expectedVersion = 0, requestId = rid(200), matchId = mid) => service({ action: 'evaluation.publishAwards', token: 'admin', matchId, expectedVersion, requestId, awards })
  const moderate = (id: string, hidden: boolean, expectedVersion: number) => service({ action: 'evaluation.moderateComment', token: 'admin', id, hidden, expectedVersion })
  return { memory, service, read, admin, configure, rate, comment, publish, moderate, as: (id: string) => { wx = { APPID: 'wx3230f06c755cef3a', OPENID: id } }, context: (value: any) => { wx = value }, time: (value: string) => { now = Date.parse(value) } }
}
test('D12 defaults closed, returns registered players and strips user/request metadata', async () => {
  const f = fixture(), result = await f.read(), parsed = parseEvaluationPublic(result)
  assert.equal(parsed.canRate, false); assert.equal(parsed.config.enabled, false)
  assert.deepEqual(parsed.players.map(row => row.playerId), [pid(1), pid(2), pid(3)])
  await f.configure(); await f.rate(); await f.comment()
  const raw = JSON.stringify(await f.read())
  for (const field of ['openid-a', 'voterId', 'authorId', 'requests', 'commentVersions', 'hiddenComments']) assert.equal(raw.includes(field), false)
})
test('D12 window is server enforced: future/start/end boundaries, disabled comments and unfinished match', async () => {
  const f = fixture(); assert.equal((await f.rate()).error.code, 'EVALUATION_CLOSED')
  await f.configure({ openedAt: '2026-11-20T13:00:00.000Z', closedAt: '2026-11-21T00:00:00.000Z' })
  assert.equal((await f.rate()).error.code, 'EVALUATION_CLOSED'); assert.equal((await f.read()).canRate, false)
  f.time('2026-11-20T13:00:00.000Z'); assert.equal((await f.rate()).ok, true)
  f.time('2026-11-21T00:00:00.000Z'); assert.equal((await f.rate(9, rid(3))).error.code, 'EVALUATION_CLOSED')
  // Acknowledging an already committed request is safe after closing.
  assert.equal((await f.rate()).applied, false)
  await f.configure({ commentsEnabled: false }, 1, rid(101))
  assert.equal((await f.comment()).error.code, 'EVALUATION_CLOSED')
  f.memory.collections.matches.get(mid).status = 'live'
  assert.equal((await f.rate(9, rid(4))).error.code, 'EVALUATION_CLOSED')
  assert.equal((await f.publish()).error.code, 'EVALUATION_CLOSED')
})
test('D12 trusts native context only, denies wrong app/anonymous and forged event identities', async () => {
  const f = fixture(); await f.configure()
  for (const context of [null, {}, { OPENID: 'a', APPID: 'wrong' }]) { f.context(context); assert.equal((await f.rate()).error.code, 'AUTH_REQUIRED'); assert.equal((await f.read()).ok, true) }
  f.as('openid-a')
  assert.equal((await f.service({ action: 'evaluation.rate', matchId: mid, playerId: pid(1), score: 8, requestId: rid(1), OPENID: 'forged' })).error.code, 'INVALID_ARGUMENT')
  assert.equal((await f.service({ action: 'evaluation.getAdmin', matchId: mid })).error.code, 'UNAUTHORIZED')
})
test('D12 per-user latest score, averages and request retries do not duplicate or overwrite newer scores', async () => {
  const f = fixture(); await f.configure()
  assert.equal((await f.rate()).applied, true); assert.equal((await f.rate()).applied, false)
  assert.equal((await f.rate(9)).error.code, 'CONFLICT')
  assert.equal((await f.rate(10, rid(3))).ok, true); assert.equal((await f.rate()).score, 10)
  f.as('openid-b'); assert.equal((await f.rate(6, rid(4))).ok, true)
  let player = (await f.read()).players[0]; assert.equal(player.viewerScore, 6); assert.equal(player.ratingAverage, 8); assert.equal(player.ratingCount, 2)
  f.as('openid-a'); player = (await f.read()).players[0]; assert.equal(player.viewerScore, 10)
  assert.equal((await f.rate(11, rid(5))).error.code, 'INVALID_ARGUMENT'); assert.equal((await f.rate(7.5, rid(6))).error.code, 'INVALID_ARGUMENT')
  assert.equal(f.memory.collections.playerRatings.size, 2)
})
test('D12 player eligibility uses approved registrations and resolved knockout result teams', async () => {
  const f = fixture(); await f.configure()
  const match = f.memory.collections.matches.get(mid); match.homeTeamId = null; match.awayTeamId = null; match.result = { homeTeamId: tid(1), awayTeamId: tid(2) }
  assert.equal((await f.read()).players.length, 3); assert.equal((await f.rate()).ok, true)
  assert.equal((await f.rate(8, rid(3), pid(99))).error.code, 'INVALID_ARGUMENT')
  f.memory.collections.registrations.get(registrationId(cid, tid(1))).status = 'rejected'
  assert.equal((await f.rate(8, rid(4))).error.code, 'INVALID_ARGUMENT')
  assert.equal((await f.publish()).error.code, 'INVALID_ARGUMENT'); assert.equal((await f.read()).players.length, 1)
})
test('D12 comments require review; edit resets visibility; stale moderation cannot publish changed content', async () => {
  const f = fixture(); await f.configure(); const first = await f.comment(); assert.equal(first.ok, true)
  assert.equal((await f.read()).comments.length, 0)
  let admin = parseEvaluationAdmin(await f.admin()); assert.equal(admin.hiddenComments.length, 1); assert.equal(admin.commentVersions[first.commentId], 1)
  assert.equal((await f.moderate(first.commentId, false, 1)).ok, true); assert.equal((await f.read()).comments.length, 1)
  assert.equal((await f.comment('修改后需要再次审核', rid(3))).commentId, first.commentId)
  assert.equal((await f.read()).comments.length, 0); assert.equal((await f.moderate(first.commentId, false, 2)).error.code, 'CONFLICT')
  assert.equal((await f.moderate(first.commentId, false, 3)).ok, true)
  assert.equal((await f.moderate(first.commentId, true, 4)).ok, true); assert.equal((await f.read()).comments.length, 0)
  assert.equal((await f.moderate(first.commentId, false, 5)).ok, true)
  // Retrying the original comment must not replace the revised content or unhide it.
  assert.equal((await f.comment()).applied, false); assert.equal((await f.read()).comments[0].content, '修改后需要再次审核')
  assert.equal((await f.comment('不同内容')).error.code, 'CONFLICT')
  assert.equal((await f.comment('x'.repeat(301), rid(4))).error.code, 'INVALID_ARGUMENT')
  assert.equal((await f.comment('\u0000bad', rid(5))).error.code, 'INVALID_ARGUMENT')
})
test('D12 awards are match scoped, validate candidates and duplicates, and can be withdrawn', async () => {
  const f = fixture(); assert.equal((await f.publish([mvp, { type: 'lineup', playerId: pid(2), position: '中场', rank: 1 }])).ok, true)
  assert.equal(parseEvaluationPublic(await f.read()).awards.length, 2)
  assert.equal((await f.service({ action: 'evaluation.getPublic', matchId: other })).awards.length, 0)
  assert.equal((await f.publish([mvp], 0, rid(201))).error.code, 'CONFLICT')
  assert.equal((await f.publish([mvp, mvp], 1, rid(202))).error.code, 'INVALID_ARGUMENT')
  assert.equal((await f.publish([{ ...mvp, playerId: pid(99) }], 1, rid(203))).error.code, 'INVALID_ARGUMENT')
  assert.equal((await f.publish([], 1, rid(204))).version, 2); assert.equal((await f.read()).awards.length, 0)
  assert.equal((await f.publish([mvp], 2, rid(205))).ok, true)
  f.memory.collections.matches.get(mid).status = 'scheduled'; assert.equal((await f.read()).awards.length, 0)
})
test('D12 transactional config/awards versions allow only one concurrent writer', async () => {
  const f = fixture()
  const configs = await Promise.all([f.configure({}, 0, rid(101)), f.configure({}, 0, rid(102))]); assert.equal(configs.filter(r => r.ok).length, 1)
  const awards = await Promise.all([f.publish([mvp], 0, rid(201)), f.publish([], 0, rid(202))]); assert.equal(awards.filter(r => r.ok).length, 1)
  assert.equal(f.memory.collections.evaluationConfigs.get(cid).version, 1); assert.equal(f.memory.collections.playerAwards.get(mid).version, 1)
})
test('D12 failed transactions leave no records and service errors are sanitized', async () => {
  const f = fixture(); await f.configure(); f.memory.failures.write = true
  for (const result of [await f.rate(), await f.comment(), await f.publish(), await f.configure({}, 1, rid(101))]) assert.equal(result.error.code, 'SERVICE_UNAVAILABLE')
  assert.equal(f.memory.collections.playerRatings.size, 0); assert.equal(f.memory.collections.playerComments.size, 0); assert.equal(f.memory.collections.playerAwards.size, 0)
  assert.equal(f.memory.collections.evaluationConfigs.get(cid).version, 1)
  f.memory.failures.write = false; f.memory.failures.scan = true
  assert.equal((await f.read()).error.code, 'SERVICE_UNAVAILABLE')
})
test('D12 hidden competitions deny public reads and writes without leaking data', async () => {
  const f = fixture(); await f.configure(); await f.rate(); f.memory.collections.competitions.get(cid).displayEnabled = false
  assert.equal((await f.read()).error.code, 'NOT_FOUND'); assert.equal((await f.rate(9, rid(5))).error.code, 'NOT_FOUND'); assert.equal((await f.comment()).error.code, 'NOT_FOUND')
  assert.equal((await f.admin()).ok, true)
})
test('D12 HTTPS permits anonymous public reads but never native user mutations', async () => {
  const f = fixture(), http = createHttpHandler(f.service, [], PUBLIC_ACTIONS)
  const request = (action: string) => http({ httpMethod: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, matchId: mid }) })
  assert.equal((await request('evaluation.getPublic')).statusCode, 200)
  for (const action of ['evaluation.rate', 'evaluation.comment', 'evaluation.configure', 'evaluation.getAdmin', 'evaluation.publishAwards', 'evaluation.moderateComment']) assert.equal((await request(action)).statusCode, 401)
})
test('D12 parsers reject malformed and cross-match payloads; Beijing time roundtrips without drift', async () => {
  const f = fixture(), original = await f.read(); parseEvaluationPublic(original); parseEvaluationAdmin(await f.admin())
  for (const change of [{ canRate: true }, { canRate: false, canComment: true }, { players: [...original.players, original.players[0]] }, { config: { ...original.config, competitionId: 'c_' + 'a'.repeat(32) } }, { awards: [{ ...mvp, playerId: pid(99) }] }]) assert.throws(() => parseEvaluationPublic({ ...original, ...change }))
  assert.throws(() => parseEvaluationConfig({ ...original.config, scoreMin: 10, scoreMax: 1 }))
  await f.configure(); await f.comment(); const admin = await f.admin(); assert.throws(() => parseEvaluationAdmin({ ...admin, commentVersions: {} }))
  assert.equal(evaluationUtcTime('2026-11-20T20:35'), '2026-11-20T12:35:00.000Z')
  assert.equal(evaluationBeijingTime('2026-11-20T20:35:00.000Z'), '2026-11-21T04:35')
  assert.equal(evaluationUtcTime(evaluationBeijingTime('2026-11-20T12:35:00.000Z')), '2026-11-20T12:35:00.000Z')
  assert.equal(evaluationUtcTime(''), null)
  for (const value of ['garbage', '2026-02-30T08:00', '2026-11-20T24:01']) assert.throws(() => evaluationUtcTime(value))
})
