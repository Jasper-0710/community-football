import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { parseStandings, parseResultHistory } from '../src/domain/standings'
const require = createRequire(import.meta.url)
const { createStandingsService } = require('../cloudfunctions/adminAuth/standings')
const { createMatchService } = require('../cloudfunctions/adminAuth/matches')
const { createMatchMemoryStore } = require('./helpers/match-store.cjs')
const { registrationId } = require('../cloudfunctions/adminAuth/registration-model')
const cid = 'c_' + '1'.repeat(32)
const tid = (n: number) => 't_' + n.toString(16).padStart(64, '0')
const pid = (n: number) => 'p_' + n.toString(16).padStart(32, '0')
const auth = async (token?: string) => token === 'admin' ? { ok: true, admin: { username: 'operator' } } : { ok: false, error: { code: 'UNAUTHORIZED', message: '请登录。' } }
function fixture(count = 4) {
  const memory = createMatchMemoryStore()
  const date = '2026-11-11T00:00:00.000Z'
  memory.competitions.set(cid, { _id: cid, displayEnabled: true, startDate: '2026-11-20', endDate: '2026-12-31', version: 1 })
  for (let i = 1; i <= count; i++) {
    memory.teams.set(tid(i), { _id: tid(i), name: `球队${i}`, status: 'active', contactPhone: 'private', version: 1, roster: [{ id: pid(i * 2), name: `前锋${i}`, number: 9 }, { id: pid(i * 2 + 1), name: `中场${i}`, number: 10 }] })
    memory.registrations.set(registrationId(cid, tid(i)), { competitionId: cid, teamId: tid(i), status: 'approved' })
  }
  const standings = createStandingsService({ store: memory.standingsStore, authorize: auth, now: () => Date.parse(date), logger: { error() {} } })
  const matches = createMatchService({ store: memory.store, authorize: auth, now: () => Date.parse(date), logger: { error() {} } })
  let requestNumber = 0
  const rid = () => (++requestNumber).toString(16).padStart(32, '0')
  const snapshot = async (admin = true) => parseStandings(await standings({ action: admin ? 'standings.getAdmin' : 'standings.getPublic', competitionId: cid, ...(admin ? { token: 'admin' } : {}) }), admin)
  const create = async (home: number | null, away: number | null, extra = {}) => {
    const r = await matches({ action: 'matches.create', token: 'admin', requestId: rid(), form: { competitionId: cid, stage: 'group', groupId: 'A', round: 1, slot: null, homeTeamId: home ? tid(home) : null, awayTeamId: away ? tid(away) : null, homeFrom: null, awayFrom: null, scheduledAt: '2026-11-20T08:00:00.000Z', venue: '社区球场', status: 'scheduled', ...extra } })
    assert.equal(r.ok, true, JSON.stringify(r)); return r.match.id as string
  }
  const rules = async (groups = [{ id: 'A', teamIds: [tid(1), tid(2)] }, { id: 'B', teamIds: [tid(3), tid(4)] }], extra = {}) => standings({ action: 'standings.updateRules', competitionId: cid, expectedRevision: (await snapshot()).revision, rules: { winPoints: 3, drawPoints: 1, lossPoints: 0, legs: 1, groups, ...extra }, token: 'admin' })
  const command = async (action: string, id: string, extra = {}) => {
    const data = await snapshot(), match = data.matches.find(m => m.id === id)!
    return { action: `standings.${action}`, competitionId: cid, id, expectedRevision: data.revision, expectedVersion: match.version, token: 'admin', ...extra }
  }
  const goal = (n: number, assist = true) => ({ teamId: tid(n), minute: 25, ownGoal: false, scorerId: pid(n * 2), assistId: assist ? pid(n * 2 + 1) : null })
  const result = (hs: number, as: number, home = 1, away = 2, penalties: [number, number] | null = null) => ({ homeScore: hs, awayScore: as, penalties, goals: [...Array.from({ length: hs }, () => goal(home)), ...Array.from({ length: as }, () => goal(away))] })
  const save = async (id: string, value: any) => standings(await command('saveResult', id, { requestId: rid(), reason: '官方技术台记录', result: value }))
  const revoke = async (id: string) => standings(await command('revokeResult', id, { requestId: rid(), reason: '技术台撤销并更正' }))
  const bind = async (id: string, home: any, away: any) => standings(await command('bindMatch', id, { homeQualification: home, awayQualification: away }))
  return { ...memory, standings, matches, snapshot, create, rules, command, goal, result, save, revoke, bind, rid }
}

