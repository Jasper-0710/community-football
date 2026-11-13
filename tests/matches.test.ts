import test from 'node:test'
import assert from 'node:assert/strict'
import { createMatchService } from '../cloudfunctions/adminAuth/matches.js'
import { createRequire } from 'node:module'
import { filterMatchSchedule, matchDate, matchTime, parseMatchPage } from '../src/domain/match'
const require = createRequire(import.meta.url)
const { createMatchMemoryStore } = require('./helpers/match-store.cjs')
const { registrationId } = require('../cloudfunctions/adminAuth/registration-model.js')

const cid = 'c_' + 'c'.repeat(32)
const home = 't_' + 'a'.repeat(64)
const away = 't_' + 'b'.repeat(64)
const mid = 'm_' + 'd'.repeat(32)

function fixture() {
  const { store, records, competitions, teams, registrations } = createMatchMemoryStore()
  competitions.set(cid, { _id: cid, displayEnabled: true, startDate: '2026-11-20', endDate: '2026-11-30' })
  for (const teamId of [home, away]) {
    teams.set(teamId, { _id: teamId, status: 'active', version: 1 })
    registrations.set(registrationId(cid, teamId), { competitionId: cid, teamId, status: 'approved' })
  }
  const authorize = async (token?: string) => token === 'admin-token' ? { ok: true, admin: { username: 'admin' } } : { ok: false, error: { code: 'UNAUTHORIZED', message: '请先登录管理后台。' } }
  const service = createMatchService({ store, authorize, now: () => Date.parse('2026-11-11T00:00:00.000Z'), logger: { error() {} } })
  const form = { competitionId: cid, stage: 'group', round: 1, groupId: 'A', slot: 1, homeTeamId: home, awayTeamId: away, homeFrom: null, awayFrom: null, scheduledAt: '2026-11-20T08:00:00.000Z', venue: '社区球场', status: 'scheduled' }
  return { service, store, records, competitions, teams, registrations, form }
}

test('schedule creation is admin-only, idempotent, versioned and rejects dissolved teams', async () => {
  const f = fixture()
  const create = await f.service({ action: 'matches.create', requestId: '1'.repeat(32), form: f.form, token: 'admin-token' })
  assert.equal(create.ok, true); assert.equal(create.created, true); assert.equal(create.match.id, 'm_' + '1'.repeat(32)); assert.equal(create.match.homeScore, null)
  const retry = await f.service({ action: 'matches.create', requestId: '1'.repeat(32), form: f.form, token: 'admin-token' })
  assert.equal(retry.ok, true); assert.equal(retry.created, false)
  assert.equal((await f.service({ action: 'matches.create', requestId: '2'.repeat(32), form: f.form, token: 'bad' })).error.code, 'UNAUTHORIZED')
  f.teams.set(away, { _id: away, status: 'dissolved' })
  assert.equal((await f.service({ action: 'matches.create', requestId: '3'.repeat(32), form: f.form, token: 'admin-token' })).error.code, 'INVALID_ARGUMENT')
})

test('public schedule hides unpublished events and supports stable team filtering', async () => {
  const f = fixture()
  await f.service({ action: 'matches.create', requestId: 'a'.repeat(32), form: f.form, token: 'admin-token' })
  const publicPage = await f.service({ action: 'matches.listPublic', competitionId: cid })
  assert.equal(publicPage.ok, true); assert.equal(publicPage.matches.length, 1); assert.equal('version' in publicPage.matches[0], false)
  assert.equal((await f.service({ action: 'matches.listPublic', competitionId: cid, teamId: away })).matches.length, 1)
  f.competitions.set(cid, { _id: cid, displayEnabled: false })
  assert.equal((await f.service({ action: 'matches.listPublic', competitionId: cid })).error.code, 'NOT_FOUND')
  assert.equal((await f.service({ action: 'matches.getPublic', id: 'm_' + 'a'.repeat(32) })).error.code, 'NOT_FOUND')
})

