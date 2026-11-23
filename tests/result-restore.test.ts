import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { parseResultHistory, parseResultRestorePreview, parseResultRestoreAck } from '../src/domain/standings'
import { createAdminApi } from '../admin/src/api'
const require = createRequire(import.meta.url)
const { createResultRestoreFixture, tid, pid } = require('./helpers/result-restore-fixture.cjs')
const { createStandingsService, PUBLIC_ACTIONS } = require('../cloudfunctions/adminAuth/standings')
const { createHttpHandler } = require('../cloudfunctions/adminAuth/http')
const state = (f: any) => structuredClone([f.records, f.competitions, f.teams, f.revisions])
async function ready() {
  const f = createResultRestoreFixture(), id = await f.create()
  assert.equal((await f.rules()).ok, true)
  assert.equal((await f.save(id, f.result(1, 0))).ok, true)
  const row = (await f.history(id)).revisions[0]
  assert.equal((await f.save(id, f.result(0, 1))).ok, true)
  return { f, id, row }
}

test('D restores the exact selected same-score revision with all original player snapshots, events and statistics', async () => {
  const f = createResultRestoreFixture(), id = await f.create(); await f.rules()
  const full = f.result(2, 1, 1, 2, { goals: [f.goal(1), f.goal(1, { ownGoal: true, scorerId: null, assistId: null }), f.goal(2)],
    cards: [{ teamId: tid(1), minute: 31, kind: 'yellow', playerId: pid(2) }, { teamId: tid(2), minute: 80, kind: 'red', playerId: pid(5) }],
    substitutions: [{ teamId: tid(1), minute: 66, playerInId: pid(3), playerOutId: pid(2) }],
    stats: { possession: [58, 42], shots: [12, 6], shotsOnTarget: [5, 3], corners: [4, 1], fouls: [7, 9], offsides: [1, 2] } })
  assert.equal((await f.save(id, full)).ok, true)
  const original = structuredClone(f.records.get(id).result), target = (await f.history(id)).revisions[0]
  const changed = f.result(2, 1, 1, 2, { goals: [f.goal(1, { scorerId: pid(3), assistId: null, minute: 50 }), f.goal(1, { minute: 70 }), f.goal(2)] })
  assert.equal((await f.save(id, changed)).ok, true)
  const previous = structuredClone(f.records.get(id).result), beforeVersion = f.records.get(id).version
  // A later rename/number change and roster removal must not rewrite history.
  f.teams.get(tid(1)).roster[0].name = '今天的新姓名'; f.teams.get(tid(1)).roster[0].number = 88
  f.teams.get(tid(1)).roster.splice(1, 1); f.teams.get(tid(1)).version++
  const before = state(f), preview = await f.preview(id, target)
  assert.equal(preview.ok, true, JSON.stringify(preview)); assert.deepEqual(state(f), before)
  const { action: _action, token: _token, ...identity } = f.previewCommand(id, target)
  parseResultRestorePreview(preview, identity)
  const command = f.restoreCommand(preview), reply = await f.standings(command)
  assert.equal(reply.ok, true, JSON.stringify(reply)); parseResultRestoreAck(reply, command)
  assert.equal(f.records.get(id).version, beforeVersion + 1); assert.deepEqual(f.records.get(id).result, original)
  const audit = [...f.revisions.values()].at(-1) as any
  assert.deepEqual(audit.previousResult, previous); assert.equal(audit.restoredFromRevisionId, target.id); assert.equal(audit.restoredFromVersion, target.version)
  assert.equal(audit.reason, command.reason); assert.equal(audit.operator, '验收管理员')
  assert.deepEqual(f.revisions.get(target.id).result, original)
  const data = await f.snapshot(); assert.equal(data.groups[0].rows[0].goalsFor, 2)
  assert.equal(data.goals.find((r: any) => r.playerId === pid(2)).value, 1); assert.equal(data.assists.find((r: any) => r.playerId === pid(3)).value, 1)
  const history = parseResultHistory(await f.history(id)); assert.equal(history.revisions[0].restoredFromVersion, target.version)
  const publicMatch = await f.matches({ action: 'matches.getPublic', id })
  assert.deepEqual(publicMatch.match.result, preview.targetResult)
  for (const secret of ['reason', 'fingerprint', 'previousResult', 'restoredFrom', 'operator']) assert.equal(JSON.stringify(publicMatch).includes(secret), false)
})

