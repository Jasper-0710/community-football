'use strict'
const { registrationId } = require('./registration-model')
const { StandingsError } = require('./standings-engine')

// The competition document is the conflict point shared by schedule, result,
// rules and source writes. Never return a truncated dataset as a complete table.
function createStandingsStore(database) {
  const read = async (db, collection, id) => (await db.collection(collection).doc(id).get()).data
  async function allMatches(competitionId, db = database) {
    const rows = []; let cursor
    for (;;) {
      const page = (await db.collection('matches').where({ competitionId, ...(cursor ? { _id: database.command.gt(cursor) } : {}) }).orderBy('_id', 'asc').limit(100).get()).data
      rows.push(...page)
      if (rows.length > 2048) throw new StandingsError('LIMIT_EXCEEDED', '赛事赛程超出计算上限，请联系平台负责人。')
      if (page.length < 100) return rows
      cursor = page[page.length - 1]._id
    }
  }
  return {
    allMatches,
    match: id => read(database, 'matches', id),
    async snapshot(competitionId) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const competition = await read(database, 'competitions', competitionId)
        if (!competition) return null
        const matches = await allMatches(competitionId), teams = new Map()
        const ids = new Set([...(competition.standingsRules?.groups || []).flatMap(group => group.teamIds), ...matches.flatMap(match => [match.homeTeamId, match.awayTeamId, match.result?.homeTeamId, match.result?.awayTeamId]).filter(Boolean)])
        await Promise.all([...ids].map(async id => { const team = await read(database, 'teams', id); if (team) teams.set(id, team) }))
        const latest = await read(database, 'competitions', competitionId)
        if (latest && latest.version === competition.version && (latest.scheduleMutationVersion || 0) === (competition.scheduleMutationVersion || 0)) return { competition: latest, matches, teams }
      }
      throw new StandingsError('CONFLICT', '赛事正在更新，请稍后刷新。')
    },
    async history(matchId, beforeVersion, limit) {
      return (await database.collection('resultRevisions').where({ matchId, ...(beforeVersion ? { version: database.command.lt(beforeVersion) } : {}) }).orderBy('version', 'desc').limit(limit).get()).data
    },
    transaction(competitionId, callback) {
      return database.runTransaction(async tx => {
        const write = async (collection, record) => { const { _id, _openid, ...data } = record; await tx.collection(collection).doc(_id).set({ data }) }
        return callback({
          competition: () => read(tx, 'competitions', competitionId), matches: () => allMatches(competitionId, tx),
          team: id => read(tx, 'teams', id), registration: (cid, tid) => read(tx, 'registrations', registrationId(cid, tid)),
          revision: id => read(tx, 'resultRevisions', id), writeCompetition: record => write('competitions', record),
          writeMatch: record => write('matches', record), writeTeam: record => write('teams', record), writeRevision: record => write('resultRevisions', record),
        })
      })
    },
  }
}
module.exports = { createStandingsStore }