test('schedule edits enforce optimistic versions and cannot move a match to another competition', async () => {
  const f = fixture(), created = await f.service({ action: 'matches.create', requestId: 'b'.repeat(32), form: f.form, token: 'admin-token' })
  const next = { ...f.form, scheduledAt: '2026-11-20T10:00:00.000Z' }
  const updated = await f.service({ action: 'matches.update', id: created.match.id, expectedVersion: 1, form: next, token: 'admin-token' })
  assert.equal(updated.ok, true); assert.equal(updated.match.version, 2); assert.equal(updated.match.scheduledAt, next.scheduledAt)
  assert.equal((await f.service({ action: 'matches.update', id: created.match.id, expectedVersion: 1, form: next, token: 'admin-token' })).error.code, 'CONFLICT')
  assert.equal((await f.service({ action: 'matches.update', id: created.match.id, expectedVersion: 2, form: { ...next, competitionId: 'c_' + 'e'.repeat(32) }, token: 'admin-token' })).error.code, 'INVALID_ARGUMENT')
})

test('schedule editing rejects live, finished and residual results without any partial writes', async () => {
  for (const [status, result] of [
    ['live', null], ['finished', null],
    ['scheduled', { state: 'live', homeTeamId: home, awayTeamId: away, homeScore: 0, awayScore: 0, goals: [] }],
    ['postponed', { state: 'finished', homeTeamId: home, awayTeamId: away, homeScore: 0, awayScore: 0, goals: [] }],
  ] as const) {
    const f = fixture()
    const created = await f.service({ action: 'matches.create', requestId: '5'.repeat(32), form: f.form, token: 'admin-token' })
    const record = f.records.get(created.match.id)
    f.records.set(record._id, { ...record, status, result })
    const before = structuredClone({ records: [...f.records], teams: [...f.teams], competitions: [...f.competitions] })
    const response = await f.service({ action: 'matches.update', id: record._id, expectedVersion: record.version,
      form: { ...f.form, scheduledAt: '2026-11-20T10:00:00.000Z', status: 'scheduled' }, token: 'admin-token' })
    assert.equal(response.error.code, 'CONFLICT', `${status} must require result revocation`)
    assert.deepEqual({ records: [...f.records], teams: [...f.teams], competitions: [...f.competitions] }, before)
  }
})

test('schedule writes require approval and atomically touch referenced teams without modifying their rosters', async () => {
  const f = fixture(), before = structuredClone([...f.teams])
  f.registrations.set(registrationId(cid, away), { competitionId: cid, teamId: away, status: 'pending' })
  const request = { action: 'matches.create', requestId: '4'.repeat(32), form: f.form, token: 'admin-token' }
  assert.equal((await f.service(request)).error.code, 'INVALID_ARGUMENT')
  assert.deepEqual([...f.teams], before); assert.equal(f.records.size, 0)
  f.registrations.set(registrationId(cid, away), { competitionId: cid, teamId: away, status: 'approved' })
  assert.equal((await f.service(request)).ok, true)
  assert.equal(f.teams.get(home).version, 2); assert.equal(f.teams.get(away).version, 2)
  assert.equal(f.competitions.get(cid).scheduleMutationVersion, 1)
  await f.service(request)
  assert.equal(f.teams.get(home).version, 2); assert.equal(f.competitions.get(cid).scheduleMutationVersion, 1)
})

test('schedule dates use Beijing boundaries rather than the UTC date', async () => {
  const f = fixture()
  for (const [index, scheduledAt, ok] of [
    [1, '2026-11-19T15:59:00.000Z', false], [2, '2026-11-19T16:00:00.000Z', true],
    [3, '2026-11-30T15:59:00.000Z', true], [4, '2026-11-30T16:00:00.000Z', false],
  ] as const) {
    const result = await f.service({ action: 'matches.create', requestId: String(index).repeat(32), form: { ...f.form, scheduledAt }, token: 'admin-token' })
    assert.equal(result.ok, ok)
  }
  assert.equal(f.records.size, 2)
})

