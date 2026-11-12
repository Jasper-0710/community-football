'use strict'

const cloud = require('wx-server-sdk')
const { createAdminTeamService } = require('./teams')
const { createAdminRegistrationService } = require('./registrations')
const { createRegistrationCleanupService } = require('./registration-cleanup')
const { createStorageAdapter } = require('./registration-storage')
const { createAdminService } = require('./service')
const { createHttpHandler } = require('./http')
const { createCompetitionService, createApplicationRouter, PUBLIC_ACTIONS } = require('./competitions')
const { createMatchService, PUBLIC_ACTIONS: MATCH_PUBLIC_ACTIONS } = require('./matches')
const { createStandingsService, PUBLIC_ACTIONS: STANDINGS_PUBLIC_ACTIONS } = require('./standings')
const { createStandingsStore } = require('./standings-store')
const { registrationId } = require('./registration-model')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const database = cloud.database({ throwOnNotFound: false })
const store = {
  async read() { return (await database.collection('adminAccounts').doc('primary').get()).data },
  async transaction(callback) {
    return database.runTransaction(async transaction => {
      const ref = transaction.collection('adminAccounts').doc('primary')
      const { data } = await ref.get()
      return callback(data, async account => {
        const { _id, _openid, ...record } = account
        await ref.set({ data: record })
      })
    })
  },
}
const service = createAdminService({ store })
const competitionStore = {
  async list({ publicOnly, cursor, limit }) {
    const where = { ...(publicOnly ? { displayEnabled: true } : {}), ...(cursor ? { _id: database.command.gt(cursor) } : {}) }
    return (await database.collection('competitions').where(where).orderBy('_id', 'asc').limit(limit).get()).data
  },
  async read(id) { return (await database.collection('competitions').doc(id).get()).data },
  async transaction(id, callback) {
    return database.runTransaction(async tx => {
      const ref = tx.collection('competitions').doc(id)
      const { data } = await ref.get()
      return callback(data, async record => {
        const { _id, _openid, ...fields } = record
        await ref.set({ data: fields })
      })
    })
  },
}
const competitions = createCompetitionService({ store: competitionStore, authorize: token => service({ action: 'session', token }) })
const standingsStore = createStandingsStore(database)
const matchStore = {
  snapshot: standingsStore.snapshot,
  async competition(id) { return (await database.collection('competitions').doc(id).get()).data },
  async team(id) { return (await database.collection('teams').doc(id).get()).data },
  async list({ publicOnly, competitionId, cursor, teamId, limit }) {
    const where = { competitionId, ...(publicOnly ? { status: database.command.in(['scheduled', 'postponed', 'finished']) } : {}), ...(cursor ? { _id: database.command.gt(cursor) } : {}) }
    // CloudBase does not accept a Mongo-style $or together with the ordinary
    // where object on every runtime; use two indexed reads for team filtering.
    if (teamId) {
      const [home, away] = await Promise.all([
        database.collection('matches').where({ ...where, homeTeamId: teamId }).orderBy('_id', 'asc').limit(limit).get(),
        database.collection('matches').where({ ...where, awayTeamId: teamId }).orderBy('_id', 'asc').limit(limit).get(),
      ])
      const rows = [...home.data, ...away.data].filter(row => !publicOnly || ['scheduled', 'postponed', 'finished'].includes(row.status)).sort((a, b) => a._id.localeCompare(b._id))
      return rows.filter((row, index, all) => index === all.findIndex(item => item._id === row._id)).slice(0, limit)
    }
    return (await database.collection('matches').where(where).orderBy('_id', 'asc').limit(limit).get()).data
  },
  async read(id) { return (await database.collection('matches').doc(id).get()).data },
  async transaction(id, callback) {
    return database.runTransaction(async tx => {
      const ref = tx.collection('matches').doc(id)
      const { data } = await ref.get()
      const read = async (collection, key) => (await tx.collection(collection).doc(key).get()).data
      const write = async (collection, key, record) => { const { _id, _openid, ...fields } = record; await tx.collection(collection).doc(key).set({ data: fields }) }
      const relatedStore = {
        competition: key => read('competitions', key), team: key => read('teams', key), read: key => read('matches', key),
        registration: (competitionId, teamId) => read('registrations', registrationId(competitionId, teamId)),
        async allMatches(competitionId) {
          const rows = []; let cursor
          for (;;) {
            const page = (await tx.collection('matches').where({ competitionId, ...(cursor ? { _id: database.command.gt(cursor) } : {}) }).orderBy('_id', 'asc').limit(100).get()).data
            rows.push(...page)
            if (rows.length > 2048) throw new Error('Too many matches')
            if (page.length < 100) return rows
            cursor = page[page.length - 1]._id
          }
        },
        async dependents(matchId, competitionId) {
          // All schedule writes touch the competition document below. A
          // concurrent reference change conflicts and retries this query.
          const [home, away] = await Promise.all(['homeFrom', 'awayFrom'].map(field => database.collection('matches').where({ competitionId, [field]: matchId }).limit(100).get()))
          if (home.data.length === 100 || away.data.length === 100) throw new Error('Too many dependent matches')
          return [...home.data, ...away.data]
        },
      }
      return callback(data, async (record, related) => {
        for (const team of related.teams) await write('teams', team._id, { ...team, version: team.version + 1 })
        const competition = related.competition
        await write('competitions', competition._id, { ...competition, scheduleMutationVersion: (competition.scheduleMutationVersion || 0) + 1 })
        await write('matches', id, record)
      }, relatedStore)
    })
  },
}
const matches = createMatchService({ store: matchStore, authorize: token => service({ action: 'session', token }) })
const standings = createStandingsService({ store: standingsStore, authorize: token => service({ action: 'session', token }) })
const baseRouter = createApplicationRouter(service, competitions)
const teams = createAdminTeamService({
  authorize: token => service({ action: 'session', token }),
  store: {
    async list(cursor, limit) { return (await database.collection('teams').where(cursor ? { _id: database.command.gt(cursor) } : {}).orderBy('_id', 'asc').limit(limit).get()).data },
    async read(id) { return (await database.collection('teams').doc(id).get()).data },
    async user(id) { return (await database.collection('users').doc(id).get()).data },
  },
})
const registrationStorage = createStorageAdapter(cloud, process.env.TCB_ENV || cloud.getWXContext().ENV || process.env.SCF_NAMESPACE)
const registrationStore = {

  async listFiles({cursor,limit}) { return (await database.collection('registrationFiles').where(cursor?{_id:database.command.gt(cursor)}:{}).orderBy('_id','asc').limit(limit).get()).data },
  async list({competitionId,cursor,status,limit}) { return (await database.collection('registrations').where({competitionId,...(status?{status}:{}),...(cursor?{_id:database.command.gt(cursor)}:{})}).orderBy('_id','asc').limit(limit).get()).data },
  async read(id) { return (await database.collection('registrations').doc(id).get()).data },
  competition: competitionStore.read,
  transaction: fn => database.runTransaction(tx => fn({
   async get(collection,id){return (await tx.collection(collection).doc(id).get()).data},
   async set(collection,id,value){const {_id,_openid,...data}=value;await tx.collection(collection).doc(id).set({data})},
  })),
}
const registrations = createAdminRegistrationService({store:registrationStore,storage:registrationStorage,authorize:token=>service({action:'session',token}),uploadsEnabled:process.env.REGISTRATION_UPLOADS_ENABLED==='true'})
const cleanup = createRegistrationCleanupService({store:registrationStore,storage:registrationStorage,authorize:token=>service({action:'session',token})})
const router = event => event?.action === 'registrations.cleanup' ? cleanup(event) : typeof event?.action === 'string' && event.action.startsWith('registrations.') ? registrations(event) : typeof event?.action === 'string' && event.action.startsWith('teams.') ? teams(event) : typeof event?.action === 'string' && event.action.startsWith('matches.') ? matches(event) : typeof event?.action === 'string' && event.action.startsWith('standings.') ? standings(event) : baseRouter(event)
const origins = ['http://127.0.0.1:5174', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://localhost:5173', ...(process.env.ADMIN_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)]
const http = createHttpHandler(router, origins, [...PUBLIC_ACTIONS, ...MATCH_PUBLIC_ACTIONS, ...STANDINGS_PUBLIC_ACTIONS])
exports.main = async event => event && typeof event.httpMethod === 'string' ? http(event) : router(event)