test('standings are public only for visible competitions; admin settings/results/history require auth and public projection is minimal', async () => {
  const f = fixture(), id = await f.create(1, 2)
  assert.equal((await f.rules()).ok, true)
  assert.equal((await f.save(id, f.result(2, 1))).ok, true)
  const publicData = await f.standings({ action: 'standings.getPublic', competitionId: cid })
  parseStandings(publicData)
  const text = JSON.stringify(publicData)
  for (const secret of ['contactPhone', 'operator', 'fingerprint', 'previousResult', 'roster', 'reason']) assert.equal(text.includes(secret), false)
  for (const action of ['getAdmin', 'updateRules', 'saveResult', 'revokeResult', 'bindMatch', 'history']) assert.equal((await f.standings({ action: `standings.${action}`, competitionId: cid, id })).error.code, 'UNAUTHORIZED')
  f.competitions.set(cid, { ...f.competitions.get(cid), displayEnabled: false })
  assert.equal((await f.standings({ action: 'standings.getPublic', competitionId: cid })).error.code, 'NOT_FOUND')
  assert.equal((await f.matches({ action: 'matches.getPublic', id })).error.code, 'NOT_FOUND')
})

test('only completed group matches count, including 0:0; group qualification waits for the full configured schedule and does not break ties by IDs', async () => {
  const f = fixture(), id = await f.create(1, 2), final = await f.create(null, null, { stage: 'final', groupId: null, scheduledAt: '2026-11-22T08:00:00.000Z' })
  await f.rules()
  assert.equal((await f.bind(final, { groupId: 'A', rank: 1 }, { groupId: 'B', rank: 1 })).ok, true)
  let data = await f.snapshot()
  assert.equal(data.groups[0].complete, false); assert.equal(data.groups[0].rows[0].played, 0)
  assert.equal((await f.save(id, f.result(0, 0))).ok, true)
  data = await f.snapshot()
  assert.equal(data.groups[0].complete, true); assert.deepEqual(data.groups[0].rows.map(r => [r.rank, r.points, r.played]), [[1, 1, 1], [1, 1, 1]])
  assert.equal(data.matches.find(m => m.id === final)!.homeTeamId, null)
  assert.deepEqual(data.goals, []); assert.deepEqual(data.assists, [])
  assert.equal((await f.save(final, f.result(0, 0, 1, 3, [4, 3]))).error.code, 'INVALID_ARGUMENT')
})

test('goals and assists use the active result, share equal ranks, exclude own goals and shootout kicks, and do not add knockout results to group points', async () => {
  const f = fixture(), a = await f.create(1, 2), b = await f.create(3, 4, { groupId: 'B' })
  await f.rules(); await f.save(a, f.result(1, 0)); await f.save(b, f.result(1, 0, 3, 4))
  const final = await f.create(null, null, { stage: 'final', groupId: null, scheduledAt: '2026-11-22T08:00:00.000Z' })
  await f.bind(final, { groupId: 'A', rank: 1 }, { groupId: 'B', rank: 1 })
  const score = f.result(1, 1, 1, 3, [5, 4]); score.goals[0] = { teamId: tid(1), minute: 10, ownGoal: true, scorerId: null, assistId: null } as any
  assert.equal((await f.save(final, score)).ok, true)
  const data = await f.snapshot()
  assert.equal(data.groups[0].rows[0].points, 3); assert.equal(data.groups[0].rows[0].goalsFor, 1)
  assert.deepEqual(data.goals.map(r => [r.playerId, r.value, r.rank]), [[pid(6), 2, 1], [pid(2), 1, 2]])
  assert.equal(data.assists.find(r => r.playerId === pid(3))!.value, 1); assert.equal(data.championTeamId, tid(1))
  const schedule = await f.matches({ action: 'matches.listPublic', competitionId: cid, teamId: tid(1) })
  assert.equal(schedule.matches.length, 2); assert.equal(schedule.matches.find((m: any) => m.id === final).homeTeamId, tid(1)); assert.deepEqual(schedule.matches.find((m: any) => m.id === final).penalties, [5, 4])
})

test('result writes are atomic, version checked and retry safe; correction replaces totals and keeps audit history', async () => {
  const f = fixture(), id = await f.create(1, 2); await f.rules()
  const request = await f.command('saveResult', id, { requestId: f.rid(), reason: '初次录入', result: f.result(2, 0) })
  assert.equal((await f.standings(request)).applied, true)
  const version = f.teams.get(tid(1)).version, revision = (await f.snapshot()).revision
  assert.equal((await f.standings(request)).applied, false); assert.equal(f.teams.get(tid(1)).version, version); assert.equal((await f.snapshot()).revision, revision)
  assert.equal((await f.standings({ ...request, result: f.result(1, 0) })).error.code, 'CONFLICT')
  assert.equal((await f.standings({ ...request, requestId: f.rid() })).error.code, 'CONFLICT')
  assert.equal((await f.save(id, f.result(1, 0))).ok, true)
  let data = await f.snapshot(); assert.equal(data.goals[0].value, 1); assert.equal(data.groups[0].rows[0].goalsFor, 1)
  const history = parseResultHistory(await f.standings({ action: 'standings.history', token: 'admin', competitionId: cid, id }))
  assert.deepEqual(history.revisions.map(r => r.result?.homeScore), [1, 2])
  assert.equal((await f.revoke(id)).ok, true); data = await f.snapshot()
  assert.deepEqual(data.goals, []); assert.equal(data.groups[0].rows[0].played, 0); assert.equal(f.revisions.size, 3)
})