test('knockout references stay within the event and preserve chronological stage order on edits', async () => {
  const f = fixture()
  const source = await f.service({ action: 'matches.create', requestId: '5'.repeat(32), form: f.form, token: 'admin-token' })
  const form = { ...f.form, stage: 'semi', homeTeamId: null, awayTeamId: null, homeFrom: source.match.id, scheduledAt: '2026-11-21T08:00:00.000Z' }
  for (const changes of [{ homeFrom: mid }, { awayFrom: source.match.id }, { homeTeamId: home }, { stage: 'group' }, { scheduledAt: f.form.scheduledAt }, { homeFrom: 'm_' + '6'.repeat(32) }]) {
    assert.equal((await f.service({ action: 'matches.create', requestId: '6'.repeat(32), form: { ...form, ...changes }, token: 'admin-token' })).ok, false)
  }
  const next = await f.service({ action: 'matches.create', requestId: '6'.repeat(32), form, token: 'admin-token' })
  assert.equal(next.ok, true)
  const before = structuredClone([...f.records])
  const blocked = await f.service({ action: 'matches.update', id: source.match.id, expectedVersion: 1, form: { ...f.form, scheduledAt: '2026-11-22T08:00:00.000Z' }, token: 'admin-token' })
  assert.equal(blocked.error.code, 'CONFLICT'); assert.deepEqual([...f.records], before)
  f.records.set(mid, { ...f.records.get(source.match.id), _id: mid, competitionId: 'c_' + 'e'.repeat(32) })
  assert.equal((await f.service({ action: 'matches.create', requestId: '7'.repeat(32), form: { ...form, homeFrom: mid }, token: 'admin-token' })).ok, false)
})

test('public pages paginate all matches once without leaking administrative fields or unsupported states', async () => {
  const f = fixture()
  for (let n = 1; n <= 25; n++) assert.equal((await f.service({ action: 'matches.create', requestId: n.toString(16).padStart(32, '0'), form: f.form, token: 'admin-token' })).ok, true)
  const first = await f.service({ action: 'matches.listPublic', competitionId: cid, teamId: home })
  const second = await f.service({ action: 'matches.listPublic', competitionId: cid, teamId: home, cursor: first.nextCursor })
  assert.equal(first.matches.length, 20); assert.equal(second.matches.length, 5); assert.equal(second.nextCursor, null)
  const all = [...parseMatchPage(first).matches, ...parseMatchPage(second).matches]
  assert.equal(new Set(all.map(match => match.id)).size, 25)
  assert.equal(all.some(match => 'version' in match || 'creationFingerprint' in match), false)
  f.records.set(mid, { ...[...f.records.values()][0], _id: mid, status: 'cancelled' })
  assert.equal((await f.service({ action: 'matches.getPublic', id: mid })).error.code, 'NOT_FOUND')
})

test('public date, team and status filters combine across UTC midnight without changing the source list', async () => {
  const f = fixture()
  for (const [index, scheduledAt, status] of [[1, '2026-11-19T17:00:00.000Z', 'scheduled'], [2, '2026-11-20T08:00:00.000Z', 'postponed'], [3, '2026-11-20T17:00:00.000Z', 'scheduled']] as const) {
    await f.service({ action: 'matches.create', requestId: String(index).repeat(32), form: { ...f.form, scheduledAt, status }, token: 'admin-token' })
  }
  const all = parseMatchPage(await f.service({ action: 'matches.listPublic', competitionId: cid })).matches
  const before = structuredClone(all)
  assert.equal(matchDate('2026-11-19T17:00:00.000Z'), '2026-11-20')
  assert.equal(matchTime('2026-11-19T17:00:00.000Z'), '2026-11-20 01:00')
  assert.equal(filterMatchSchedule(all, { date: '2026-11-20', teamId: away, status: 'postponed' }).length, 1)
  assert.equal(filterMatchSchedule(all, { date: '2026-11-21', teamId: away, status: 'postponed' }).length, 0)
  assert.equal(filterMatchSchedule(all, { teamId: home }).length, 3)
  assert.deepEqual(all, before)
})

test('malformed schedule payloads fail closed before persistence', async () => {
  const f = fixture()
  for (const changes of [{ stage: 'bad' }, { round: 0 }, { homeTeamId: away, awayTeamId: away }, { scheduledAt: '2026-11-20' }, { venue: '' }, { status: 'finished' }]) {
    assert.equal((await f.service({ action: 'matches.create', requestId: Math.random().toString(16).slice(2).padEnd(32, '0').slice(0, 32), form: { ...f.form, ...changes }, token: 'admin-token' })).ok, false)
  }
  assert.equal(f.records.size, 0)
})
