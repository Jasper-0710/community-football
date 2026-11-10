'use strict'
const {createTeamMemory}=require('./team-store.cjs')
// Shares one atomic transaction queue with real team service tests, so booking,
// team dissolution and competition configuration operate on the same records.
exports.createRegistrationMemory=()=>{
 const memory=createTeamMemory()
 const list=async({ownerUserId,competitionId,status,cursor,limit})=>{
  if(memory.failures.read)throw new Error('read unavailable')
  return [...memory.records].filter(([key,r])=>key.startsWith('registrations/')&&(!ownerUserId||r.ownerUserId===ownerUserId)&&(!competitionId||r.competitionId===competitionId)&&(!status||r.status===status)&&(!cursor||r._id>cursor)).map(([,r])=>structuredClone(r)).sort((a,b)=>a._id.localeCompare(b._id)).slice(0,limit)
 }
 const read=async(collection,id)=>{if(memory.failures.read)throw new Error('read unavailable');return memory.read(collection,id)}
 const registrationStore={listFiles:async({cursor,limit})=>{if(memory.failures.read)throw new Error('read unavailable');return [...memory.records].filter(([k,r])=>k.startsWith('registrationFiles/')&&(!cursor||r._id>cursor)).map(([,r])=>structuredClone(r)).sort((a,b)=>a._id.localeCompare(b._id)).slice(0,limit)},transaction:memory.store.transaction,list,read:id=>read('registrations',id),competition:id=>read('competitions',id)}
 const competitionStore={
  read:id=>read('competitions',id),
  list:async({publicOnly,cursor,limit})=>{if(memory.failures.read)throw new Error('read unavailable');return [...memory.records].filter(([key,r])=>key.startsWith('competitions/')&&(!publicOnly||r.displayEnabled)&&(!cursor||r._id>cursor)).map(([,r])=>structuredClone(r)).sort((a,b)=>a._id.localeCompare(b._id)).slice(0,limit)},
  transaction:(id,fn)=>memory.store.transaction(async tx=>fn(await tx.get('competitions',id),record=>tx.set('competitions',id,record))),
 }
 return {...memory,registrationStore,competitionStore}
}
