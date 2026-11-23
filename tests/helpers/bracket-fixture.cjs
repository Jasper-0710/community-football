'use strict'
const assert = require('node:assert/strict')
const { createContentMemoryStore } = require('./content-store.cjs')
const { createMatchMemoryStore } = require('./match-store.cjs')
const { createMatchService } = require('../../cloudfunctions/adminAuth/matches')
const { createStandingsService } = require('../../cloudfunctions/adminAuth/standings')
const { createCompetitionService } = require('../../cloudfunctions/adminAuth/competitions')
const { createSettingsService } = require('../../cloudfunctions/adminAuth/platform-settings')
const { registrationId } = require('../../cloudfunctions/adminAuth/registration-model')
const cid = n => 'c_' + n.toString(16).padStart(32, '0')
const tid = n => 't_' + n.toString(16).padStart(64, '0')
const pid = n => 'p_' + n.toString(16).padStart(32, '0')
const mid = n => 'm_' + n.toString(16).padStart(32, '0')
async function createBracketFixture() {
  const { collections, store } = createContentMemoryStore()
  const clock = { value: Date.parse('2026-11-23T08:00:00.000Z') }
  const authorize = async token => token === 'bracket-test' ? { ok: true, admin: { username: '隔离验收' } } : { ok: false, error: { code: 'UNAUTHORIZED', message: '请登录' } }
  const dependencies = { authorize, now: () => clock.value++, logger: { error() {} } }
  for (const [n, name] of [[1, '【模拟】八强冠军杯'], [2, '【模拟】四强杯'], [3, '【模拟】尚未排赛杯'], [4, '【模拟】隐藏杯']]) collections.competitions.set(cid(n), {
    _id: cid(n), name, description: '隔离测试赛事', format: 'knockout', formatDescription: '小组晋级淘汰赛', startDate: '2026-11-01', endDate: '2026-12-31', venue: '模拟球场', displayEnabled: n !== 4, registrationEnabled: false, registrationRequirements: '模拟报名', registrationStartAt: null, registrationEndAt: null, version: 1, createdAt: clock.value, updatedAt: clock.value,
  })
  for (let n = 1; n <= 8; n++) {
    collections.teams.set(tid(n), { _id: tid(n), name: `【模拟】社区球队${n}`, district: '虹口区', description: '', status: 'active', contactPhone: 'not-public', leaderUserId: 'not-public', version: 1, roster: [{ id: pid(n), name: `模拟球员${n}`, number: n, position: 'forward' }] })
    for (const c of [1, 2]) { const id = registrationId(cid(c), tid(n)); collections.registrations.set(id, { _id: id, competitionId: cid(c), teamId: tid(n), status: 'approved' }) }
  }
  const memory = createMatchMemoryStore({ competitions: collections.competitions, teams: collections.teams, registrations: collections.registrations, records: collections.matches })
  const matches = createMatchService({ ...dependencies, store: memory.store }), standings = createStandingsService({ ...dependencies, store: memory.standingsStore })
  const competitions = createCompetitionService({ ...dependencies, store: { read: id => store.read('competitions', id), async list({ publicOnly, cursor, limit }) { return [...collections.competitions.values()].filter(c => (!publicOnly || c.displayEnabled) && (!cursor || c._id > cursor)).sort((a, b) => a._id.localeCompare(b._id)).slice(0, limit) } } })
  const settings = createSettingsService({ ...dependencies, store })
  let request = 1000
  async function create(n, changes = {}) {
    const response = await matches({ action: 'matches.create', token: 'bracket-test', requestId: n.toString(16).padStart(32, '0'), form: { competitionId: cid(1), stage: 'quarter', round: 1, groupId: null, slot: n, homeTeamId: tid(1), awayTeamId: tid(2), homeFrom: null, awayFrom: null, scheduledAt: '2026-12-10T08:15:00.000Z', venue: '【模拟】社区足球场', status: 'scheduled', ...changes } })
    assert.equal(response.ok, true, JSON.stringify(response)); return response.match
  }
  async function command(action, n, fields = {}) {
    const match = n === null ? null : collections.matches.get(mid(n)), competitionId = match?.competitionId || cid(1)
    const response = await standings({ action: `standings.${action}`, token: 'bracket-test', competitionId, expectedRevision: collections.competitions.get(competitionId).scheduleMutationVersion || 0, ...(['saveResult', 'revokeResult'].includes(action) ? { requestId: (++request).toString(16).padStart(32, '0') } : {}), ...(match ? { id: mid(n), expectedVersion: match.version } : {}), ...fields })
    assert.equal(response.ok, true, JSON.stringify(response)); return response
  }
  const snapshot = (c = 1) => standings({ action: 'standings.getPublic', competitionId: cid(c) })
  async function result(n, homeScore, awayScore, options = {}) {
    const record = collections.matches.get(mid(n)), all = await snapshot(record.competitionId === cid(2) ? 2 : 1), match = all.matches.find(m => m.id === mid(n))
    const goals = []
    for (const [teamId, score] of [[match.homeTeamId, homeScore], [match.awayTeamId, awayScore]]) for (let i = 0; i < score; i++) goals.push({ teamId, minute: 10 + i, ownGoal: false, scorerId: collections.teams.get(teamId).roster[0].id, assistId: null })
    return command('saveResult', n, { reason: '隔离对阵图验收', result: { state: 'finished', minute: 90, homeScore, awayScore, penalties: null, goals, cards: [], substitutions: [], ...options } })
  }
  for (let i = 0; i < 4; i++) await create(i + 1, { stage: 'group', groupId: `${'ABCD'[i]}组`, slot: null, homeTeamId: tid(i * 2 + 1), awayTeamId: tid(i * 2 + 2), scheduledAt: '2026-12-01T08:00:00.000Z' })
  await command('updateRules', null, { rules: { winPoints: 3, drawPoints: 1, lossPoints: 0, legs: 1, groups: [...'ABCD'].map((g, i) => ({ id: `${g}组`, teamIds: [tid(i * 2 + 1), tid(i * 2 + 2)] })) } })
  for (const [n, home, away] of [[11, 'A', 'B'], [12, 'C', 'D'], [13, 'B', 'A'], [14, 'D', 'C']]) {
    await create(n, { slot: n - 10, homeTeamId: null, awayTeamId: null })
    await command('bindMatch', n, { homeQualification: { groupId: `${home}组`, rank: 1 }, awayQualification: { groupId: `${away}组`, rank: 2 } })
  }
  // Deliberately cross slot order: graph layout must follow these IDs.
  await create(21, { stage: 'semi', slot: 1, homeTeamId: null, awayTeamId: null, homeFrom: mid(13), awayFrom: mid(11), scheduledAt: '2026-12-20T08:15:00.000Z' })
  await create(22, { stage: 'semi', slot: 2, homeTeamId: null, awayTeamId: null, homeFrom: mid(14), awayFrom: mid(12), scheduledAt: '2026-12-20T10:15:00.000Z' })
  await create(23, { stage: 'final', slot: 1, homeTeamId: null, awayTeamId: null, homeFrom: mid(22), awayFrom: mid(21), scheduledAt: '2026-12-27T08:15:00.000Z' })
  await create(31, { competitionId: cid(2), stage: 'semi', slot: 1, scheduledAt: '2026-12-20T08:00:00.000Z' })
  await create(32, { competitionId: cid(2), stage: 'semi', slot: 2, homeTeamId: tid(3), awayTeamId: tid(4), scheduledAt: '2026-12-20T10:00:00.000Z' })
  await create(33, { competitionId: cid(2), stage: 'final', slot: 1, homeTeamId: null, awayTeamId: null, homeFrom: mid(31), awayFrom: mid(32), scheduledAt: '2026-12-27T08:00:00.000Z' })
  const revoke = n => command('revokeResult', n, { reason: '隔离验收撤销' })
  return { collections, store, clock, matches, standings, competitions, settings, create, command, snapshot, result, revoke, cid, tid, pid, mid }
}
module.exports = { createBracketFixture, cid, tid, pid, mid }
