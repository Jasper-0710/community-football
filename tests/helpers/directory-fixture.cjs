'use strict'
const assert = require('node:assert/strict')
const { createContentMemoryStore } = require('./content-store.cjs')
const { createMatchMemoryStore } = require('./match-store.cjs')
const { createContentService } = require('../../cloudfunctions/adminAuth/content')
const { createMatchService } = require('../../cloudfunctions/adminAuth/matches')
const { createStandingsService } = require('../../cloudfunctions/adminAuth/standings')
const { registrationId } = require('../../cloudfunctions/adminAuth/registration-model')
const cid = n => 'c_' + n.toString(16).padStart(32, '0')
const tid = n => 't_' + n.toString(16).repeat(64)
const pid = n => 'p_' + n.toString(16).padStart(32, '0')
const mid = n => 'm_' + n.toString(16).padStart(32, '0')
async function createDirectoryFixture() {
  const memory = createContentMemoryStore(), { collections, store } = memory
  const clock = { value: Date.parse('2026-11-23T08:00:00.000Z') }
  const authorize = async token => token === 'test-token' ? { ok: true, admin: { username: '验收管理员' } } : { ok: false, error: { code: 'UNAUTHORIZED', message: '请登录' } }
  for (const n of [1, 2, 3]) collections.competitions.set(cid(n), { _id: cid(n), name: `【验收】社区杯${n}`, description: '仅供隔离功能验证的模拟赛事', format: 'round_robin', formatDescription: '模拟赛制', startDate: '2026-11-01', endDate: '2026-12-31', venue: '验收球场', displayEnabled: n !== 3, registrationEnabled: false, registrationRequirements: '提交模拟资料用于验收', registrationStartAt: null, registrationEndAt: null, version: 1, createdAt: clock.value, updatedAt: clock.value })
  for (const n of [1, 2, 3, 4]) collections.teams.set(tid(n), { _id: tid(n), name: `【验收】社区球队${n}`, district: '虹口区', description: '用于功能验证的模拟球队', status: 'active', contactPhone: 'private-phone', leaderUserId: 'private-owner', version: 1, roster: [{ id: pid(n), name: `【验收】球员${n}`, number: 7, position: 'forward', privateNote: 'private-player-note' }, ...(n === 1 ? [{ id: pid(5), name: '【验收】助攻球员', number: 8, position: 'midfielder' }] : [])] })
  function enroll(c, t, status = 'approved') { const id = registrationId(cid(c), tid(t)); collections.registrations.set(id, { _id: id, competitionId: cid(c), teamId: tid(t), status, attachments: ['private-attachment'] }) }
  for (const c of [1, 2, 3]) for (const t of [1, 2]) enroll(c, t)
  enroll(1, 3); enroll(3, 4); enroll(2, 3, 'pending')
  const matchMemory = createMatchMemoryStore({ competitions: collections.competitions, teams: collections.teams, registrations: collections.registrations, records: collections.matches })
  const deps = { authorize, now: () => clock.value, logger: { error() {} } }
  const content = createContentService({ ...deps, store }), matches = createMatchService({ ...deps, store: matchMemory.store }), standings = createStandingsService({ ...deps, store: matchMemory.standingsStore })
  let request = 100
  async function create(n, changes = {}) {
    const response = await matches({ action: 'matches.create', token: 'test-token', requestId: n.toString(16).padStart(32, '0'), form: { competitionId: cid(1), stage: 'group', round: n, groupId: null, slot: null, homeTeamId: tid(1), awayTeamId: tid(2), homeFrom: null, awayFrom: null, scheduledAt: `2026-11-${String(16 + n).padStart(2, '0')}T08:00:00.000Z`, venue: '【验收】社区球场', status: 'scheduled', ...changes } })
    assert.equal(response.ok, true, JSON.stringify(response)); return response
  }
  async function result(n, input, revoke = false) {
    const match = collections.matches.get(mid(n)), c = collections.competitions.get(match.competitionId)
    const response = await standings({ action: revoke ? 'standings.revokeResult' : 'standings.saveResult', token: 'test-token', competitionId: c._id, id: match._id, expectedRevision: c.scheduleMutationVersion || 0, expectedVersion: match.version, requestId: (++request).toString(16).padStart(32, '0'), reason: '隔离模拟数据验收', ...(!revoke ? { result: { state: 'finished', homeScore: 0, awayScore: 0, penalties: null, goals: [], cards: [], substitutions: [], ...input } } : {}) })
    assert.equal(response.ok, true, JSON.stringify(response)); clock.value++; return response
  }
  const goal = (team, scorer, minute = 10, assist = null) => ({ teamId: tid(team), minute, ownGoal: false, scorerId: pid(scorer), assistId: assist ? pid(assist) : null })
  await create(1)
  await result(1, { homeScore: 2, awayScore: 1, goals: [goal(1, 1, 10, 5), { teamId: tid(1), minute: 30, ownGoal: true, scorerId: null, assistId: null }, goal(2, 2, 60)], cards: [{ teamId: tid(1), minute: 40, kind: 'yellow', playerId: pid(1) }, { teamId: tid(1), minute: 80, kind: 'red', playerId: pid(1) }], substitutions: [{ teamId: tid(1), minute: 70, playerInId: pid(5), playerOutId: pid(1) }] })
  await create(2, { competitionId: cid(2), homeTeamId: tid(2), awayTeamId: tid(1) }); await result(2, { homeScore: 0, awayScore: 1, goals: [goal(1, 5, 22, 1)] })
  await create(3, { scheduledAt: '2026-11-24T08:00:00.000Z' })
  await create(4, { scheduledAt: '2026-11-23T08:00:00.000Z' }); await result(4, { state: 'live', minute: 60, homeScore: 3, awayScore: 0, goals: [goal(1, 1, 1), goal(1, 1, 2), goal(1, 1, 3)] })
  await create(5, { stage: 'semi' }); await result(5, { homeScore: 1, awayScore: 1, goals: [goal(1, 1), goal(2, 2)], penalties: [4, 3] })
  await create(6, { competitionId: cid(3) }); await result(6, { homeScore: 9, awayScore: 0, goals: Array.from({ length: 9 }, (_, i) => goal(1, 1, i + 1)) })
  await create(7, { stage: 'final', homeTeamId: null, homeFrom: mid(5), awayTeamId: tid(3), scheduledAt: '2026-11-30T08:00:00.000Z' })
  return { ...memory, content, matches, standings, clock, create, result, goal, enroll, cid, tid, pid, mid }
}
module.exports = { createDirectoryFixture, cid, tid, pid, mid }
