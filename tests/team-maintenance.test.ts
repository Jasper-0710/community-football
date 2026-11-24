import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {parseManagedTeam} from '../src/domain/team'
import {parseLeaderPage,parseTeamMutation,type TeamMutation} from '../src/domain/team-maintenance'
import {createAdminApi} from '../admin/src/api'
const require=createRequire(import.meta.url)
const {createMaintenanceFixture}=require('./helpers/team-maintenance-fixture.cjs')
const {createAdminTeamService}=require('../cloudfunctions/adminAuth/teams')
const M=require('../cloudfunctions/adminAuth/team-profile-model')
const {calculateStandings}=require('../cloudfunctions/adminAuth/standings-engine')
const form={name:'【验收】后台代建球队',district:'徐汇区',description:'后台维护模拟样例',contactPhone:'021-55556666'}
const player={name:'【验收】新球员',number:9,position:'forward'}
const pid='p_'+'f'.repeat(32)
const snapshot=(f:any)=>structuredClone([...f.records])
const update=(f:any,extra={})=>f.call('teams.updateAdmin',{id:f.id,expectedVersion:f.read('teams',f.id).version,requestId:f.request(),form,...extra})
const add=(f:any,extra={})=>f.call('teams.savePlayerAdmin',{id:f.id,expectedVersion:f.read('teams',f.id).version,requestId:f.request(),playerId:pid,form:player,...extra})