test('D preview is read only, restore is idempotent after a lost response, changed retry payloads conflict', async () => {
  const { f, id, row } = await ready(), before = state(f), p = await f.preview(id, row)
  assert.equal(p.ok, true, JSON.stringify(p)); assert.deepEqual(state(f), before)
  const request = f.restoreCommand(p), first = await f.standings(request), applied = state(f)
  assert.equal(first.applied, true)
  assert.equal((await f.standings(request)).applied, false); assert.deepEqual(state(f), applied)
  for (const changes of [{ reason: '另一个原因' }, { targetVersion: row.version + 1 }, { targetRevisionId: 'rv_' + 'f'.repeat(64) }, { previewDigest: 'a'.repeat(64) }]) {
    assert.equal((await f.standings({ ...request, ...changes })).error.code, 'CONFLICT'); assert.deepEqual(state(f), applied)
  }
  assert.equal((await f.standings({ ...request, requestId: f.rid() })).error.code, 'CONFLICT'); assert.deepEqual(state(f), applied)
})

test('D rejects stale competition/match versions and a changed team after preview without partial writes', async () => {
  for (const mutation of ['competition', 'match', 'team', 'target']) {
    const { f, id, row } = await ready(), p = await f.preview(id, row), request = f.restoreCommand(p)
    if (mutation === 'competition') f.competitions.get(f.cid).scheduleMutationVersion++
    if (mutation === 'match') f.records.get(id).version++
    if (mutation === 'team') f.teams.get(tid(1)).version++
    if (mutation === 'target') f.revisions.get(row.id).result.goals[0].minute++
    const before = state(f), r = await f.standings(request)
    assert.equal(r.error.code, 'CONFLICT', mutation); assert.deepEqual(state(f), before)
  }
})

test('D rejects absent, foreign, current, future, revoked and malformed targets, never accepts client event replacement', async () => {
  const { f, id, row } = await ready(), current = (await f.history(id)).revisions[0]
  const original = structuredClone(f.revisions.get(row.id)), base = f.previewCommand(id, row)
  for (const change of [{ matchId: 'm_' + 'e'.repeat(32) }, { competitionId: 'c_' + 'e'.repeat(32) }, { result: null, revoked: true }, { version: 999 }, { homeTeamId: tid(3) }, { result: { ...original.result, goals: [] } }, { result: { ...original.result, goals: [{ ...original.result.goals[0], scorer: { id: pid(2), name: '', number: 0 } }] } }]) {
    f.revisions.set(row.id, { ...structuredClone(original), ...change })
    const before = state(f), response = await f.standings(base)
    assert.equal(response.ok, false, JSON.stringify(change)); assert.deepEqual(state(f), before)
  }
  f.revisions.set(row.id, original)
  assert.equal((await f.standings({ ...base, targetRevisionId: 'rv_' + 'f'.repeat(64) })).error.code, 'NOT_FOUND')
  assert.equal((await f.preview(id, current)).error.code, 'CONFLICT')
  assert.equal((await f.standings({ ...base, result: f.result() })).error.code, 'INVALID_ARGUMENT')
  await f.revoke(id); const revoked = (await f.history(id)).revisions[0]; await f.save(id, f.result())
  assert.equal((await f.preview(id, revoked)).error.code, 'INVALID_ARGUMENT')
})

test('D refuses changed or swapped participants and ineligible registrations or dissolved teams', async () => {
  for (const kind of ['swapped', 'replaced', 'unapproved', 'dissolved']) {
    const { f, id, row } = await ready(); await f.revoke(id)
    if (kind === 'swapped') Object.assign(f.records.get(id), { homeTeamId: tid(2), awayTeamId: tid(1) })
    if (kind === 'replaced') f.records.get(id).awayTeamId = tid(3)
    if (kind === 'unapproved') for (const r of f.registrations.values()) if (r.teamId === tid(1)) r.status = 'rejected'
    if (kind === 'dissolved') f.teams.get(tid(1)).status = 'dissolved'
    const before = state(f), reply = await f.preview(id, row)
    assert.equal(reply.ok, false, kind); assert.deepEqual(state(f), before)
  }
})

test('D restores revoked live results with their minute and keeps them out of completed standings', async () => {
  const f = createResultRestoreFixture(), id = await f.create(); await f.rules()
  await f.save(id, f.result(1, 0, 1, 2, { state: 'live', minute: 38 })); const row = (await f.history(id)).revisions[0]
  await f.revoke(id)
  const p = await f.preview(id, row); assert.equal(p.currentResult, null); assert.equal(p.targetResult.state, 'live')
  assert.equal((await f.standings(f.restoreCommand(p))).ok, true)
  const data = await f.snapshot(); assert.equal(data.matches[0].status, 'live'); assert.equal(data.matches[0].result.minute, 38)
  assert.deepEqual(data.goals, []); assert.equal(data.groups[0].rows[0].played, 0)
})