test('invalid event ownership, self-assists, mismatched scores, invalid penalties and unknown fields never partially persist', async () => {
  const f = fixture(), id = await f.create(1, 2); await f.rules()
  const before = structuredClone({ records: [...f.records], teams: [...f.teams], competitions: [...f.competitions] })
  const invalid = [
    { ...f.result(1, 0), goals: [] }, { ...f.result(1, 0), goals: [{ ...f.goal(1), scorerId: pid(6) }] },
    { ...f.result(1, 0), goals: [{ ...f.goal(1), assistId: pid(2) }] }, { ...f.result(1, 0), goals: [{ ...f.goal(2) }] },
    { ...f.result(1, 0), penalties: [5, 4] }, { ...f.result(0, 0), penalties: [4, 4] }, { ...f.result(0, 0), unexpected: true },
    { ...f.result(1, 0), goals: [{ ...f.goal(1), ownGoal: true }] }, { ...f.result(1, 0), goals: [{ ...f.goal(1), minute: -1 }] },
  ]
  for (const value of invalid) assert.equal((await f.save(id, value)).error.code, 'INVALID_ARGUMENT')
  assert.deepEqual({ records: [...f.records], teams: [...f.teams], competitions: [...f.competitions] }, before); assert.equal(f.revisions.size, 0)
})

test('group correction and revocation re-resolve multiple knockout rounds and protect already recorded downstream participants', async () => {
  const f = fixture(), a = await f.create(1, 2), b = await f.create(3, 4, { groupId: 'B' }); await f.rules()
  await f.save(a, f.result(1, 0)); await f.save(b, f.result(1, 0, 3, 4))
  const semi1 = await f.create(null, null, { stage: 'semi', groupId: null, scheduledAt: '2026-11-21T08:00:00.000Z' })
  const semi2 = await f.create(null, null, { stage: 'semi', groupId: null, scheduledAt: '2026-11-21T09:00:00.000Z' })
  await f.bind(semi1, { groupId: 'A', rank: 1 }, { groupId: 'B', rank: 2 }); await f.bind(semi2, { groupId: 'B', rank: 1 }, { groupId: 'A', rank: 2 })
  const final = await f.create(null, null, { stage: 'final', groupId: null, homeFrom: semi1, awayFrom: semi2, scheduledAt: '2026-11-22T08:00:00.000Z' })
  assert.equal((await f.save(a, f.result(0, 1))).ok, true)
  assert.equal((await f.snapshot()).matches.find(m => m.id === semi1)!.homeTeamId, tid(2))
  await f.save(semi1, f.result(1, 0, 2, 4)); await f.save(semi2, f.result(1, 0, 3, 1)); await f.save(final, f.result(1, 0, 2, 3))
  const before = structuredClone([...f.records]), historySize = f.revisions.size
  assert.equal((await f.save(a, f.result(1, 0))).error.code, 'CONFLICT'); assert.equal((await f.revoke(semi1)).error.code, 'CONFLICT')
  assert.deepEqual([...f.records], before); assert.equal(f.revisions.size, historySize)
  await f.revoke(final); await f.revoke(semi1); await f.revoke(semi2)
  assert.equal((await f.save(a, f.result(1, 0))).ok, true)
  const after = await f.snapshot(); assert.equal(after.matches.find(m => m.id === semi1)!.homeTeamId, tid(1)); assert.equal(after.matches.find(m => m.id === final)!.homeTeamId, null); assert.equal(after.championTeamId, null)
})

test('concurrent result submissions serialize on one competition revision and preserve a single authoritative result', async () => {
  const f = fixture(), id = await f.create(1, 2); await f.rules()
  const first = await f.command('saveResult', id, { requestId: f.rid(), reason: '首次录入', result: f.result(1, 0) })
  const results = await Promise.all([f.standings(first), f.standings({ ...first, requestId: f.rid(), result: f.result(0, 1) })])
  assert.equal(results.filter(r => r.ok).length, 1); assert.equal(results.find(r => !r.ok).error.code, 'CONFLICT'); assert.equal(f.revisions.size, 1)
})
