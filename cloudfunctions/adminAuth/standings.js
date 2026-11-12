'use strict'

const { createHash } = require('node:crypto')
const { StandingsError, fail, fields, integer, cleanText, validateRules, qualification, calculateStandings, assertSchedule, protectResults, validateResult } = require('./standings-engine')
const PUBLIC_ACTIONS = ['standings.getPublic']
const ACTIONS = [...PUBLIC_ACTIONS, 'standings.getAdmin', 'standings.updateRules', 'standings.bindMatch', 'standings.saveResult', 'standings.revokeResult', 'standings.history']
const CID = /^c_[a-f0-9]{32}$/, MID = /^m_[a-f0-9]{32}$/
const revisionOf = competition => competition.scheduleMutationVersion || 0
const resultView = result => result ? {
  state: result.state || 'finished', minute: result.minute ?? null, homeScore: result.homeScore, awayScore: result.awayScore,
  penalties: result.penalties || null, goals: (result.goals || []).map(goal => ({ ...goal })),
  cards: (result.cards || []).map(card => ({ ...card })), substitutions: (result.substitutions || []).map(change => ({ ...change })), stats: result.stats || null,
} : null
function view(snapshot, admin = false) {
  const calculated = calculateStandings(snapshot.competition, snapshot.matches, snapshot.teams)
  return {
    ok: true, competitionId: snapshot.competition._id, revision: revisionOf(snapshot.competition), configured: calculated.rules.groups.length > 0,
    rules: calculated.rules, groups: calculated.groups, goals: calculated.goals, assists: calculated.assists, championTeamId: calculated.championTeamId,
    matches: calculated.matches.map(match => ({
      id: match._id, competitionId: match.competitionId, stage: match.stage, round: match.round, groupId: match.groupId || null, slot: match.slot ?? null,
      homeTeamId: match.homeTeamId, awayTeamId: match.awayTeamId,
      homeTeamName: snapshot.teams.get(match.homeTeamId)?.name || null, awayTeamName: snapshot.teams.get(match.awayTeamId)?.name || null,
      homeFrom: match.homeFrom || null, awayFrom: match.awayFrom || null, homeQualification: match.homeQualification || null, awayQualification: match.awayQualification || null,
      scheduledAt: new Date(match.scheduledAt).toISOString(), venue: match.venue, status: match.status,
      homeScore: match.result?.homeScore ?? null, awayScore: match.result?.awayScore ?? null, penalties: match.result?.penalties || null,
      updatedAt: new Date(match.updatedAt).toISOString(),
      ...(admin ? { version: match.version, createdAt: new Date(match.createdAt).toISOString(), result: resultView(match.result) } : {}),
    })),
  }
}
async function approvedTeam(tx, competitionId, teamId) {
  const team = await tx.team(teamId), registration = await tx.registration(competitionId, teamId)
  if (!team || team.status === 'dissolved' || registration?.status !== 'approved' || registration.competitionId !== competitionId || registration.teamId !== teamId) fail('只能使用本赛事报名已通过的有效球队。')
  return team
}
function createStandingsService({ store, authorize, now = Date.now, logger = console }) {
  return async event => {
    try {
      if (!event || !ACTIONS.includes(event.action)) fail('不支持的榜单操作。')
      let auth
      const admin = !PUBLIC_ACTIONS.includes(event.action)
      if (admin) { auth = await authorize(event.token); if (!auth.ok) return auth }
      const base = ['action', 'token', 'userInfo', 'tcbContext', 'competitionId']
      if (typeof event.competitionId !== 'string' || !CID.test(event.competitionId)) fail('赛事标识无效。')
      if (['standings.getPublic', 'standings.getAdmin'].includes(event.action)) {
        fields(event, base)
        const snapshot = await store.snapshot(event.competitionId)
        if (!snapshot || !admin && !snapshot.competition.displayEnabled) fail('赛事不存在或暂未公开。', 'NOT_FOUND')
        return view(snapshot, admin)
      }
      if (event.action === 'standings.history') {
        fields(event, [...base, 'id', 'beforeVersion'])
        if (typeof event.id !== 'string' || !MID.test(event.id)) fail('比赛标识无效。')
        if (event.beforeVersion != null) integer(event.beforeVersion, 1, Number.MAX_SAFE_INTEGER, '历史版本')
        const match = await store.match(event.id)
        if (!match || match.competitionId !== event.competitionId) fail('比赛不存在。', 'NOT_FOUND')
        const rows = await store.history(event.id, event.beforeVersion || null, 21)
        return { ok: true, revisions: rows.slice(0, 20).map(row => ({ version: row.version, reason: row.reason, revoked: row.revoked, createdAt: new Date(row.createdAt).toISOString(), result: resultView(row.result) })), nextVersion: rows.length > 20 ? rows[19].version : null }
      }
      const operation = event.action
      const resultOperation = ['standings.saveResult', 'standings.revokeResult'].includes(operation)
      fields(event, [...base, 'expectedRevision', ...(operation === 'standings.updateRules' ? ['rules'] : ['id', 'expectedVersion', ...(operation === 'standings.bindMatch' ? ['homeQualification', 'awayQualification'] : ['requestId', 'reason', ...(operation === 'standings.saveResult' ? ['result'] : [])])])])
      integer(event.expectedRevision, 0, Number.MAX_SAFE_INTEGER, '榜单版本')
      if (operation !== 'standings.updateRules') {
        if (typeof event.id !== 'string' || !MID.test(event.id)) fail('比赛标识无效。')
        integer(event.expectedVersion, 1, Number.MAX_SAFE_INTEGER, '比赛版本')
      }
      let operationId, fingerprint, reason
      if (resultOperation) {
        if (typeof event.requestId !== 'string' || !/^[a-f0-9]{32}$/.test(event.requestId)) fail('提交标识无效，请重新打开赛果表单。')
        reason = cleanText(event.reason, 300, '录入或更正原因')
        operationId = 'rv_' + createHash('sha256').update(`${event.id}:${event.requestId}`).digest('hex')
        fingerprint = createHash('sha256').update(JSON.stringify({ operation, competitionId: event.competitionId, id: event.id, expectedVersion: event.expectedVersion, expectedRevision: event.expectedRevision, reason, result: event.result || null })).digest('hex')
      }
      return await store.transaction(event.competitionId, async tx => {
        const competition = await tx.competition()
        if (!competition) fail('赛事不存在。', 'NOT_FOUND')
        if (operationId) {
          const previous = await tx.revision(operationId)
          if (previous) {
            if (previous.fingerprint !== fingerprint) fail('该提交已经使用，请刷新后重新操作。', 'CONFLICT')
            return { ok: true, applied: false, revision: revisionOf(competition) }
          }
        }
        if (revisionOf(competition) !== event.expectedRevision) fail('赛程或榜单已更新，请刷新后核对最新数据。', 'CONFLICT')
        const matches = await tx.matches()
        const teams = new Map()
        const teamIds = new Set([...(competition.standingsRules?.groups || []).flatMap(group => group.teamIds), ...matches.flatMap(match => [match.homeTeamId, match.awayTeamId, match.result?.homeTeamId, match.result?.awayTeamId]).filter(Boolean)])
        await Promise.all([...teamIds].map(async id => { const team = await tx.team(id); if (team) teams.set(id, team) }))
        const before = calculateStandings(competition, matches, teams)
        let nextCompetition = { ...competition }, updated, touched = []
        if (operation === 'standings.updateRules') {
          const rules = validateRules(event.rules)
          for (const group of rules.groups) for (const id of group.teamIds) { const team = await approvedTeam(tx, event.competitionId, id); teams.set(id, team); touched.push(team) }
          nextCompetition.standingsRules = rules
        } else {
          const record = matches.find(match => match._id === event.id)
          if (!record) fail('比赛不存在。', 'NOT_FOUND')
          if (record.version !== event.expectedVersion) fail('比赛已更新，请刷新后核对。', 'CONFLICT')
          updated = { ...record, version: record.version + 1, updatedAt: now() }
          if (operation === 'standings.bindMatch') {
            updated.homeQualification = qualification(event.homeQualification)
            updated.awayQualification = qualification(event.awayQualification)
          } else {
            const resolved = before.matches.find(match => match._id === event.id)
            if (operation === 'standings.saveResult') {
              for (const id of [resolved.homeTeamId, resolved.awayTeamId].filter(Boolean)) { const team = await approvedTeam(tx, event.competitionId, id); teams.set(id, team); touched.push(team) }
              updated.result = validateResult(event.result, resolved, teams, record.result)
              updated.status = updated.result.state
            } else {
              if (!['live', 'finished'].includes(record.status) || !record.result) fail('该场比赛没有可撤销的赛果。')
              for (const id of [record.result.homeTeamId, record.result.awayTeamId]) { const team = await tx.team(id); if (!team || team.status === 'dissolved') fail('历史参赛球队不可用。'); touched.push(team) }
              updated.result = null; updated.status = 'scheduled'
            }
          }
        }
        const nextMatches = updated ? matches.map(match => match._id === updated._id ? updated : match) : matches
        assertSchedule(nextMatches, nextCompetition.standingsRules)
        const after = calculateStandings(nextCompetition, nextMatches, teams)
        protectResults(before.matches, after.matches)
        // All derived values come from the current result revision. Only facts
        // are persisted, so corrections and revocations cannot leave stale totals.
        nextCompetition.scheduleMutationVersion = revisionOf(competition) + 1
        for (const team of new Map(touched.map(team => [team._id, team])).values()) await tx.writeTeam({ ...team, version: team.version + 1 })
        if (updated) await tx.writeMatch(updated)
        if (operationId) await tx.writeRevision({ _id: operationId, competitionId: event.competitionId, matchId: event.id, version: updated.version,
          homeTeamId: updated.result?.homeTeamId || matches.find(match => match._id === event.id).result.homeTeamId,
          awayTeamId: updated.result?.awayTeamId || matches.find(match => match._id === event.id).result.awayTeamId,
          result: updated.result, previousResult: matches.find(match => match._id === event.id).result || null,
          revoked: operation === 'standings.revokeResult', reason, fingerprint, operator: auth.admin?.username || '', createdAt: now() })
        await tx.writeCompetition(nextCompetition)
        return { ok: true, applied: true, revision: nextCompetition.scheduleMutationVersion }
      })
    } catch (error) {
      if (error instanceof StandingsError) return { ok: false, error: { code: error.code, message: error.message } }
      logger?.error?.('[standings] operation failed')
      return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '榜单服务暂不可用，请稍后重试。' } }
    }
  }
}
module.exports = { createStandingsService, PUBLIC_ACTIONS, view, revisionOf }
