import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {parseManagedTeam,parseTeamPage,teamDistricts,playerPositions} from '../src/domain/team'
const require=createRequire(import.meta.url)
const {createTeamService,userId,APP_ID,DISTRICTS,POSITIONS}=require('../cloudfunctions/teamManagement/service')
const {createAdminTeamService}=require('../cloudfunctions/adminAuth/teams')
const {createTeamMemory}=require('./helpers/team-store.cjs')
const form={name:'社区测试队',district:'徐汇区',description:'',contactPhone:'13800000000'}
const player={name:'测试球员',number:10,position:'midfielder'}
const requestId='a'.repeat(32),pid='p_'+'b'.repeat(32)
function fixture(){
 const memory=createTeamMemory();const user=(openid:string)=>({appId:APP_ID,openId:openid,nickname:'测试领队',avatarFileId:'',role:'user',createdAt:'2026-11-05T00:00:00.000Z',updatedAt:'2026-11-05T00:00:00.000Z'})
 for(const id of ['owner-a','owner-b'])memory.seed('users',userId(APP_ID,id),user(id))
 const handler=(openid='owner-a',appid=APP_ID)=>createTeamService({store:memory.store,context:()=>({OPENID:openid,APPID:appid}),logger:{error(){}}})
 const service=handler(),create=(extra={})=>service({action:'create',requestId,form,...extra})
 return {...memory,handler,service,create,uid:userId(APP_ID,'owner-a')}
}
test('team creation atomically grants leader role, ownership and one team; exact parallel retries are idempotent',async()=>{
 const s=fixture();const r=await Promise.all([s.create(),s.create()]);assert.deepEqual(r.map(x=>x.created),[true,false]);assert.equal(s.read('users',s.uid).role,'leader');assert.equal(s.read('users',s.uid).phone,form.contactPhone);assert.equal(s.read('leaderTeamBindings',s.uid).teamId,r[0].team.id);assert.equal([...s.records.keys()].filter(x=>x.startsWith('teams/')).length,1);assert.equal(parseManagedTeam(r[0].team).playerCount,0)
 assert.equal((await s.create({requestId:'c'.repeat(32)})).error.code,'ALREADY_EXISTS');assert.equal((await s.create({form:{...form,name:'改名字重试'}})).error.code,'ALREADY_EXISTS')
})
test('parallel different create requests still allow only one team',async()=>{const s=fixture();const r=await Promise.all([s.create(),s.create({requestId:'c'.repeat(32)})]);assert.equal(r.filter(x=>x.ok).length,1);assert.equal(r.filter(x=>x.error?.code==='ALREADY_EXISTS').length,1)})
test('partial storage failures roll back team, binding and user role together',async()=>{const s=fixture();s.failures.failAfter=2;assert.equal((await s.create()).error.code,'SERVICE_UNAVAILABLE');assert.equal(s.read('users',s.uid).role,'user');assert.equal(s.read('leaderTeamBindings',s.uid),null);assert.equal([...s.records.keys()].filter(x=>x.startsWith('teams/')).length,0)})
test('trusted WeChat identity is required and client identity/role/badge injection is rejected',async()=>{
 const s=fixture();for(const handle of [s.handler('',APP_ID),s.handler('owner-a','other-app'),s.handler('unregistered')])assert.equal((await handle({action:'create',requestId,form})).error.code,'AUTH_REQUIRED')
 for(const extra of [{leaderUserId:'other'},{role:'admin'},{teamId:'other'},{badgeFileId:'cloud://forged'}])assert.equal((await s.create(extra)).error.code,'INVALID_ARGUMENT')
 const r=await s.create({userInfo:{openId:'owner-b'},tcbContext:{OPENID:'owner-b'}});assert.equal(r.team.id,'t_'+s.uid)
 const other=await s.handler('owner-b')({action:'mine'});assert.equal(other.team,null)
 assert.equal((await s.handler('owner-b')({action:'update',expectedVersion:1,form})).error.code,'NOT_FOUND')
})
test('nickname is needed for creating a team; empty optional introduction and valid phone formats are accepted',async()=>{
 const s=fixture();s.seed('users',s.uid,{...s.read('users',s.uid),nickname:''});assert.equal((await s.create()).error.code,'PROFILE_REQUIRED')
 for(const contactPhone of ['021-12345678','+86 13800000000','13800000000']){const f=fixture();assert.equal((await f.create({form:{...form,contactPhone}})).ok,true)}
})
test('team and player field boundaries reject invalid fields and never mutate stored data',async()=>{
 for(const change of [{name:''},{name:'中'.repeat(41)},{district:'其他区'},{contactPhone:'123'},{contactPhone:'138abc00000'},{description:'长'.repeat(501)},{name:'隐藏\u200b字'},{badgeUrl:'https://forged'}]){const s=fixture();assert.equal((await s.create({form:{...form,...change}})).error.code,'INVALID_ARGUMENT')}
 const s=fixture();await s.create();for(const change of [{name:''},{name:'中'.repeat(31)},{number:0},{number:100},{number:1.5},{number:'10'},{position:'other'},{teamId:'forged'}])assert.equal((await s.service({action:'savePlayer',id:pid,expectedVersion:1,form:{...player,...change}})).error.code,'INVALID_ARGUMENT')
 assert.equal((await s.service({action:'mine'})).team.version,1)
})
test('team edits preserve owner and roster, synchronize phone, and reject stale versions',async()=>{
 const s=fixture();await s.create();await s.service({action:'savePlayer',id:pid,expectedVersion:1,form:player});const r=await s.service({action:'update',expectedVersion:2,form:{...form,name:'更新球队',contactPhone:'021-12345678'}});assert.equal(r.team.playerCount,1);assert.equal(r.team.version,3);assert.equal(s.read('users',s.uid).phone,'021-12345678');assert.equal((await s.service({action:'update',expectedVersion:2,form})).error.code,'CONFLICT')
})
test('player create/update is retry safe and same-team jersey numbers stay unique under concurrency',async()=>{
 const s=fixture();await s.create();const add={action:'savePlayer',id:pid,expectedVersion:1,form:player};const r=await Promise.all([s.service(add),s.service(add)]);assert.equal(r[0].team.playerCount,1);assert.equal(r[1].team.version,2)
 const ids=['c','d'].map(c=>'p_'+c.repeat(32));const concurrent=await Promise.all(ids.map(id=>s.service({action:'savePlayer',id,expectedVersion:2,form:{...player,number:9}})));assert.equal(concurrent.filter(r=>r.ok).length,1);assert.equal(concurrent.filter(r=>r.error?.code==='CONFLICT').length,1)
 assert.equal((await s.service({action:'savePlayer',id:'p_'+'e'.repeat(32),expectedVersion:3,form:{...player,number:9}})).error.code,'NUMBER_IN_USE')
 const edited=await s.service({action:'savePlayer',id:pid,expectedVersion:3,form:{...player,number:11,name:'更新球员'}});assert.equal(edited.team.players.find((p:any)=>p.id===pid).number,11);assert.equal(s.read('players',pid).number,11)
})
test('players cannot be edited or removed by another leader even with a known player ID',async()=>{
 const s=fixture();await s.create();await s.service({action:'savePlayer',id:pid,expectedVersion:1,form:player});const other=s.handler('owner-b');await other({action:'create',requestId,form})
 for(const action of ['savePlayer','removePlayer'])assert.equal((await other({action,id:pid,expectedVersion:1,...(action==='savePlayer'?{form:player}:{})})).error.code,'FORBIDDEN')
 assert.equal(s.read('players',pid).name,player.name)
})
test('removing a player is retry safe, preserves archive, frees number and cannot resurrect a removed ID',async()=>{
 const s=fixture();await s.create();await s.service({action:'savePlayer',id:pid,expectedVersion:1,form:player});const remove={action:'removePlayer',id:pid,expectedVersion:2};assert.equal((await s.service(remove)).team.playerCount,0);assert.equal((await s.service(remove)).team.version,3);assert.equal(s.read('players',pid).status,'removed');assert.equal((await s.service({action:'savePlayer',id:pid,expectedVersion:3,form:player})).error.code,'CONFLICT');assert.equal((await s.service({action:'savePlayer',id:'p_'+'f'.repeat(32),expectedVersion:3,form:player})).ok,true)
})
test('roster and player archive changes roll back together when final team write fails',async()=>{
 const s=fixture();await s.create();s.failures.failAfter=1;assert.equal((await s.service({action:'savePlayer',id:pid,expectedVersion:1,form:player})).error.code,'SERVICE_UNAVAILABLE');assert.equal(s.read('players',pid),null);assert.equal(s.read('teams','t_'+s.uid).roster.length,0)
})
test('admin team list and detail require authorization and expose only intended fields',async()=>{
 const s=fixture();await s.create();await s.service({action:'savePlayer',id:pid,expectedVersion:1,form:player})
 const service=createAdminTeamService({store:s.adminStore,authorize:async(token:string)=>token==='test-token'?{ok:true}:{ok:false,error:{code:'UNAUTHORIZED'}},logger:{error(){}}})
 for(const action of ['teams.listAdmin','teams.getAdmin'])assert.equal((await service({action,id:'t_'+s.uid})).error.code,'UNAUTHORIZED')
 const page=parseTeamPage(await service({action:'teams.listAdmin',token:'test-token'}));assert.equal(page.teams[0].playerCount,1)
 const detail=await service({action:'teams.getAdmin',id:'t_'+s.uid,token:'test-token'});assert.equal(parseManagedTeam(detail.team).players[0].name,player.name)
 for(const key of ['leaderUserId','openId','appId','creationRequestId','creationFingerprint','roster'])assert.equal(key in detail.team,false)
 s.failures.read=true;assert.equal((await service({action:'teams.listAdmin',token:'test-token'})).error.code,'SERVICE_UNAVAILABLE')
})
test('client rejects malformed roster, duplicate IDs/numbers, or unexpected upload capability',async()=>{
 const s=fixture();await s.create();const r=await s.service({action:'savePlayer',id:pid,expectedVersion:1,form:player});for(const change of [{players:[]},{badgeUploadEnabled:true},{version:0},{id:'forged'},{players:[r.team.players[0],r.team.players[0]],playerCount:2}])assert.throws(()=>parseManagedTeam({...r.team,...change}));assert.deepEqual(teamDistricts,DISTRICTS);assert.deepEqual(playerPositions.map(x=>x.value),POSITIONS)
})

