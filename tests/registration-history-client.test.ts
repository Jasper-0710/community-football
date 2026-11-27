import test from 'node:test'
import assert from 'node:assert/strict'
import {effectScope,ref} from 'vue'
import {parseRegistrationFileHistory,type RegistrationDetail,type RegistrationFileHistory} from '../src/domain/registration'
import {useRegistrationFileHistory} from '../src/composables/useRegistrationFileHistory'

const id='r_'+'a'.repeat(64),fileId=(n:number)=>'f_'+n.toString(16).padStart(32,'0')
const file=(n:number)=>({id:fileId(n),name:`历史材料${n}.pdf`,size:100,extension:'pdf',uploadedAt:null,firstSubmittedAt:null})
const page=(files=[file(1)],nextCursor:string|null=null):RegistrationFileHistory=>({registrationId:id,version:1,files,nextCursor})
function fixture(read:(id:string,version:number,cursor?:string)=>Promise<RegistrationFileHistory>){
 const scope=effectScope(),record=ref({id,version:1,attachments:[]} as unknown as RegistrationDetail)
 const history=scope.run(()=>useRegistrationFileHistory(record,read))!
 return {scope,record,history}
}

test('history parser validates ownership/version envelope, dates, limits and ordered unique cursors',()=>{
 assert.deepEqual(parseRegistrationFileHistory(page(),id,1),page())
 for(const extra of [{registrationId:'r_'+'b'.repeat(64)},{version:2},{files:Array.from({length:21},(_,i)=>file(i+1))},{files:[file(2),file(1)]},{files:[file(1),file(1)]},{files:[{...file(1),firstSubmittedAt:'not a date'}]},{files:[{...file(1),uploadedAt:1}]},{nextCursor:{}},{nextCursor:fileId(0)}])assert.throws(()=>parseRegistrationFileHistory({...page(),...extra},id,1),{code:'INVALID_RESPONSE'})
})
test('history starts private and lazy, retries its failed page and advances through an empty bounded page',async()=>{
 const calls:(string|undefined)[]=[];let fail=true
 const s=fixture(async(_id,_version,cursor)=>{
  calls.push(cursor)
  if(!cursor)return page([],fileId(20))
  if(fail){fail=false;throw Error('连接中断，请重试。')}
  return page([file(21)])
 })
 try{
  assert.equal(calls.length,0);assert.equal(s.history.expanded.value,false)
  await s.history.toggle();assert.equal(s.history.loaded.value,true);assert.equal(s.history.cursor.value,fileId(20))
  await s.history.load(true);assert.match(s.history.error.value,/连接中断/);assert.equal(s.history.cursor.value,fileId(20))
  await s.history.load(true);assert.deepEqual(s.history.files.value,[file(21)])
  assert.deepEqual(calls,[undefined,fileId(20),fileId(20)])
  await s.history.toggle();await s.history.toggle();assert.equal(calls.length,3,'reopening the same registration does not refetch unnecessarily')
 }finally{s.scope.stop()}
})
test('changing account/registration, changing version and unmounting discard late private history responses',async()=>{
 for(const change of ['account','version','dispose']){
  let resolve!:(p:RegistrationFileHistory)=>void
  const s=fixture(()=>new Promise(r=>{resolve=r})),request=s.history.toggle()
  if(change==='account')s.record.value=null as unknown as RegistrationDetail
  else if(change==='version')s.record.value={...s.record.value,version:2}
  else s.scope.stop()
  resolve(page());await request
  assert.deepEqual(s.history.files.value,[]);assert.equal(s.history.expanded.value,false);assert.equal(s.history.loading.value,false)
  s.scope.stop()
 }
})
test('history clears mixed-version results and blocks further pages until the registration is reloaded',async()=>{
 let calls=0
 const s=fixture(async()=>{if(++calls===1)return page([file(1)],fileId(20));throw Object.assign(Error('报名已更新，请重新读取。'),{code:'CONFLICT'})})
 try{
  await s.history.toggle();await s.history.load(true)
  assert.equal(s.history.stale.value,true);assert.deepEqual(s.history.files.value,[])
  await s.history.load();assert.equal(calls,2)
  s.record.value={...s.record.value,version:2};assert.equal(s.history.stale.value,false);assert.equal(s.history.error.value,'')
 }finally{s.scope.stop()}
})
test('history refuses duplicate pages and current attachments masquerading as historical files',async()=>{
 for(const currentFile of [false,true]){
  let calls=0
  const s=fixture(async()=>{calls++;return page([file(1)],fileId(20))})
  try{
   if(currentFile)s.record.value={...s.record.value,attachments:[file(1)]}
   await s.history.toggle()
   if(!currentFile)await s.history.load(true)
   assert.match(s.history.error.value,/历史材料返回异常/)
   assert.equal(s.history.files.value.length,currentFile?0:1)
  }finally{s.scope.stop()}
 }
})
