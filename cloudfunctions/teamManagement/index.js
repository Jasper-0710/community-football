'use strict'
const cloud=require('wx-server-sdk')
const tcb=require('@cloudbase/node-sdk')
const {createStorageAdapter}=require('./registration-storage')
const {createTeamService,APP_ID}=require('./service')
const {createReferenceChecker}=require('./references')
const {createRegistrationService}=require('./registrations')
const {createRegistrationFileService}=require('./registration-files')
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV})
const db=cloud.database({throwOnNotFound:false})
const store={transaction:fn=>db.runTransaction(async transaction=>fn({
  hasReferences:createReferenceChecker(db),
  async get(collection,id){return (await transaction.collection(collection).doc(id).get()).data},
  async set(collection,id,value){const {_id,_openid,...data}=value;await transaction.collection(collection).doc(id).set({data})},
}))}
const context=()=>cloud.getWXContext(),expectedAppId=process.env.WECHAT_APP_ID||APP_ID
const uploadsEnabled=process.env.REGISTRATION_UPLOADS_ENABLED==='true'
const storage=createStorageAdapter(cloud,process.env.TCB_ENV||cloud.getWXContext().ENV||process.env.SCF_NAMESPACE,tcb.init({env:tcb.SYMBOL_CURRENT_ENV}))
const registrationStore={...store,
 async list({ownerUserId,cursor,limit}){return (await db.collection('registrations').where({ownerUserId,...(cursor?{_id:db.command.gt(cursor)}:{})}).orderBy('_id','asc').limit(limit).get()).data},
 async read(id){return (await db.collection('registrations').doc(id).get()).data},
 async competition(id){return (await db.collection('competitions').doc(id).get()).data},
}
const teams=createTeamService({store,context,expectedAppId})
const registrations=createRegistrationService({store:registrationStore,context,storage,uploadsEnabled,expectedAppId})
const files=createRegistrationFileService({store,context,storage,enabled:uploadsEnabled,expectedAppId})
exports.main=event=>typeof event?.action==='string'&&event.action.startsWith('registrations.')?registrations(event):typeof event?.action==='string'&&event.action.startsWith('files.')?files(event):teams(event)