test('D restores penalty winners and recomputes champion, and validates old result against current stage', async () => {
  const f = createResultRestoreFixture(), id = await f.create(1, 2, { stage: 'final', groupId: null, slot: 1 })
  await f.save(id, f.result(0, 0, 1, 2, { penalties: [5, 4] })); const row = (await f.history(id)).revisions[0]
  await f.save(id, f.result(0, 0, 1, 2, { penalties: [3, 4] }))
  assert.equal((await f.snapshot()).championTeamId, tid(2))
  const p = await f.preview(id, row); assert.equal((await f.standings(f.restoreCommand(p))).ok, true)
  assert.equal((await f.snapshot()).championTeamId, tid(1)); assert.deepEqual(f.records.get(id).result.penalties, [5, 4])
  await f.revoke(id); Object.assign(f.records.get(id), { stage: 'group', groupId: 'A', slot: null })
  const before = state(f); assert.equal((await f.preview(id, row)).error.code, 'INVALID_ARGUMENT'); assert.deepEqual(state(f), before)
})

test('D protects both live and finished downstream results at preview and commit; revoking downstream permits restoration', async () => {
  for (const status of ['live', 'finished']) {
    const { f, id, row } = await ready(), b = await f.create(3, 4, { groupId: 'B' }); await f.save(b, f.result(1, 0, 3, 4))
    const semi = await f.create(null, null, { stage: 'semi', groupId: null, scheduledAt: '2026-12-10T08:00:00.000Z' })
    await f.standings(f.command('bindMatch', semi, { homeQualification: { groupId: 'A', rank: 1 }, awayQualification: { groupId: 'B', rank: 1 } }))
    const p = await f.preview(id, row); assert.equal(p.ok, true)
    await f.save(semi, f.result(1, 0, 2, 3, { state: status, minute: 40 }))
    let before = state(f); assert.equal((await f.standings(f.restoreCommand(p))).error.code, 'CONFLICT'); assert.deepEqual(state(f), before)
    const blocked = await f.preview(id, row); assert.equal(blocked.error.code, 'CONFLICT'); assert.match(blocked.error.message, /后续比赛/); assert.deepEqual(state(f), before)
    await f.revoke(semi); const allowed = await f.preview(id, row); assert.equal(allowed.ok, true)
    assert.equal((await f.standings(f.restoreCommand(allowed))).ok, true)
    assert.equal((await f.snapshot()).matches.find((m: any) => m.id === semi).homeTeamId, tid(1))
  }
})

test('D concurrent restores have one authoritative new revision, and read handles remain sequential', async () => {
  const { f, id, row } = await ready(), p = await f.preview(id, row), requests = [f.restoreCommand(p), f.restoreCommand(p)]
  const replies = await Promise.all(requests.map(r => f.standings(r)))
  assert.equal(replies.filter(r => r.ok).length, 1); assert.equal(replies.find(r => !r.ok).error.code, 'CONFLICT'); assert.equal(f.revisions.size, 3)
  const guarded = { ...f.standingsStore, transaction: (cid: string, callback: any) => f.standingsStore.transaction(cid, async (tx: any) => {
    let pending = false
    const wrapped = Object.fromEntries(Object.entries(tx).map(([key, method]) => [key, async (...args: any[]) => { assert.equal(pending, false, 'overlapping transaction reads'); pending = true; try { await new Promise(r => setTimeout(r, 1)); return await (method as any)(...args) } finally { pending = false } }]))
    return callback(wrapped)
  }) }
  const service = createStandingsService({ store: guarded, authorize: f.authorize })
  const next = await service(f.previewCommand(id, row)); assert.equal(next.ok, true, JSON.stringify(next))
  assert.equal((await service(f.restoreCommand(next))).ok, true)
})

test('D preview and restore require admin auth and never enter the public allowlist', async () => {
  const { f, id, row } = await ready()
  for (const action of ['standings.previewRestoreResult', 'standings.restoreResult']) {
    assert.equal((await f.standings({ action, competitionId: f.cid })).error.code, 'UNAUTHORIZED'); assert.equal(PUBLIC_ACTIONS.includes(action), false)
  }
  const handler = createHttpHandler(f.standings, ['https://local.example'], PUBLIC_ACTIONS)
  const reply = await handler({ httpMethod: 'POST', headers: { origin: 'https://local.example' }, body: JSON.stringify(f.previewCommand(id, row)) })
  assert.notEqual(reply.statusCode, 200) // token inside body is not a bearer authorization.
})