test('dissolution confirms exact name and owner, archives roster, releases binding/role, and is retry safe',async()=>{
 const s=fixture();const created=await s.create();const id=created.team.id
 await s.service({action:'savePlayer',id:pid,expectedVersion:1,form:player})
 const event={action:'dissolve',expectedVersion:2,confirmName:form.name}
 assert.equal((await s.service({...event,confirmName:'wrong'})).error.code,'CONFIRMATION_REQUIRED')
 assert.equal((await s.handler('owner-b')(event)).error.code,'NOT_FOUND')
 assert.equal((await s.service({...event,teamId:id})).error.code,'INVALID_ARGUMENT')
 assert.equal((await s.service({action:'checkDissolution',expectedVersion:2})).canDissolve,true)
 assert.equal(s.read('teams',id).status,'active')
 const results=await Promise.all([s.service(event),s.service(event)])
 assert.ok(results.every(r=>r.ok&&r.dissolved&&r.team===null))
 const archived=s.read('teams',id);assert.equal(archived.status,'dissolved');assert.equal(archived.roster.length,1);assert.equal(s.read('players',pid).teamId,id)
 assert.equal(s.read('users',s.uid).role,'user');assert.equal(s.read('leaderTeamBindings',s.uid).teamId,null);assert.equal((await s.service({action:'mine'})).team,null)
 const admin=createAdminTeamService({store:s.adminStore,authorize:async()=>({ok:true})})
 s.seed('users',s.uid,{...s.read('users',s.uid),nickname:'新昵称'})
 const detail=parseManagedTeam((await admin({action:'teams.getAdmin',id})).team)
 assert.equal(detail.status,'dissolved');assert.ok(detail.dissolvedAt);assert.equal(detail.leaderNickname,'测试领队');assert.equal(detail.players.length,1)
})
test('recreation retains every archive and rejects stale creates, team edits, players and dissolution',async()=>{
 const s=fixture();const first=await s.create();await s.service({action:'dissolve',expectedVersion:1,confirmName:form.name})
 assert.equal((await s.create()).error.code,'CONFLICT')
 const next=await s.create({requestId:'c'.repeat(32)});assert.notEqual(next.team.id,first.team.id);assert.equal(next.team.version,3)
 for(const event of [{action:'update',expectedVersion:1,form},{action:'savePlayer',expectedVersion:1,id:pid,form:player},{action:'dissolve',expectedVersion:1,confirmName:form.name}])assert.equal((await s.service(event)).error.code,'CONFLICT')
 assert.equal((await s.service({action:'mine'})).team.id,next.team.id)
 await s.service({action:'dissolve',expectedVersion:3,confirmName:form.name})
 assert.equal((await s.create({requestId:'c'.repeat(32)})).error.code,'CONFLICT')
 const third=await s.create({requestId:'d'.repeat(32)});assert.equal(third.team.version,5);assert.equal([...s.records.keys()].filter(k=>k.startsWith('teams/')).length,3)
 assert.equal(s.read('teams',first.team.id).status,'dissolved');assert.equal(s.read('teams',next.team.id).status,'dissolved')
})
test('all documented competition references block dissolution, including away teams and cancelled registrations',async()=>{
 const {REFERENCES}=require('../cloudfunctions/teamManagement/references')
 for(const [collection,fields] of REFERENCES)for(const field of fields){
  const s=fixture();const r=await s.create();s.seed(collection,'ref',{[field]:r.team.id,status:'cancelled'})
  for(const action of ['checkDissolution','dissolve'])assert.equal((await s.service({action,expectedVersion:1,...(action==='dissolve'?{confirmName:form.name}:{})})).error.code,'TEAM_IN_USE')
  assert.equal(s.read('teams',r.team.id).status,'active');assert.equal(s.read('leaderTeamBindings',s.uid).teamId,r.team.id)
 }
})
test('reference read failure and partial dissolution write failure leave all records unchanged',async()=>{
 for(const mode of ['references','write']){const s=fixture();const r=await s.create();const before=structuredClone([...s.records]);if(mode==='references')s.failures.references=true;else s.failures.failAfter=2
  assert.equal((await s.service({action:'dissolve',expectedVersion:1,confirmName:form.name})).error.code,'SERVICE_UNAVAILABLE');assert.deepEqual([...s.records],before);assert.equal(s.read('teams',r.team.id).status,'active')
 }
})
test('legacy teams without status can dissolve and admin roles survive dissolution',async()=>{
 const s=fixture();const r=await s.create();delete s.records.get('teams/'+r.team.id).status
 s.seed('users',s.uid,{...s.read('users',s.uid),role:'admin'})
 assert.equal((await s.service({action:'mine'})).team.status,'active')
 assert.equal((await s.service({action:'dissolve',expectedVersion:1,confirmName:form.name})).ok,true);assert.equal(s.read('users',s.uid).role,'admin')
})
test('a transactional reference writer conflicts with dissolution or sees a dissolved team',async()=>{
 for(const referenceFirst of [true,false]){
  const s=fixture();const r=await s.create()
  const addReference=()=>s.store.transaction(async(tx:any)=>{const team=await tx.get('teams',r.team.id);if(team.status==='dissolved')return false;await tx.set('registrations','reg',{teamId:team._id});await tx.set('teams',team._id,{...team,version:team.version+1});return true})
  const dissolve=()=>s.service({action:'dissolve',expectedVersion:1,confirmName:form.name})
  const [a,b]=await Promise.all(referenceFirst?[addReference(),dissolve()]:[dissolve(),addReference()])
  if(referenceFirst){assert.equal(a,true);assert.equal(b.error.code,'CONFLICT');assert.equal(s.read('teams',r.team.id).status,'active')}
  else{assert.equal(a.ok,true);assert.equal(b,false);assert.equal(s.read('registrations','reg'),null)}
 }
})
test('reference adapter treats only missing collections as empty and fails closed on malformed/denied responses',async()=>{
 const {createReferenceChecker}=require('../cloudfunctions/teamManagement/references')
 const db=(get:()=>any)=>({command:{or:(v:any)=>v},collection:()=>({where:()=>({field:()=>({limit:()=>({get})})})})})
 for(const error of [{errCode:-502005},{code:'TCB_DB_COLLECTION_NOT_EXISTS'}])assert.equal(await createReferenceChecker(db(async()=>{throw error}))('team'),false)
 assert.equal(await createReferenceChecker(db(async()=>({data:[{_id:'reference'}]})))('team'),true)
 for(const error of [{errCode:-502003},{code:'TIMEOUT'},new Error('not found')])await assert.rejects(()=>createReferenceChecker(db(async()=>{throw error}))('team'))
 await assert.rejects(()=>createReferenceChecker(db(async()=>({})))('team'))
})
