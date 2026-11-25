import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createRecoveryService}=require('../cloudfunctions/adminAuth/recovery')
const {createRecoveryGuard,withRecoveryLock}=require('../cloudfunctions/adminAuth/recovery-guard')
const M=require('../cloudfunctions/adminAuth/recovery-model')
const {createRecoveryMemory}=require('./helpers/recovery-store.cjs')
const token='a'.repeat(64),cid='c_'+'1'.repeat(32),mid='m_'+'1'.repeat(32),tid='t_'+'1'.repeat(64),pid='p_'+'1'.repeat(32),uid='1'.repeat(64)
function fixture(){
 const f=createRecoveryMemory();let now=Date.parse('2026-11-20T08:00:00Z'),ready=true
 const put=(name:string,row:any)=>f.collections[name].set(row._id,structuredClone(row))
 put('users',{_id:uid,appId:'test-app',openId:'private-user',nickname:'领队',avatarFileId:'',role:'leader',version:1})
 put('teams',{_id:tid,leaderUserId:uid,name:'社区球队',roster:[{id:pid,name:'前锋',number:9,position:'forward'}],version:2})
 put('players',{_id:pid,teamId:tid,name:'前锋',number:9,position:'forward',status:'active'})
 put('leaderTeamBindings',{_id:uid,teamId:tid})
 put('competitions',{_id:cid,name:'社区杯',displayEnabled:true,version:2,scheduleMutationVersion:4})
 put('matches',{_id:mid,competitionId:cid,stage:'final',homeTeamId:tid,awayTeamId:null,status:'scheduled',result:null,version:3})
 const service=createRecoveryService({...f,authorize:async(t:string)=>t===token||t==='b'.repeat(64)?{ok:true,admin:{username:'admin'}}:{ok:false,error:{code:'UNAUTHORIZED',message:'请登录'}},enabled:true,probe:async()=>ready,now:()=>now,logger:{error(){}}})
 const call=(action:string,fields:any={},session=token)=>service({action,...fields,token:session})
 const create=async()=>{const r=await call('backup.create',{requestId:'1'.repeat(32)});assert.equal(r.ok,true,JSON.stringify(r));return r.backup}
 const preview=async(b:any)=>{const r=await call('backup.preview',{id:b.id,digest:b.digest});assert.equal(r.ok,true,JSON.stringify(r));return r.plan}
 return{...f,put,call,create,preview,service,setReady(v:boolean){ready=v},advance(ms:number){now+=ms},now:()=>now}
}
test('D13 export freezes all business collections (including platform images), private final files and canonical chunk digest; excludes auth and recovery metadata',async()=>{
 const f=fixture(),asset=await f.storage.upload('users/avatar.png',Buffer.from('avatar'))
 f.collections.users.get(uid).avatarFileId=asset
 const backup=await f.create(),manifest=await f.store.read(M.backupKey(backup.id)),payload=JSON.parse((await f.storage.download(manifest.fileID)).toString())
 assert.deepEqual(Object.keys(payload.collections).sort(),[...M.COLLECTIONS].sort());assert.equal(payload.collections.adminAccounts,undefined);assert.deepEqual(payload.collections.platformSettings,[])
 assert.equal(payload.assets.length,1);assert.equal((await f.storage.download(payload.assets[0].backupFileID)).toString(),'avatar');assert.equal(backup.assetCount,1)
 let bytes=Buffer.alloc(0);for(let index=0;index<Math.ceil(backup.bytes/32768);index++){const part=await f.call('backup.chunk',{id:backup.id,digest:backup.digest,index});assert.equal(part.index,index);bytes=Buffer.concat([bytes,Buffer.from(part.data,'base64')])}
 assert.equal(M.digest(bytes),backup.digest);assert.equal(JSON.parse(bytes.toString()).id,backup.id)
 assert.equal((await f.call('backup.chunk',{id:backup.id,digest:backup.digest,index:99})).error.code,'INVALID_ARGUMENT')
 assert.equal((await f.call('backup.create',{requestId:'1'.repeat(32)})).backup.id,backup.id);assert.equal((await f.store.history()).length,1)
})
test('D13 permissions, readiness and explicit deployment flag reject before touching business data',async()=>{
 const f=fixture(),before=await f.store.snapshot()
 for(const action of ['backup.status','backup.list','backup.create','backup.preview','backup.apply','backup.chunk','backup.result'])assert.equal((await f.call(action,{},'')).error.code,'UNAUTHORIZED')
 f.setReady(false);assert.equal((await f.call('backup.create',{requestId:'2'.repeat(32)})).error.code,'NOT_CONFIGURED')
 const disabled=createRecoveryService({...f,enabled:false,authorize:async()=>({ok:true})})
 assert.equal((await disabled({action:'backup.create'})).error.code,'NOT_CONFIGURED');assert.deepEqual(await f.store.snapshot(),before)
 f.setReady(true)
 assert.equal((await f.call('backup.preview',{id:'b_'+'1'.repeat(32),digest:'x'})).error.code,'INVALID_ARGUMENT')
})
test('D13 archives files with bounded concurrency, preserves manifest order and drains failed work before unlocking',async()=>{
 const f=fixture(),originals:string[]=[]
 for(let i=0;i<8;i++){
  const id=await f.storage.upload(`users/concurrent-${i}.png`,Buffer.from(`avatar-${i}`));originals.push(id)
  f.put('users',{_id:String(i+3).repeat(64),avatarFileId:id})
 }
 const download=f.storage.download,gate=Promise.withResolvers<void>()
 let active=0,peak=0,started=0
 f.storage.download=async(id:string)=>{if(!originals.includes(id))return download(id);started++;active++;peak=Math.max(peak,active);await gate.promise;active--;return download(id)}
 const pending=f.create()
 while(started<6)await new Promise(resolve=>setImmediate(resolve))
 assert.equal(started,6);assert.equal(peak,6);assert.ok((await f.control.read()).lock)
 gate.resolve();const backup=await pending,record=await f.store.read(M.backupKey(backup.id)),payload=JSON.parse((await download(record.fileID)).toString())
 assert.deepEqual(payload.assets.map((asset:any)=>asset.fileID),M.assetIds(payload.collections));assert.equal(active,0)
 const g=fixture(),files:string[]=[]
 for(let i=0;i<8;i++){const id=await g.storage.upload(`users/failure-${i}.png`,Buffer.from(`avatar-${i}`));files.push(id);g.put('users',{_id:String(i+3).repeat(64),avatarFileId:id})}
 const release=Promise.withResolvers<void>(),read=g.storage.download,failed=Promise.withResolvers<void>();let admitted=0,finished=false
 g.storage.download=async(id:string)=>{if(!files.includes(id))return read(id);admitted++;if(admitted===1){failed.resolve();throw new Error('Storage unavailable')}await release.promise;return read(id)}
 const request=g.call('backup.create',{requestId:'4'.repeat(32)}).then((result:any)=>{finished=true;return result})
 await failed.promise;await new Promise(resolve=>setImmediate(resolve))
 assert.equal(admitted,6);assert.equal(finished,false);assert.ok((await g.control.read()).lock)
 release.resolve();assert.equal((await request).ok,false);assert.equal(finished,true);assert.equal(admitted,6)
 assert.equal((await g.control.read()).lock,null);assert.equal((await g.store.history()).length,0)
})
test('D13 preview reports creates/updates/deletes; atomic restore retains monotonic versions and a usable automatic rollback',async()=>{
 const f=fixture(),backup=await f.create()
 f.collections.teams.get(tid).name='新队名';f.collections.teams.get(tid).version=8
 f.put('newsArticles',{_id:'n_'+'2'.repeat(32),title:'新增公告',body:[],version:1})
 const before=await f.store.snapshot(),plan=await f.preview(backup)
 assert.equal(plan.summary.find((r:any)=>r.collection==='teams').updated,1);assert.equal(plan.summary.find((r:any)=>r.collection==='newsArticles').removed,1)
 assert.equal((await f.call('backup.apply',{planId:plan.id,confirmation:'错误'})).error.code,'INVALID_ARGUMENT')
 const result=await f.call('backup.apply',{planId:plan.id,confirmation:plan.confirmation});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.applied,true)
 assert.equal(f.collections.teams.get(tid).name,'社区球队');assert.equal(f.collections.teams.get(tid).version,9);assert.equal(f.collections.newsArticles.size,0)
 const rollback=await f.store.read(M.backupKey(result.rollbackId)),archive=JSON.parse((await f.storage.download(rollback.fileID)).toString())
 assert.equal(archive.kind,undefined);assert.deepEqual(archive.collections,M.normalize(before))
 const repeat=await f.call('backup.apply',{planId:plan.id,confirmation:plan.confirmation});assert.equal(repeat.applied,false);assert.equal(f.collections.teams.get(tid).version,9)
 assert.equal((await f.call('backup.result',{planId:plan.id})).status,'completed')
 const undoPlan=await f.preview({id:rollback.backupId,digest:rollback.digest});const undo=await f.call('backup.apply',{planId:undoPlan.id,confirmation:undoPlan.confirmation});assert.equal(undo.ok,true,JSON.stringify(undo));assert.equal(f.collections.teams.get(tid).name,'新队名');assert.equal(f.collections.teams.get(tid).version,10);assert.equal(f.collections.newsArticles.size,1)
})
test('D13 a changed dataset, expired preview and different login session cannot reuse a restoration approval',async()=>{
 const f=fixture(),b=await f.create();f.collections.teams.get(tid).name='修改';const p=await f.preview(b)
 assert.equal((await f.call('backup.apply',{planId:p.id,confirmation:p.confirmation},'b'.repeat(64))).error.code,'NOT_FOUND')
 f.collections.users.get(uid).nickname='刚刚提交';const before=await f.store.snapshot()
 assert.equal((await f.call('backup.apply',{planId:p.id,confirmation:p.confirmation})).error.code,'CONFLICT');assert.deepEqual(await f.store.snapshot(),before)
 const latest=await f.preview(b);f.advance(600001);assert.equal((await f.call('backup.apply',{planId:latest.id,confirmation:latest.confirmation})).error.code,'CONFLICT')
})
test('D13 damaged backup bytes, wrong digest, missing relations and restore quota fail without business writes',async()=>{
 const f=fixture(),b=await f.create(),manifest=await f.store.read(M.backupKey(b.id)),before=await f.store.snapshot()
 assert.equal((await f.call('backup.preview',{id:b.id,digest:'f'.repeat(64)})).error.code,'INVALID_BACKUP')
 f.files.set(manifest.fileID,Buffer.from('{}'));assert.equal((await f.call('backup.preview',{id:b.id,digest:b.digest})).error.code,'INVALID_BACKUP');assert.deepEqual(await f.store.snapshot(),before)
 const broken=structuredClone(before);broken.players=[];assert.throws(()=>M.validateData(broken),/关联/)
 const fresh=fixture(),saved=await fresh.create();for(let i=0;i<81;i++)fresh.put('newsArticles',{_id:'n_'+i.toString(16).padStart(32,'0'),body:[],version:1})
 const tooLarge=await fresh.call('backup.preview',{id:saved.id,digest:saved.digest});assert.equal(tooLarge.error.code,'LIMIT_EXCEEDED');assert.equal(fresh.collections.newsArticles.size,81)
})
test('D13 preserves explicitly synthetic unbound sample owners while ordinary and mismatched owner relations still fail',async()=>{
 const f=fixture(),data=await f.store.snapshot(),team=data.teams[0],missing='2'.repeat(64)
 team.leaderUserId=missing
 assert.throws(()=>M.validateData(data),/球队领队关联/)
 team.fixture={synthetic:true,batchId:'sample-batch',source:'developer-prepared; no real user submission or review'}
 assert.doesNotThrow(()=>M.validateData(data))
 data.registrations.push({_id:'r_sample',competitionId:cid,teamId:tid,ownerUserId:missing,attachments:[],fixture:{...team.fixture}})
 assert.doesNotThrow(()=>M.validateData(data))
 data.registrations[0].fixture.batchId='different-batch'
 assert.throws(()=>M.validateData(data),/报名用户关联/)
 data.registrations[0].fixture.batchId='sample-batch'
 data.leaderTeamBindings.push({_id:missing,teamId:tid})
 assert.throws(()=>M.validateData(data),/领队用户关联/)
})
test('D13 missing original final file is restored from private archive, while missing archive or ambiguous network failure stops restore',async()=>{
 const f=fixture(),asset=await f.storage.upload('users/avatar.png',Buffer.from('avatar'));f.collections.users.get(uid).avatarFileId=asset
 const b=await f.create();f.files.delete(asset);const plan=await f.preview(b),result=await f.call('backup.apply',{planId:plan.id,confirmation:plan.confirmation})
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal((await f.storage.download(asset)).toString(),'avatar')
 const m=await f.store.read(M.backupKey(b.id)),payload=JSON.parse((await f.storage.download(m.fileID)).toString());f.files.delete(payload.assets[0].backupFileID)
 assert.equal((await f.call('backup.preview',{id:b.id,digest:b.digest})).error.code,'MISSING_ASSET')
 const g=fixture(),missing='cloud://cloud-test/users/missing.png';g.collections.users.get(uid).avatarFileId=missing;assert.equal((await g.call('backup.create',{requestId:'3'.repeat(32)})).error.code,'MISSING_ASSET');assert.equal((await g.store.history()).length,0)
})
test('D13 partial database failure rolls back every business write and leaves result inspectable before retry',async()=>{
 const f=fixture(),b=await f.create();f.collections.teams.get(tid).name='修改';f.collections.users.get(uid).nickname='新领队';const plan=await f.preview(b),before=await f.store.snapshot()
 // lock write, rollback manifest write, then the second business write fails.
 f.failAfterWrites(4)
 const result=await f.call('backup.apply',{planId:plan.id,confirmation:plan.confirmation});assert.equal(result.ok,false);assert.deepEqual(await f.store.snapshot(),before);assert.equal((await f.call('backup.result',{planId:plan.id})).status,'cancelled')
 assert.equal((await f.control.read()).lock,null)
 f.failures.writeAt=0;assert.equal((await f.call('backup.apply',{planId:plan.id,confirmation:plan.confirmation})).error.code,'CONFLICT');const retry=await f.preview(b);assert.equal((await f.call('backup.apply',{planId:retry.id,confirmation:retry.confirmation})).ok,true)
})
test('D13 invocation guard covers storage operations, waits for in-flight calls and releases on business errors',async()=>{
 const f=fixture(),guard=createRecoveryGuard({control:f.control,now:f.now,logger:{error(){}}});let complete!:(value:any)=>void,entered!:()=>void
 const started=new Promise<void>(resolve=>entered=resolve),pending=guard({action:'files.chunk'},async()=>{entered();return new Promise(resolve=>complete=resolve)})
 await started
 assert.equal((await withRecoveryLock(f.control,'export',async()=>({ok:true}),f.now)).error.code,'CONFLICT');complete({ok:true});await pending
 let release!:(value:any)=>void,locked!:()=>void;const held=new Promise<void>(resolve=>locked=resolve)
 const lock=withRecoveryLock(f.control,'restore',async()=>{locked();return new Promise(resolve=>release=resolve)},f.now);await held
 let calls=0;for(const readOnly of [false,true])assert.equal((await guard({action:'read'},async()=>{calls++;return{ok:true}},readOnly)).error.code,'SERVICE_MAINTENANCE');assert.equal(calls,0)
 assert.equal((await guard({action:'recovery.guardStatus'},async()=>({}))).recoveryGuardVersion,1)
 release({ok:true});await lock
 assert.equal((await guard({action:'write'},async()=>{throw new Error()})).error.code,'SERVICE_UNAVAILABLE');assert.deepEqual((await f.control.read()).leases,[])
})
test('D13 stale lock expires after bounded function invocation; all deployed guard files remain identical',async()=>{
 const f=fixture(),guard=createRecoveryGuard({control:f.control,now:f.now})
 f.put('platformSettings',{_id:'recovery_control',lock:{owner:'abandoned',until:f.now()+1000},leases:[]})
 assert.equal((await guard({},async()=>({ok:true}),true)).ok,false);f.advance(1001);assert.equal((await guard({},async()=>({ok:true}),true)).ok,true)
 const source=fs.readFileSync('cloudfunctions/adminAuth/recovery-guard.js','utf8');for(const name of ['teamManagement','userProfile'])assert.equal(fs.readFileSync(`cloudfunctions/${name}/recovery-guard.js`,'utf8'),source)
})