test('E all maintenance actions require admin auth, use strict fields and never accept injected role, ownership or badge',async()=>{
 const f=await createMaintenanceFixture(),before=snapshot(f)
 for(const action of ['teams.leadersAdmin','teams.createAdmin','teams.updateAdmin','teams.savePlayerAdmin','teams.removePlayerAdmin','teams.assignLeaderAdmin','teams.checkDissolutionAdmin','teams.dissolveAdmin'])assert.equal((await f.admin({action})).error.code,'UNAUTHORIZED')
 for(const field of [{leaderUserId:f.users[1]._id},{role:'admin'},{badgeFileId:'cloud://forged'},{status:'dissolved'}])assert.equal((await update(f,field)).error.code,'INVALID_ARGUMENT')
 assert.deepEqual(snapshot(f),before)
})
test('E HTTP distinguishes rejected team operations from service failure without changing business records',async()=>{
 const f=await createMaintenanceFixture(),{createHttpHandler}=require('../cloudfunctions/adminAuth/http'),before=snapshot(f),http=createHttpHandler(e=>f.admin({...e,token:'test-token'}))
 const send=async(action:string,fields:any)=>{
  const r=await http({httpMethod:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+'a'.repeat(64)},body:JSON.stringify({action,...fields})})
  return {status:r.statusCode,...JSON.parse(r.body)}
 }
 const team=f.read('teams',f.id),base={id:f.id,expectedVersion:team.version,requestId:f.request()}
 let r=await send('teams.savePlayerAdmin',{...base,playerId:pid,form:{...player,number:team.roster[0].number}})
 assert.equal(r.status,409);assert.equal(r.error.code,'NUMBER_IN_USE')
 r=await send('teams.checkDissolutionAdmin',{id:f.id,expectedVersion:team.version})
 assert.equal(r.status,409);assert.equal(r.error.code,'TEAM_IN_USE')
 r=await send('teams.createAdmin',{requestId:f.request(),leaderId:f.users[0]._id,form})
 assert.equal(r.status,409);assert.equal(r.error.code,'ALREADY_EXISTS')
 assert.deepEqual(snapshot(f),before)
 const created=await f.call('teams.createAdmin',{requestId:f.request(),leaderId:f.users[1]._id,form})
 r=await send('teams.dissolveAdmin',{id:created.team.id,expectedVersion:created.team.version,requestId:f.request(),confirmName:'错误名称'})
 assert.equal(r.status,400);assert.equal(r.error.code,'CONFIRMATION_REQUIRED')
 f.failures.references=true
 r=await send('teams.checkDissolutionAdmin',{id:created.team.id,expectedVersion:created.team.version})
 assert.equal(r.status,503);assert.equal(r.error.code,'SERVICE_UNAVAILABLE')
})
test('E leader picker paginates real users, projects no identity/credentials, and marks bound/incomplete users unavailable',async()=>{
 const f=await createMaintenanceFixture()
 for(let n=0;n<25;n++){const openId='extra-'+n,id=require('../cloudfunctions/teamManagement/service').userId(M.APP_ID,openId);f.seed('users',id,{appId:M.APP_ID,openId,nickname:n?'分页用户'+n:'',role:'user'})}
 let cursor:string|undefined;const options:any[]=[]
 do{const page=parseLeaderPage(await f.call('teams.leadersAdmin',cursor?{cursor}:{}));options.push(...page.leaders);cursor=page.nextCursor||undefined}while(cursor)
 assert.equal(options.length,28);assert.equal(new Set(options.map(u=>u.id)).size,28)
 assert.equal(options.find(u=>u.id===f.users[0]._id).available,false);assert.equal(options.find(u=>u.id===f.users[1]._id).available,true)
 assert.equal(options.filter(u=>!u.nickname)[0].available,false)
 for(const u of options)for(const key of ['openId','appId','role','phone','avatarFileId'])assert.equal(key in u,false)
 assert.throws(()=>parseLeaderPage({ok:true,leaders:[options[0],options[0]],nextCursor:null}))
})
test('E admin creation atomically binds one real leader, is idempotent after subsequent edits, and rejects occupied/missing users',async()=>{
 const f=await createMaintenanceFixture(),event={leaderId:f.users[1]._id,requestId:f.request(),form}
 const responses=await Promise.all([f.call('teams.createAdmin',event),f.call('teams.createAdmin',event)])
 assert.deepEqual(responses.map(r=>r.created),[true,false]);const team=parseManagedTeam(responses[0].team)
 assert.equal(f.read('leaderTeamBindings',f.users[1]._id).teamId,team.id);assert.equal(f.read('users',f.users[1]._id).role,'leader')
 await f.call('teams.updateAdmin',{id:team.id,expectedVersion:team.version,requestId:f.request(),form:{...form,name:'更新后球队'}})
 assert.equal((await f.call('teams.createAdmin',event)).team.name,'更新后球队')
 assert.equal((await f.call('teams.createAdmin',{...event,form:{...form,name:'复用请求'}})).error.code,'CONFLICT')
 assert.equal((await f.call('teams.createAdmin',{...event,leaderId:f.users[2]._id})).error.code,'CONFLICT')
 assert.equal((await f.call('teams.createAdmin',{...event,requestId:f.request()})).error.code,'ALREADY_EXISTS')
 assert.equal((await f.call('teams.createAdmin',{...event,requestId:f.request(),leaderId:'0'.repeat(64)})).error.code,'INVALID_ARGUMENT')
})
test('E concurrent administrator and leader creation preserves the one-team constraint and every failed partial write rolls back',async()=>{
 const f=await createMaintenanceFixture(),result=await Promise.all([f.call('teams.createAdmin',{leaderId:f.users[1]._id,requestId:f.request(),form}),f.owner(1)({action:'create',requestId:f.request(),form})])
 assert.equal(result.filter(r=>r.ok).length,1)
 for(const failAfter of [1,2]){const s=await createMaintenanceFixture(),before=snapshot(s);s.failures.failAfter=failAfter;assert.equal((await s.call('teams.createAdmin',{leaderId:s.users[1]._id,requestId:s.request(),form})).error.code,'SERVICE_UNAVAILABLE');assert.deepEqual(snapshot(s),before)}
})
test('E field limits match leader rules and invalid forms leave every business record unchanged',async()=>{
 const f=await createMaintenanceFixture(),before=snapshot(f),{DISTRICTS,POSITIONS}=require('../cloudfunctions/teamManagement/service')
 assert.deepEqual(M.DISTRICTS,DISTRICTS);assert.deepEqual(M.POSITIONS,POSITIONS)
 for(const change of [{name:''},{name:'中'.repeat(41)},{name:'隐藏\u200b字'},{district:'外地'},{description:'长'.repeat(501)},{contactPhone:'123'},{contactPhone:'138abc00000'}])assert.equal((await update(f,{form:{...form,...change}})).error.code,'INVALID_ARGUMENT')
 for(const change of [{name:''},{name:'中'.repeat(31)},{number:0},{number:100},{number:1.5},{number:'9'},{position:'other'},{teamId:'forged'}])assert.equal((await add(f,{form:{...player,...change}})).error.code,'INVALID_ARGUMENT')
 assert.deepEqual(snapshot(f),before)
})
test('E admin edits synchronize leader phone/public profiles/search, preserve registration facts, and reject concurrent stale writes',async()=>{
 const f=await createMaintenanceFixture(),registrations=await f.contentStore.scan('registrations'),before=f.read('teams',f.id),request={id:f.id,expectedVersion:before.version,requestId:f.request(),form}
 const results=await Promise.all([f.call('teams.updateAdmin',request),f.owner()({action:'update',expectedVersion:before.version,form:{...form,name:'领队同时修改'}})])
 assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>r.error?.code==='CONFLICT').length,1)
 request.expectedVersion=f.read('teams',f.id).version;request.requestId=f.request();assert.equal((await f.call('teams.updateAdmin',request)).ok,true)
 assert.equal(f.read('users',f.users[0]._id).phone,form.contactPhone)
 const publicTeam=await f.content({action:'directory.teamProfilePublic',id:f.id});assert.equal(publicTeam.team.name,form.name);assert.equal('contactPhone' in publicTeam.team,false)
 assert.equal((await f.owner()({action:'mine'})).team.name,form.name)
 assert.ok((await f.content({action:'search.public',query:'后台代建',kind:'team'})).results.some((r:any)=>r.id===f.id))
 const version=f.read('teams',f.id).version
 assert.equal((await f.call('teams.updateAdmin',request)).team.version,version)
 assert.equal((await f.call('teams.updateAdmin',{...request,form:{...form,name:'同请求不同内容'}})).error.code,'CONFLICT')
 assert.deepEqual(await f.contentStore.scan('registrations'),registrations)
})
test('E roster changes are atomic, maintain unique numbers, deny cross-team edits and retain removed archives and result snapshots',async()=>{
 const f=await createMaintenanceFixture(),historical=await f.contentStore.scan('matches'),original=f.read('teams',f.id),target=original.roster[0]
 const save={id:f.id,playerId:target.id,expectedVersion:original.version,requestId:f.request(),form:{name:'【验收】修改后的球员',number:11,position:'midfielder'}}
 const result=await f.call('teams.savePlayerAdmin',save);assert.equal(result.ok,true);assert.equal((await f.call('teams.savePlayerAdmin',save)).team.version,result.team.version)
 assert.equal((await add(f,{form:{...player,number:11}})).error.code,'NUMBER_IN_USE')
 assert.equal((await add(f,{playerId:f.pid(2)})).error.code,'FORBIDDEN')
 const remove={id:f.id,expectedVersion:result.team.version,requestId:f.request(),playerId:target.id,confirmName:save.form.name}
 assert.equal((await f.call('teams.removePlayerAdmin',remove)).team.players.some((p:any)=>p.id===target.id),false)
 assert.equal((await f.call('teams.removePlayerAdmin',remove)).ok,true);assert.equal(f.read('players',target.id).status,'removed')
 assert.equal((await add(f,{playerId:target.id})).error.code,'CONFLICT')
 assert.equal((await add(f,{form:{...player,number:11}})).ok,true)
 assert.deepEqual(await f.contentStore.scan('matches'),historical)
 const teams=new Map((await f.contentStore.scan('teams')).map((t:any)=>[t._id,t]))
 const standings=calculateStandings(f.collections.competitions.get(f.cid(1)),historical.filter((m:any)=>m.competitionId===f.cid(1)),teams)
 assert.ok(standings.goals.some((p:any)=>p.playerId===target.id));assert.equal(historical[0].result.goals[0].scorer.name,target.name)
 assert.equal((await f.content({action:'directory.playerProfilePublic',id:target.id,teamId:f.id})).error.code,'NOT_FOUND')
})
test('E admin edits invalidate previous leader retry receipts and partial roster writes cannot diverge',async()=>{
 const f=await createMaintenanceFixture(),team=f.read('teams',f.id),event={action:'savePlayer',expectedVersion:team.version,id:pid,form:player}
 assert.equal((await f.owner()(event)).ok,true);await add(f,{form:{...player,name:'管理员更名'}})
 assert.equal(f.read('players',pid).lastExpectedVersion,undefined);assert.equal((await f.owner()(event)).error.code,'CONFLICT')
 const before=snapshot(f);f.failures.failAfter=1
 assert.equal((await add(f,{playerId:'p_'+'e'.repeat(32),form:{...player,number:12}})).error.code,'SERVICE_UNAVAILABLE');assert.deepEqual(snapshot(f),before)
})
test('E all reference fields block leader transfer and archival, fail closed on query errors, while basic/roster edits remain allowed',async()=>{
 const f=await createMaintenanceFixture(),version=f.read('teams',f.id).version,before=snapshot(f)
 for(const action of ['teams.checkDissolutionAdmin','teams.dissolveAdmin','teams.assignLeaderAdmin']){
  const fields:any={id:f.id,expectedVersion:version};if(action!=='teams.checkDissolutionAdmin')Object.assign(fields,{requestId:f.request(),confirmName:f.read('teams',f.id).name});if(action==='teams.assignLeaderAdmin')fields.leaderId=f.users[1]._id
  assert.equal((await f.call(action,fields)).error.code,'TEAM_IN_USE')
 }
 assert.deepEqual(snapshot(f),before);assert.equal((await update(f)).ok,true);assert.equal((await add(f)).ok,true)
 const {REFERENCES,createReferenceChecker}=require('../cloudfunctions/adminAuth/team-store'),leaderRefs=require('../cloudfunctions/teamManagement/references').REFERENCES
 assert.deepEqual(REFERENCES,leaderRefs)
 const db=(response:any)=>({collection:()=>({where:()=>({field:()=>({limit:()=>({get:async()=>{if(response instanceof Error)throw response;return response}})})})})})
 assert.equal(await createReferenceChecker(db({data:[]}))('team'),false);assert.equal(await createReferenceChecker(db({data:[{}]}))('team'),true)
 await assert.rejects(()=>createReferenceChecker(db({}))('team'));await assert.rejects(()=>createReferenceChecker(db(new Error('denied')))('team'))
 const s=await createMaintenanceFixture(),created=await s.call('teams.createAdmin',{requestId:s.request(),leaderId:s.users[1]._id,form});s.failures.references=true
 assert.equal((await s.call('teams.checkDissolutionAdmin',{id:created.team.id,expectedVersion:created.team.version})).error.code,'SERVICE_UNAVAILABLE')
})
test('E leader transfer changes both bindings/roles atomically, preserves admin role and raises versions above both owners previous pages',async()=>{
 const f=await createMaintenanceFixture(),created=await f.call('teams.createAdmin',{requestId:f.request(),leaderId:f.users[1]._id,form}),team=created.team
 f.seed('leaderTeamBindings',f.users[2]._id,{teamId:null,lastTeamVersion:50});f.seed('users',f.users[1]._id,{...f.users[1],role:'admin'})
 const event={id:team.id,expectedVersion:team.version,requestId:f.request(),leaderId:f.users[2]._id,confirmName:team.name}
 assert.equal((await f.call('teams.assignLeaderAdmin',{...event,confirmName:'wrong'})).error.code,'CONFIRMATION_REQUIRED')
 const transferred=await f.call('teams.assignLeaderAdmin',event);assert.equal(transferred.team.version,51);assert.equal(transferred.team.leaderNickname,f.users[2].nickname)
 assert.equal((await f.call('teams.assignLeaderAdmin',event)).team.version,51)
 assert.equal(f.read('users',f.users[1]._id).role,'admin');assert.equal(f.read('users',f.users[2]._id).role,'leader')
 assert.equal((await f.owner(1)({action:'mine'})).team,null);assert.equal((await f.owner(2)({action:'mine'})).team.id,team.id)
 assert.equal((await f.owner(2)({action:'update',expectedVersion:50,form})).error.code,'CONFLICT')
 const recreated=await f.owner(1)({action:'create',requestId:f.request(),form});assert.equal(recreated.team.version,52)
})
test('E archival confirms exact name, retains roster/phone/leader snapshot, frees ownership, and rejects later edits',async()=>{
 const f=await createMaintenanceFixture(),created=await f.call('teams.createAdmin',{requestId:f.request(),leaderId:f.users[1]._id,form}),id=created.team.id
 await f.call('teams.savePlayerAdmin',{id,expectedVersion:created.team.version,requestId:f.request(),playerId:pid,form:player})
 const team=(await f.call('teams.getAdmin',{id})).team,before=snapshot(f)
 assert.equal((await f.call('teams.checkDissolutionAdmin',{id,expectedVersion:team.version})).canDissolve,true);assert.deepEqual(snapshot(f),before)
 const event={id,expectedVersion:team.version,requestId:f.request(),confirmName:team.name}
 assert.equal((await f.call('teams.dissolveAdmin',{...event,confirmName:'wrong'})).error.code,'CONFIRMATION_REQUIRED')
 const result=await f.call('teams.dissolveAdmin',event);assert.equal(parseManagedTeam(result.team).status,'dissolved');assert.equal(result.team.players.length,1)
 assert.equal(f.read('players',pid).status,'active');assert.equal(f.read('leaderTeamBindings',f.users[1]._id).teamId,null)
 assert.equal((await f.call('teams.dissolveAdmin',event)).team.version,result.team.version)
 assert.equal((await f.call('teams.updateAdmin',{id,expectedVersion:result.team.version,requestId:f.request(),form})).error.code,'CONFLICT')
 assert.equal((await f.owner(1)({action:'create',requestId:f.request(),form})).ok,true)
 assert.equal((await f.call('teams.getAdmin',{id})).team.leaderNickname,f.users[1].nickname)
})
test('E reference creation races with archival through the same team version, and transfer failures preserve every binding',async()=>{
 const f=await createMaintenanceFixture(),created=await f.call('teams.createAdmin',{requestId:f.request(),leaderId:f.users[1]._id,form}),id=created.team.id
 await f.store.transaction(async(tx:any)=>{const team=await tx.get('teams',id);await tx.set('registrations','race',{teamId:id,status:'cancelled'});await tx.set('teams',id,{...team,version:team.version+1})})
 assert.equal((await f.call('teams.dissolveAdmin',{id,expectedVersion:created.team.version,requestId:f.request(),confirmName:form.name})).error.code,'CONFLICT')
 const s=await createMaintenanceFixture(),r=await s.call('teams.createAdmin',{requestId:s.request(),leaderId:s.users[1]._id,form}),before=snapshot(s);s.failures.failAfter=3
 assert.equal((await s.call('teams.assignLeaderAdmin',{id:r.team.id,expectedVersion:r.team.version,requestId:s.request(),leaderId:s.users[2]._id,confirmName:form.name})).error.code,'SERVICE_UNAVAILABLE');assert.deepEqual(snapshot(s),before)
})
test('E synthetic sample rosters can be maintained without inventing users; ordinary orphaned ownership fails closed',async()=>{
 const f=await createMaintenanceFixture(),team=f.read('teams',f.id);team.leaderUserId='0'.repeat(64);f.seed('teams',f.id,team)
 assert.equal((await update(f)).error.code,'SERVICE_UNAVAILABLE')
 f.seed('teams',f.id,{...team,fixture:{synthetic:true,batchId:'explicit-sample',source:'developer-prepared; no real user submission or review'}})
 assert.equal((await update(f)).ok,true);assert.equal((await add(f)).ok,true)
 assert.equal(f.read('users','0'.repeat(64)),null)
})
test('E client/API checks mutation identity/version, sends bearer auth, and preserves immutable request for exact retries',async()=>{
 const f=await createMaintenanceFixture(),calls:any[]=[],mutation:TeamMutation={action:'teams.updateAdmin',id:f.id,expectedVersion:f.read('teams',f.id).version,requestId:f.request(),form}
 const api=createAdminApi('https://isolated.example/api',async(_url,init)=>{const e=JSON.parse(String(init?.body));calls.push({e,headers:init?.headers});const response=await f.admin({...e,token:'test-token'});return new Response(JSON.stringify(response),{status:response.ok?200:409})})
 const first=await api.mutateTeam('test-token',mutation),second=await api.mutateTeam('test-token',mutation);assert.equal(first.version,second.version)
 assert.equal(calls[0].headers.Authorization,'Bearer test-token');assert.deepEqual(calls[0].e,calls[1].e)
 const ack={ok:true,action:mutation.action,requestId:mutation.requestId,team:first}
 assert.throws(()=>parseTeamMutation({...ack,team:{...first,id:'t_'+'0'.repeat(64)}},mutation))
 assert.throws(()=>parseTeamMutation({...ack,team:{...first,version:mutation.expectedVersion}},mutation))
 assert.throws(()=>parseTeamMutation({...ack,requestId:'0'.repeat(32)},mutation))
 const page=await api.teamLeaders('test-token');assert.ok(page.leaders.length)
})

test('E restoring a backup clears admin retry receipts while retaining the maintenance audit and increasing team version',async()=>{
 const f=await createMaintenanceFixture();await update(f)
 const R=require('../cloudfunctions/adminAuth/recovery-model'),data=R.normalize(Object.fromEntries(await Promise.all(R.COLLECTIONS.map(async(name:string)=>[name,await f.contentStore.scan(name)]))))
 const current=structuredClone(data),team=current.teams.find((t:any)=>t._id===f.id);team.name='另一页面新名称';team.version+=5
 const restored=R.materialize(data,current).teams.find((t:any)=>t._id===f.id)
 assert.equal(restored.version,team.version+1);assert.equal(restored.lastAdminRequest,undefined);assert.deepEqual(restored.adminHistory,data.teams.find((t:any)=>t._id===f.id).adminHistory)
})
