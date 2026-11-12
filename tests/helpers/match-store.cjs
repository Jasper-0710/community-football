'use strict'

const { registrationId } = require('../../cloudfunctions/adminAuth/registration-model')
const copy = value => value == null ? value : structuredClone(value)

function createMatchMemoryStore({ competitions = new Map(), teams = new Map(), registrations = new Map(), records = new Map(), revisions = new Map() } = {}) {
  let queue = Promise.resolve()
  const store = {
    async allMatches(competitionId) { return [...records.values()].filter(record => record.competitionId === competitionId).map(copy) },
    async snapshot(competitionId) { const competition = copy(competitions.get(competitionId)); return competition ? { competition, matches: await store.allMatches(competitionId), teams: new Map([...teams].map(([id, team]) => [id, copy(team)])) } : null },
    async competition(id) { return copy(competitions.get(id)) },
    async team(id) { return copy(teams.get(id)) },
    async registration(competitionId, teamId) { return copy(registrations.get(registrationId(competitionId, teamId))) },
    async read(id) { return copy(records.get(id)) },
    async dependents(id, competitionId) { return [...records.values()].filter(record => record.competitionId === competitionId && (record.homeFrom === id || record.awayFrom === id)).map(copy) },
    async list({ publicOnly, competitionId, cursor, teamId, limit }) {
      return [...records.values()].filter(record => record.competitionId === competitionId
        && (!publicOnly || ['scheduled', 'postponed', 'finished'].includes(record.status)) && (!cursor || record._id > cursor)
        && (!teamId || record.homeTeamId === teamId || record.awayTeamId === teamId))
        .sort((a, b) => a._id.localeCompare(b._id)).slice(0, limit).map(copy)
    },
    transaction(id, callback) {
      const operation = queue.then(async () => {
        let pending
        const result = await callback(copy(records.get(id)), async (record, related) => { pending = copy({ record, related }) }, store)
        if (pending) {
          records.set(id, pending.record)
          for (const team of pending.related.teams) teams.set(team._id, { ...team, version: team.version + 1 })
          const competition = pending.related.competition
          competitions.set(competition._id, { ...competition, scheduleMutationVersion: (competition.scheduleMutationVersion || 0) + 1 })
        }
        return result
      })
      queue = operation.catch(() => {})
      return operation
    },
  }
  const standingsStore = {
    snapshot: store.snapshot, match: store.read,
    async history(matchId, beforeVersion, limit) { return [...revisions.values()].filter(row => row.matchId === matchId && (!beforeVersion || row.version < beforeVersion)).sort((a, b) => b.version - a.version).slice(0, limit).map(copy) },
    transaction(competitionId, callback) {
      const operation = queue.then(async () => {
        const pending = { competitions: new Map(competitions), teams: new Map(teams), records: new Map(records), revisions: new Map(revisions) }
        const result = await callback({
          competition: async () => copy(pending.competitions.get(competitionId)), matches: () => store.allMatches(competitionId),
          team: async id => copy(pending.teams.get(id)), registration: store.registration, revision: async id => copy(pending.revisions.get(id)),
          writeCompetition: async record => { pending.competitions.set(record._id, copy(record)) }, writeTeam: async record => { pending.teams.set(record._id, copy(record)) },
          writeMatch: async record => { pending.records.set(record._id, copy(record)) }, writeRevision: async record => { pending.revisions.set(record._id, copy(record)) },
        })
        for (const [target, source] of [[competitions, pending.competitions], [teams, pending.teams], [records, pending.records], [revisions, pending.revisions]]) { target.clear(); for (const [id, record] of source) target.set(id, record) }
        return result
      })
      queue = operation.catch(() => {})
      return operation
    },
  }
  return { store, standingsStore, records, competitions, teams, registrations, revisions }
}

module.exports = { createMatchMemoryStore }
