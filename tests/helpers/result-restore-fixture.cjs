'use strict'
const assert = require('node:assert/strict')
const { createMatchMemoryStore } = require('./match-store.cjs')
const { createMatchService } = require('../../cloudfunctions/adminAuth/matches')
const { createStandingsService } = require('../../cloudfunctions/adminAuth/standings')
const { registrationId } = require('../../cloudfunctions/adminAuth/registration-model')
const cid = 'c_' + '1'.repeat(32)
const tid = n => 't_' + n.toString(16).padStart(64, '0')
const pid = n => 'p_' + n.toString(16).padStart(32, '0')
function createResultRestoreFixture(options = {}) {
  const memory = createMatchMemoryStore(), clock = { value: Date.parse('2026-11-23T08:00:00.000Z') }
  const timestamp = new Date(clock.value).toISOString()
  const authorize = async token => token === 'fixture-admin' ? { ok: true, admin: { username: '验收管理员' } } : options.authorize ? options.authorize(token) : { ok: false, error: { code: 'UNAUTHORIZED', message: '请登录。' } }
  memory.competitions.set(cid, { _id: cid, name: '【模拟】赛果历史恢复杯', description: '隔离测试赛事', format: 'group_knockout', formatDescription: '小组赛与淘汰赛', startDate: '2026-11-01', endDate: '2026-12-31', venue: '模拟球场', displayEnabled: true, registrationEnabled: false, registrationRequirements: '完整资料', registrationStartAt: null, registrationEndAt: null, version: 1, createdAt: timestamp, updatedAt: timestamp })
  for (let n = 1; n <= 4; n++) {
    const team = { _id: tid(n), name: `【模拟】球队${n}`, district: '虹口区', description: '', contactPhone: '021-11112222', status: 'active', version: 1, leaderUserId: `u-${n}`, createdAt: timestamp, updatedAt: timestamp,
      roster: [{ id: pid(n * 2), name: `历史前锋${n}`, number: 9, position: 'forward' }, { id: pid(n * 2 + 1), name: `历史中场${n}`, number: 10, position: 'midfielder' }] }
    memory.teams.set(team._id, team)
    const id = registrationId(cid, team._id)
    memory.registrations.set(id, { _id: id, competitionId: cid, teamId: team._id, status: 'approved', version: 1,
      form: { teamName: team.name, district: team.district, project: '社区组', leaderName: '模拟领队', contactPhone: team.contactPhone },
      competitionSnapshot: { name: '【模拟】赛果历史恢复杯', requirements: '完整资料', minPlayers: 5, maxPlayers: 18 }, attachments: [{ id: 'f_' + '1'.repeat(32), name: '模拟报名材料.pdf', size: 100, extension: 'pdf' }], createdAt: timestamp, submittedAt: timestamp, updatedAt: timestamp })
  }
  const deps = { authorize, now: () => clock.value++, logger: { error() {} } }
  const matches = createMatchService({ ...deps, store: memory.store }), standings = createStandingsService({ ...deps, store: memory.standingsStore })
  let sequence = 0
  const rid = () => (++sequence).toString(16).padStart(32, '0')
  const snapshot = () => standings({ action: 'standings.getAdmin', competitionId: cid, token: 'fixture-admin' })
  async function create(home = 1, away = 2, extra = {}) {
    const r = await matches({ action: 'matches.create', token: 'fixture-admin', requestId: rid(), form: { competitionId: cid, stage: 'group', groupId: 'A', round: 1, slot: null, homeTeamId: home ? tid(home) : null, awayTeamId: away ? tid(away) : null, homeFrom: null, awayFrom: null, scheduledAt: '2026-12-01T08:00:00.000Z', venue: '模拟球场', status: 'scheduled', ...extra } })
    assert.equal(r.ok, true, JSON.stringify(r)); return r.match.id
  }
  const command = (action, id, extra = {}) => ({ action: `standings.${action}`, token: 'fixture-admin', competitionId: cid, expectedRevision: memory.competitions.get(cid).scheduleMutationVersion || 0, ...(id ? { id, expectedVersion: memory.records.get(id).version } : {}), ...extra })
  const goal = (team = 1, extra = {}) => ({ teamId: tid(team), minute: 25, ownGoal: false, scorerId: pid(team * 2), assistId: pid(team * 2 + 1), ...extra })
  const result = (hs = 1, as = 0, home = 1, away = 2, extra = {}) => ({ state: 'finished', minute: 90, homeScore: hs, awayScore: as, penalties: null, goals: [...Array.from({ length: hs }, () => goal(home)), ...Array.from({ length: as }, () => goal(away))], cards: [], substitutions: [], stats: null, ...extra })
  const save = (id, value) => standings(command('saveResult', id, { requestId: rid(), reason: '模拟技术台录入', result: value }))
  const revoke = id => standings(command('revokeResult', id, { requestId: rid(), reason: '模拟撤销赛果' }))
  const rules = () => standings(command('updateRules', null, { rules: { winPoints: 3, drawPoints: 1, lossPoints: 0, legs: 1, groups: [{ id: 'A', teamIds: [tid(1), tid(2)] }, { id: 'B', teamIds: [tid(3), tid(4)] }] } }))
  const history = id => standings({ action: 'standings.history', competitionId: cid, id, token: 'fixture-admin' })
  const previewCommand = (id, row) => command('previewRestoreResult', id, { targetRevisionId: row.id || row._id, targetVersion: row.version })
  const preview = (id, row) => standings(previewCommand(id, row))
  const restoreCommand = p => ({ action: 'standings.restoreResult', token: 'fixture-admin', competitionId: p.competitionId, id: p.id, expectedVersion: p.expectedVersion, expectedRevision: p.expectedRevision, targetRevisionId: p.targetRevisionId, targetVersion: p.targetVersion, previewDigest: p.digest, requestId: rid(), reason: '根据原始记录恢复所选历史版本' })
  return { ...memory, clock, authorize, snapshot, create, command, matches, standings, rid, goal, result, save, revoke, rules, history, previewCommand, preview, restoreCommand, cid, tid, pid }
}
module.exports = { createResultRestoreFixture, cid, tid, pid }