test('D history paginates by exact revision and validates compatibility and restore metadata', async () => {
  const { f, id } = await ready()
  for (let n = 0; n < 21; n++) await f.save(id, f.result(n % 2, 0))
  const first = parseResultHistory(await f.history(id)); assert.equal(first.revisions.length, 20); assert.ok(first.nextVersion)
  const second = parseResultHistory(await f.standings({ action: 'standings.history', token: 'fixture-admin', competitionId: f.cid, id, beforeVersion: first.nextVersion }))
  assert.equal(second.revisions.length, 3); assert.equal(new Set([...first.revisions, ...second.revisions].map(r => r.id)).size, 23)
  const p = await f.preview(id, second.revisions.at(-1)); assert.equal(p.ok, true)
  const legacy = { ok: true, revisions: [{ ...second.revisions[0], id: undefined, homeTeamId: undefined, awayTeamId: undefined }], nextVersion: null }
  assert.equal(parseResultHistory(legacy).revisions[0].id, undefined)
  for (const change of [{ id: 'bad' }, { restoredFromVersion: 1 }, { restoredFromRevisionId: 'rv_' + 'a'.repeat(64), restoredFromVersion: second.revisions[0].version }]) {
    assert.throws(() => parseResultHistory({ ...legacy, revisions: [{ ...legacy.revisions[0], ...change }] }))
  }
})

test('D admin API binds previews and restore receipts to the requested match, versions and target', async () => {
  const { f, id, row } = await ready(), target = f.previewCommand(id, row)
  const { action, token, ...identity } = target, p = await f.standings(target)
  parseResultRestorePreview(p, identity)
  const calls: any[] = []
  const api = createAdminApi('http://localhost/api', (async (_url: any, init: any) => {
    const event = JSON.parse(init.body); calls.push({ event, headers: init.headers }); const response = await f.standings({ ...event, token: 'fixture-admin' })
    return new Response(JSON.stringify(response), { status: response.ok ? 200 : 409 })
  }) as typeof fetch)
  const preview = await api.previewResultRestore('fixture-admin', identity); assert.equal(preview.digest, p.digest)
  const { action: _a, token: _t, ...form } = f.restoreCommand(preview)
  assert.equal((await api.restoreResult('fixture-admin', form)).applied, true)
  assert.equal((await api.restoreResult('fixture-admin', form)).applied, false)
  assert.equal(calls[0].headers.Authorization, 'Bearer fixture-admin'); assert.equal(calls[0].event.token, undefined)
  for (const change of [{ id: 'm_' + 'f'.repeat(32) }, { expectedRevision: 999 }, { targetVersion: 999 }, { digest: 'bad' }, { targetResult: null }]) assert.throws(() => parseResultRestorePreview({ ...p, ...change }, identity))
  const ack = await f.standings({ ...form, action: 'standings.restoreResult', token: 'fixture-admin' })
  for (const change of [{ version: form.expectedVersion }, { restoredFromVersion: 999 }, { restoredFromRevisionId: 'rv_' + 'f'.repeat(64) }, { applied: 'yes' }, { revision: 0 }]) assert.throws(() => parseResultRestoreAck({ ...ack, ...change }, form))
})

test('D a database failure after pending match/team writes rolls back everything, and the original request can be retried', async () => {
  const { f, id, row } = await ready(), p = await f.preview(id, row), request = f.restoreCommand(p), before = state(f)
  const broken = createStandingsService({ authorize: f.authorize, logger: { error() {} }, store: { ...f.standingsStore, transaction: (cid: string, callback: any) => f.standingsStore.transaction(cid, (tx: any) => callback({ ...tx, writeRevision: async () => { throw new Error('storage unavailable after pending writes') } })) } })
  assert.equal((await broken(request)).error.code, 'SERVICE_UNAVAILABLE'); assert.deepEqual(state(f), before)
  assert.equal((await f.standings(request)).applied, true); assert.equal(f.revisions.size, 3)
})

test('D whole-platform recovery excludes single-match restore writes and previews while its lock is held', async () => {
  const { createRecoveryGuard, withRecoveryLock } = require('../cloudfunctions/adminAuth/recovery-guard')
  const { createRecoveryMemory } = require('./helpers/recovery-store.cjs')
  const control = createRecoveryMemory(), { f, id, row } = await ready(), p = await f.preview(id, row), request = f.restoreCommand(p), before = state(f)
  const guard = createRecoveryGuard({ control: control.control })
  const result = await withRecoveryLock(control.control, 'restore', async () => {
    for (const [event, readOnly] of [[f.previewCommand(id, row), true], [request, false]]) assert.equal((await guard(event, f.standings, readOnly)).error.code, 'SERVICE_MAINTENANCE')
    return { ok: true }
  })
  assert.equal(result.ok, true); assert.deepEqual(state(f), before)
  assert.equal((await guard(request, f.standings)).ok, true); assert.deepEqual((await control.control.read()).leases, [])
})
