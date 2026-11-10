'use strict'

const cloud = require('wx-server-sdk')
const { createAdminTeamService } = require('./teams')
const { createAdminRegistrationService } = require('./registrations')
const { createRegistrationCleanupService } = require('./registration-cleanup')
const { createStorageAdapter } = require('./registration-storage')
const { createAdminService } = require('./service')
const { createHttpHandler } = require('./http')
const { createCompetitionService, createApplicationRouter, PUBLIC_ACTIONS } = require('./competitions')
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
const router = event => event?.action === 'registrations.cleanup' ? cleanup(event) : typeof event?.action === 'string' && event.action.startsWith('registrations.') ? registrations(event) : typeof event?.action === 'string' && event.action.startsWith('teams.') ? teams(event) : baseRouter(event)
const origins = ['http://127.0.0.1:5174', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://localhost:5173', ...(process.env.ADMIN_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)]
const http = createHttpHandler(router, origins, PUBLIC_ACTIONS)
exports.main = async event => event && typeof event.httpMethod === 'string' ? http(event) : router(event)
