'use strict'

const cloud = require('wx-server-sdk')
const { createAdminTeamService } = require('./teams')
const { createAdminTeamStore } = require('./team-store')
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
const { createContentService, PUBLIC_ACTIONS: CONTENT_PUBLIC_ACTIONS } = require('./content')
const { createContentStore } = require('./content-store')
const { createNewsImageService } = require('./news-images')
const { createLiveService, PUBLIC_ACTIONS: LIVE_PUBLIC_ACTIONS } = require('./match-live')
const { createLiveImageService } = require('./match-live-images')
const {createTeamBadgeCleanup}=require('./team-badge-cleanup')
const {createSettingsService,PUBLIC_ACTIONS:SETTINGS_PUBLIC_ACTIONS}=require('./platform-settings')
const {createPlatformImageService}=require('./external-entries')
const {createEvaluationService}=require('./evaluations')
const {createRecoveryControl,createRecoveryGuard}=require('./recovery-guard')
const {createRecoveryStore}=require('./recovery-store')
const {createRecoveryService}=require('./recovery')
const {createPublicCache}=require('./public-cache')
const tcb = require('@cloudbase/node-sdk')
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
    const where = { competitionId, ...(publicOnly ? { status: database.command.in(['scheduled', 'postponed', 'live', 'finished']) } : {}), ...(cursor ? { _id: database.command.gt(cursor) } : {}) }
    // CloudBase does not accept a Mongo-style $or together with the ordinary
    // where object on every runtime; use two indexed reads for team filtering.
    if (teamId) {
      const [home, away] = await Promise.all([
        database.collection('matches').where({ ...where, homeTeamId: teamId }).orderBy('_id', 'asc').limit(limit).get(),
        database.collection('matches').where({ ...where, awayTeamId: teamId }).orderBy('_id', 'asc').limit(limit).get(),
      ])
      const rows = [...home.data, ...away.data].filter(row => !publicOnly || ['scheduled', 'postponed', 'live', 'finished'].includes(row.status)).sort((a, b) => a._id.localeCompare(b._id))
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
const imageStorage = createStorageAdapter(cloud, process.env.TCB_ENV || cloud.getWXContext().ENV || process.env.SCF_NAMESPACE, tcb.init({env:tcb.SYMBOL_CURRENT_ENV}))
const teams = createAdminTeamService({
  storage: imageStorage,
  authorize: token => service({ action: 'session', token }),
  store: createAdminTeamStore(database),
})
const registrationStorage = createStorageAdapter(cloud, process.env.TCB_ENV || cloud.getWXContext().ENV || process.env.SCF_NAMESPACE)
const registrationStore = {
  async listBoundFiles({registrationId,cursor,limit}) { return (await database.collection('registrationFiles').where({registrationId,...(cursor?{_id:database.command.gt(cursor)}:{})}).field({_id:true,registrationId:true,ownerUserId:true,competitionId:true,status:true,name:true,size:true,extension:true,fileID:true,removedFileIDs:true,createdAt:true,firstSubmittedAt:true}).orderBy('_id','asc').limit(limit).get()).data },

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
const contentStore = createContentStore(database)
const settings = createSettingsService({store:contentStore,storage:imageStorage,authorize:token=>service({action:'session',token})})
const platformImages = createPlatformImageService({store:contentStore,storage:imageStorage,authorize:token=>service({action:'session',token}),enabled:process.env.PLATFORM_IMAGE_UPLOADS_ENABLED==='true'})
const evaluations = createEvaluationService({store:contentStore,authorize:token=>service({action:'session',token}),context:()=>cloud.getWXContext(),expectedAppId:process.env.WECHAT_APP_ID||'wx3230f06c755cef3a'})
const anonymousEvaluations = createEvaluationService({store:contentStore,authorize:token=>service({action:'session',token}),context:()=>null})
const live = createLiveService({store:contentStore,storage:imageStorage,authorize:token=>service({action:'session',token})})
const liveImages = createLiveImageService({store:contentStore,storage:imageStorage,authorize:token=>service({action:'session',token}),enabled:process.env.LIVE_IMAGE_UPLOADS_ENABLED==='true'})
const newsImages = createNewsImageService({store:contentStore,storage:imageStorage,authorize:token=>service({action:'session',token}),enabled:process.env.NEWS_IMAGE_UPLOADS_ENABLED==='true'})
const badgeCleanup=createTeamBadgeCleanup({store:{...contentStore,async listBadges(cursor,limit){return (await database.collection('teamBadges').where(cursor?{_id:database.command.gt(cursor)}:{}).orderBy('_id','asc').limit(limit).get()).data}},storage:imageStorage,authorize:token=>service({action:'session',token})})
const content = createContentService({ store: contentStore, storage:imageStorage, authorize: token => service({ action: 'session', token }) })
const businessRouter = event => typeof event?.action==='string' && event.action.startsWith('settings.images.') ? platformImages(event) : typeof event?.action==='string' && event.action.startsWith('live.images.') ? liveImages(event) : typeof event?.action==='string' && event.action.startsWith('live.') ? live(event) : typeof event?.action==='string' && event.action.startsWith('settings.') ? settings(event) : typeof event?.action==='string' && event.action.startsWith('evaluation.') ? evaluations(event) : event?.action==='teams.badges.cleanup' ? badgeCleanup(event) : typeof event?.action === 'string' && event.action.startsWith('news.images.') ? newsImages(event) : typeof event?.action === 'string' && /^(news|search|directory|content)\./.test(event.action) ? content(event) : event?.action === 'registrations.cleanup' ? cleanup(event) : typeof event?.action === 'string' && event.action.startsWith('registrations.') ? registrations(event) : typeof event?.action === 'string' && event.action.startsWith('teams.') ? teams(event) : typeof event?.action === 'string' && event.action.startsWith('matches.') ? matches(event) : typeof event?.action === 'string' && event.action.startsWith('standings.') ? standings(event) : baseRouter(event)
const recoveryControl = createRecoveryControl(database)
const recoveryGuard = createRecoveryGuard({control:recoveryControl})
const recovery = createRecoveryService({store:createRecoveryStore(database),control:recoveryControl,storage:{...imageStorage,isMissing:error=>error?.errCode===-503003||error?.code==='STORAGE_FILE_NONEXIST'||error?.statusCode===404},authorize:token=>service({action:'session',token}),environment:process.env.TCB_ENV||cloud.getWXContext().ENV||process.env.SCF_NAMESPACE,enabled:process.env.BACKUP_RECOVERY_ENABLED==='true',probe:async()=>{
  const results=await Promise.all(['teamManagement','userProfile'].map(name=>cloud.callFunction({name,data:{action:'recovery.guardStatus'}})))
  return results.every(result=>result.result?.ok===true&&result.result.recoveryGuardVersion===1)
}})
const readActions = new Set([...PUBLIC_ACTIONS,...MATCH_PUBLIC_ACTIONS,...STANDINGS_PUBLIC_ACTIONS,...CONTENT_PUBLIC_ACTIONS,...SETTINGS_PUBLIC_ACTIONS,...LIVE_PUBLIC_ACTIONS,'evaluation.getPublic','evaluation.getAdmin','teams.listAdmin','teams.getAdmin','registrations.listAdmin','registrations.getAdmin','registrations.fileLink','matches.listAdmin','matches.getAdmin','standings.getAdmin','standings.history','standings.previewRestoreResult','competitions.listAdmin','competitions.getAdmin','settings.getAdmin','live.listAdmin','news.listAdmin','news.getAdmin','search.admin','content.overview','news.images.config','news.images.get','live.images.config','live.images.get'])
readActions.add('settings.images.config')
readActions.add('registrations.historyFiles')
readActions.add('settings.images.get')
readActions.add('teams.leadersAdmin')
readActions.add('teams.checkDissolutionAdmin')
const guardedRouter = event => event?.action?.startsWith('backup.') ? recovery(event) : ['login','session','overview','logout'].includes(event?.action) ? businessRouter(event) : recoveryGuard(event,businessRouter,readActions.has(event?.action))
const publicCache=createPublicCache({storage:imageStorage,environment:process.env.TCB_ENV||cloud.getWXContext().ENV||process.env.SCF_NAMESPACE,enabled:process.env.PUBLIC_READ_CACHE_ENABLED==='true'})
const router=event=>publicCache(event,guardedRouter)
const origins = ['http://127.0.0.1:5174', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://localhost:5173', ...(process.env.ADMIN_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)]
const http = createHttpHandler(event => event.action === 'evaluation.getPublic' ? recoveryGuard(event,anonymousEvaluations,true) : router(event), origins, [...PUBLIC_ACTIONS, ...MATCH_PUBLIC_ACTIONS, ...STANDINGS_PUBLIC_ACTIONS, ...CONTENT_PUBLIC_ACTIONS,...SETTINGS_PUBLIC_ACTIONS,...LIVE_PUBLIC_ACTIONS,'evaluation.getPublic'])
exports.main = async event => event && typeof event.httpMethod === 'string' ? http(event) : router(event)
