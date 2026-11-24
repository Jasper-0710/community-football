'use strict'
// Reference writers also increment teams.version in their transaction. That
// document serializes new references against archival and leader changes.
const REFERENCES=[['registrations',['teamId']],['matches',['homeTeamId','awayTeamId']],['matchEvents',['teamId']],['resultRevisions',['teamId','homeTeamId','awayTeamId']]]
const missing=error=>[error?.errCode,error?.code].some(code=>[-502005,'-502005','DATABASE_COLLECTION_NOT_EXIST','TCB_DB_COLLECTION_NOT_EXISTS'].includes(code))
function createReferenceChecker(db){return async id=>{
 for(const [collection,fields] of REFERENCES)for(const field of fields){
  try{const r=await db.collection(collection).where({[field]:id}).field({_id:true}).limit(1).get();if(!Array.isArray(r.data))throw new Error('Invalid references');if(r.data.length)return true}
  catch(error){if(!missing(error))throw error}
 }
 return false
}}
function createAdminTeamStore(db){return {
 async list(cursor,limit){return (await db.collection('teams').where(cursor?{_id:db.command.gt(cursor)}:{}).orderBy('_id','asc').limit(limit).get()).data},
 async read(id){return (await db.collection('teams').doc(id).get()).data},
 async user(id){return (await db.collection('users').doc(id).get()).data},
 async leaders(cursor,limit){return (await db.collection('users').where(cursor?{_id:db.command.gt(cursor)}:{}).orderBy('_id','asc').limit(limit).get()).data},
 async binding(id){return (await db.collection('leaderTeamBindings').doc(id).get()).data},
 transaction:callback=>db.runTransaction(tx=>callback({
  hasReferences:createReferenceChecker(db),
  async get(collection,id){return (await tx.collection(collection).doc(id).get()).data},
  async set(collection,id,value){const {_id,_openid,...data}=value;await tx.collection(collection).doc(id).set({data})},
 })),
}}
module.exports={REFERENCES,createReferenceChecker,createAdminTeamStore}