test('D13 checking a running restore keeps its receipt active until atomic completion',async()=>{
 const f=fixture(),b=await f.create();f.collections.teams.get(tid).name='待恢复修改'
 const plan=await f.preview(b),upload=f.storage.upload
 let release!:()=>void,entered!:()=>void
 const paused=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve)
 f.storage.upload=async(path:string,bytes:Buffer)=>{if(path.endsWith('/snapshot.json')){entered();await gate}return upload(path,bytes)}
 const pending=f.call('backup.apply',{planId:plan.id,confirmation:plan.confirmation})
 await paused
 try {
  assert.deepEqual(await f.call('backup.result',{planId:plan.id}),{ok:true,status:'running',rollbackId:null,completedAt:null})
  assert.equal((await f.call('backup.result',{planId:plan.id},'b'.repeat(64))).error.code,'NOT_FOUND')
  assert.equal((await f.call('backup.apply',{planId:plan.id,confirmation:plan.confirmation})).error.code,'CONFLICT')
 } finally {release()}
 const done=await pending;assert.equal(done.ok,true,JSON.stringify(done));assert.equal(f.collections.teams.get(tid).name,'社区球队')
 assert.equal((await f.call('backup.result',{planId:plan.id})).status,'completed')
 const writes=f.writes;assert.equal((await f.call('backup.apply',{planId:plan.id,confirmation:plan.confirmation})).applied,false);assert.equal(f.writes,writes)
})
test('D13 checking an idle receipt cancels a delayed apply before it can change business data',async()=>{
 const f=fixture(),b=await f.create();f.collections.teams.get(tid).name='必须保留当前数据'
 const plan=await f.preview(b),before=await f.store.snapshot(),read=f.store.read
 let release!:()=>void,entered!:()=>void,held=false
 const paused=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve)
 f.store.read=async(id:string)=>{const row=await read(id);if(!held&&id===M.planKey(plan.id)){held=true;entered();await gate}return row}
 const pending=f.call('backup.apply',{planId:plan.id,confirmation:plan.confirmation})
 await paused
 try {assert.equal((await f.call('backup.result',{planId:plan.id})).status,'cancelled')} finally {release()}
 assert.equal((await pending).error.code,'CONFLICT');assert.deepEqual(await f.store.snapshot(),before)
 assert.equal((await f.call('backup.result',{planId:plan.id})).status,'cancelled')
 assert.equal((await f.call('backup.apply',{planId:plan.id,confirmation:plan.confirmation})).error.code,'CONFLICT')
})
