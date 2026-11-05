import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import {parseRegistration,parseRegistrationPage,parsePreparation,parseFileLink} from '../src/domain/registration'
const require=createRequire(import.meta.url)
const {createRegistrationMemory}=require('./helpers/registration-store.cjs')
const {createRegistrationService,registrationId}=require('../cloudfunctions/teamManagement/registrations')
const {createAdminRegistrationService}=require('../cloudfunctions/adminAuth/registrations')
const {createCompetitionService}=require('../cloudfunctions/adminAuth/competitions')
const {createTeamService,APP_ID,userId}=require('../cloudfunctions/teamManagement/service')
const {createRegistrationFileService,CHUNK}=require('../cloudfunctions/teamManagement/registration-files')
const cid='c_'+'c'.repeat(32),req='a'.repeat(32),fid='f_'+'f'.repeat(32),fid2='f_'+'e'.repeat(32)
const form={teamName:'上海社区测试队',district:'黄浦区',project:'男子组',leaderName:'测试领队',contactPhone:'021-55556666'}
const config={projects:['男子组','女子组'],teamLimit:1,minPlayers:5,maxPlayers:15}
const event={action:'registrations.submit',competitionId:cid,expectedVersion:0,rulesVersion:1,requestId:req,form,attachmentIds:[fid]}
function fixture(){
 const m=createRegistrationMemory(),clock={value:Date.parse('2026-11-05T00:00:00Z')},files=new Map<string,Buffer>(),now=()=>clock.value
 const storage={async upload(path:string,b:Buffer){files.set(path,Buffer.from(b));return path},async download(path:string){if(!files.has(path))throw Error('missing');return Buffer.from(files.get(path)!)},async remove(paths:string[]){paths.forEach(p=>files.delete(p))},async link(path:string){return 'https://example.test/file?authorized=temporary'}}
 for(const owner of ['owner-a','owner-b']){const uid=userId(APP_ID,owner);m.seed('users',uid,{appId:APP_ID,openId:owner,nickname:'测试领队',role:'leader'});m.seed('leaderTeamBindings',uid,{teamId:'t_'+uid});m.seed('teams','t_'+uid,{name:'原球队名',district:'黄浦区',contactPhone:'021-55556666',leaderUserId:uid,status:'active',schemaVersion:1,version:1,roster:[]});m.seed('registrationFiles',owner==='owner-a'?fid:fid2,{ownerUserId:uid,competitionId:cid,status:'ready',name:'报名.pdf',size:100,extension:'pdf',fileID:'private-original',expiresAt:now()+86400000})}
 m.seed('competitions',cid,{name:'社区足球赛',description:'赛事说明',format:'round_robin',formatDescription:'循环赛',venue:'社区球场',startDate:'2026-11-20',endDate:'2026-11-25',registrationRequirements:'提交材料，等待审核',displayEnabled:true,registrationEnabled:true,registrationStartAt:'2026-11-01T00:00:00.000Z',registrationEndAt:'2026-11-10T00:00:00.000Z',registrationConfig:config,registrationRulesVersion:1,version:1,createdAt:now(),updatedAt:now()})
 const handler=(owner='owner-a',enabled=true,appid=APP_ID)=>createRegistrationService({store:m.registrationStore,context:()=>({OPENID:owner,APPID:appid}),uploadsEnabled:enabled,storage,now,logger:{error(){}}})
 const service=handler(),admin=createAdminRegistrationService({store:m.registrationStore,authorize:async(token:string)=>token==='test-token'?{ok:true,admin:{username:'admin'}}:{ok:false,error:{code:'UNAUTHORIZED'}},uploadsEnabled:true,storage,now,logger:{error(){}}})
 const upload=(owner='owner-a',enabled=true)=>createRegistrationFileService({store:m.store,storage,enabled,context:()=>({OPENID:owner,APPID:APP_ID}),now,logger:{error(){}}})
 const review=(r:any,decision='approved',fields={})=>admin({action:'registrations.review',id:r.id,expectedVersion:r.version,requestId:'b'.repeat(32),decision,reason:decision==='rejected'?'材料不完整':'',playerCount:decision==='approved'?8:null,token:'test-token',...fields})
 return {...m,clock,files,storage,handler,service,admin,upload,review,uid:userId(APP_ID,'owner-a'),submit:(extra={})=>service({...event,...extra})}
}
test('submission stores five fields and immutable files, requires review, snapshots requirements and safely retries',async()=>{
 const s=fixture(),r=await s.submit();assert.equal(r.ok,true);const parsed=parseRegistration(r.registration);assert.equal(parsed.status,'pending');assert.equal(parsed.form.leaderName,'测试领队');assert.equal(parsed.minPlayers,5);assert.equal('fileID' in parsed.attachments[0],false)
 assert.deepEqual(await s.submit(),r);assert.equal(s.read('competitions',cid).registrationStats.occupied,1);assert.equal(s.read('teams','t_'+s.uid).version,2)
 assert.equal(parseRegistrationPage(await s.service({action:'registrations.listMine'})).registrations.length,1);assert.equal(parsePreparation(await s.service({action:'registrations.prepare',competitionId:cid})).registration?.id,r.registration.id)
 assert.equal((await s.review(parsed)).registration.status,'approved');assert.equal((await s.submit()).registration.status,'approved')
})
test('last-place races never overbook, rejection releases slot and approved edits reenter review',async()=>{
 const s=fixture();const results=await Promise.all([s.submit(),s.handler('owner-b')({...event,attachmentIds:[fid2]})]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results[1].error.code,'CAPACITY_FULL')
 const pending=results[0].registration,approved=(await s.review(pending)).registration
 const edited=await s.submit({expectedVersion:approved.version,requestId:'c'.repeat(32),form:{...form,leaderName:'新领队'}});assert.equal(edited.registration.status,'pending');assert.equal(s.read('competitions',cid).registrationStats.occupied,1)
 await s.review(edited.registration,'rejected',{requestId:'d'.repeat(32)});assert.equal(s.read('competitions',cid).registrationStats.occupied,0)
 assert.equal((await s.handler('owner-b')({...event,attachmentIds:[fid2]})).ok,true)
 assert.equal((await s.submit({expectedVersion:4,requestId:'e'.repeat(32)})).error.code,'CAPACITY_FULL')
})
test('deadline uses server time, locks edits/cancellation at exact end; approval can continue after end',async()=>{
 const s=fixture();const r=(await s.submit()).registration;s.clock.value=Date.parse('2026-11-10T00:00:00.000Z')
 assert.equal((await s.submit({expectedVersion:1,requestId:'b'.repeat(32)})).error.code,'REGISTRATION_LOCKED')
 assert.equal((await s.service({action:'registrations.cancel',id:r.id,expectedVersion:1,requestId:'c'.repeat(32)})).error.code,'REGISTRATION_LOCKED')
 assert.equal((await s.service({action:'registrations.getMine',id:r.id})).locked,true)
 assert.equal((await s.review(r)).ok,true);assert.equal((await s.submit()).ok,true)
})
test('before deadline cancellation is allowed with event hidden or signup switch disabled and releases only once',async()=>{
 const s=fixture();const r=(await s.submit()).registration;s.seed('competitions',cid,{...s.read('competitions',cid),displayEnabled:false,registrationEnabled:false})
 const cancel={action:'registrations.cancel',id:r.id,expectedVersion:r.version,requestId:'b'.repeat(32)}
 const replies=await Promise.all([s.service(cancel),s.service(cancel)]);assert.ok(replies.every(r=>r.ok));assert.equal(s.read('competitions',cid).registrationStats.occupied,0)
 assert.equal((await s.service({action:'registrations.getMine',id:r.id})).registration.status,'cancelled')
 assert.equal((await s.submit({expectedVersion:2,requestId:'c'.repeat(32)})).error.code,'NOT_FOUND')
 const dissolve=createTeamService({store:s.store,context:()=>({OPENID:'owner-a',APPID:APP_ID}),logger:{error(){}}})
 assert.equal((await dissolve({action:'checkDissolution',expectedVersion:2})).error.code,'TEAM_IN_USE')
})
test('authorization and ownership reject injection, cross-owner records/files, and malformed requests without leaks',async()=>{
 const s=fixture();for(const handle of [s.handler('',true),s.handler('unknown'),s.handler('owner-a',true,'forged')])assert.equal((await handle(event)).error.code,'AUTH_REQUIRED')
 for(const extras of [{ownerUserId:'forged'},{status:'approved'},{teamId:'forged'}])assert.equal((await s.submit(extras)).error.code,'INVALID_ARGUMENT')
 assert.equal((await s.submit({attachmentIds:[fid2]})).error.code,'INVALID_ATTACHMENT')
 assert.equal((await s.submit({attachmentIds:[fid,fid]})).error.code,'INVALID_ARGUMENT')
 assert.equal((await s.submit({form:{...form,playerCount:8}})).error.code,'INVALID_ARGUMENT')
 assert.equal((await s.submit({form:{...form,leaderName:''}})).error.code,'INVALID_ARGUMENT')
 const r=(await s.submit()).registration;for(const action of ['registrations.getMine','registrations.fileLink'])assert.equal((await s.handler('owner-b')({action,id:r.id,...(action.endsWith('fileLink')?{fileId:fid}:{})})).error.code,'NOT_FOUND')
 for(const action of ['registrations.listAdmin','registrations.getAdmin','registrations.review','registrations.fileLink'])assert.equal((await s.admin({action,id:r.id})).error.code,'UNAUTHORIZED')
 const link=await s.service({action:'registrations.fileLink',id:r.id,fileId:fid});assert.ok(parseFileLink(link).url.startsWith('https:'))
 assert.equal((await s.handler('owner-a',false)({action:'registrations.fileLink',id:r.id,fileId:fid})).error.code,'UPLOAD_UNAVAILABLE')
})
test('review requires reason or in-range verified count; stale approval races cannot review modified material',async()=>{
 const s=fixture();const r=(await s.submit()).registration
 assert.equal((await s.review(r,'rejected',{reason:' '})).error.code,'INVALID_ARGUMENT')
 for(const playerCount of [4,16,null,8.5])assert.equal((await s.review(r,'approved',{playerCount})).error.code,'INVALID_ARGUMENT')
 const [edit,review]=await Promise.all([s.submit({expectedVersion:1,requestId:'c'.repeat(32),form:{...form,leaderName:'更新姓名'}}),s.review(r)])
 assert.equal([edit,review].filter(r=>r.ok).length,1);assert.equal([edit,review].find(r=>!r.ok).error.code,'CONFLICT');assert.equal(s.read('competitions',cid).registrationStats.occupied,1)
 const fresh=fixture(),original=(await fresh.submit()).registration;await fresh.submit({expectedVersion:1,requestId:'d'.repeat(32),form:{...form,leaderName:'更新姓名'}});assert.equal((await fresh.review(original)).error.code,'CONFLICT')
})
test('all submission writes roll back together on storage failure; uncertain retries cannot multiply seats',async()=>{
 const s=fixture();s.failures.failAfter=2;const before=structuredClone([...s.records]);assert.equal((await s.submit()).error.code,'SERVICE_UNAVAILABLE');assert.deepEqual([...s.records],before)
 s.failures.failAfter=Infinity;assert.equal((await s.submit()).ok,true)
})
test('new submissions need a team, configured event, valid project, fresh rules and enabled storage',async()=>{
 for(const [kind,code] of [['team','TEAM_REQUIRED'],['config','NOT_CONFIGURED'],['hidden','NOT_FOUND'],['closed','REGISTRATION_CLOSED'],['storage','UPLOAD_UNAVAILABLE']] as const){const s=fixture();if(kind==='team')s.seed('leaderTeamBindings',s.uid,{teamId:null});if(kind==='config')s.seed('competitions',cid,{...s.read('competitions',cid),registrationConfig:null});if(kind==='hidden')s.seed('competitions',cid,{...s.read('competitions',cid),displayEnabled:false});if(kind==='closed')s.seed('competitions',cid,{...s.read('competitions',cid),registrationEnabled:false});assert.equal((await (kind==='storage'?s.handler('owner-a',false)(event):s.submit())).error.code,code)}
 const s=fixture();assert.equal((await s.submit({rulesVersion:2})).error.code,'CONFLICT');assert.equal((await s.submit({form:{...form,project:'不存在组别'}})).error.code,'INVALID_ARGUMENT')
})
test('admin lists can filter approved final teams without exposing contact fields, stable pagination validates responses',async()=>{
 const s=fixture();const r=(await s.submit()).registration;await s.review(r)
 const page=await s.admin({action:'registrations.listAdmin',competitionId:cid,status:'approved',token:'test-token'});assert.equal(parseRegistrationPage(page).registrations.length,1);assert.equal(page.stats.approved,1);assert.equal('contactPhone' in page.registrations[0],false);assert.equal('ownerUserId' in page.registrations[0],false)
 assert.equal((await s.admin({action:'registrations.listAdmin',competitionId:cid,status:'pending',token:'test-token'})).registrations.length,0)
 for(const change of [{version:0},{attachments:[]},{review:{decision:'approved',reason:'',playerCount:0,reviewedAt:r.updatedAt}}])assert.throws(()=>parseRegistration({...r,...change}))
 assert.throws(()=>parseFileLink({url:'javascript:alert(1)',name:'x',extension:'pdf'}))
})
test('competition quota edits preserve counters and cannot lower below occupied capacity',async()=>{
 const s=fixture();await s.submit();const c=s.read('competitions',cid),{name,description,format,formatDescription,startDate,endDate,venue,registrationRequirements,registrationStartAt,registrationEndAt}=c
 const form={name,description,format,formatDescription,startDate,endDate,venue,registrationRequirements,registrationStartAt,registrationEndAt,registrationConfig:{...config,teamLimit:2}}
 const service=createCompetitionService({store:s.competitionStore,authorize:async()=>({ok:true})})
 assert.equal((await service({action:'competitions.update',id:cid,expectedVersion:1,form})).ok,true);assert.equal(s.read('competitions',cid).registrationStats.occupied,1)
 assert.equal((await s.submit({requestId:'c'.repeat(32),expectedVersion:1})).error.code,'CONFLICT')
 assert.equal((await service({action:'competitions.update',id:cid,expectedVersion:2,form:{...form,registrationConfig:null}})).error.code,'INVALID_ARGUMENT')
})
test('file uploads are gated, owned, bounded and immutable; bytes are checked before becoming a submission attachment',async()=>{
 const s=fixture();const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF')
 const start={action:'files.start',competitionId:cid,requestId:req,name:'报名.pdf',size:pdf.length}
 assert.equal((await s.upload('owner-a',false)(start)).error.code,'UPLOAD_UNAVAILABLE')
 const upload=s.upload(),first=await upload(start);assert.equal(first.ok,true);assert.equal((await upload(start)).id,first.id)
 assert.equal((await s.upload('owner-b')({action:'files.finish',id:first.id})).error.code,'NOT_FOUND')
 assert.equal((await upload({action:'files.finish',id:first.id})).error.code,'UPLOAD_INCOMPLETE')
 const chunk={action:'files.chunk',id:first.id,index:0,data:pdf.toString('base64')};assert.equal((await upload(chunk)).ok,true);assert.equal((await upload(chunk)).ok,true)
 const wrong=Buffer.from(pdf);wrong[10]=65;assert.equal((await upload({...chunk,data:wrong.toString('base64')})).error.code,'CONFLICT')
 const result=await upload({action:'files.finish',id:first.id});assert.equal(result.file.size,pdf.length);assert.equal(s.files.size,1);assert.deepEqual(await upload({action:'files.finish',id:first.id}),result)
 const r=await s.submit({attachmentIds:[first.id]});assert.equal(r.ok,true);assert.equal(s.read('users',s.uid).registrationUploadSlots.length,0)
 assert.equal((await upload({action:'files.discard',id:first.id})).error.code,'CONFLICT')
})
test('file content mismatch, excessive size, executable extension, expiry and discard never become accepted attachments',async()=>{
 const s=fixture(),upload=s.upload()
 for(const values of [{name:'bad.exe',size:1},{name:'../a.pdf',size:1},{name:'large.pdf',size:10*1024*1024+1},{name:'zero.pdf',size:0}])assert.equal((await upload({action:'files.start',competitionId:cid,requestId:req,...values})).error.code,'INVALID_ARGUMENT')
 const r=await upload({action:'files.start',competitionId:cid,requestId:req,name:'fake.pdf',size:10});await upload({action:'files.chunk',id:r.id,index:0,data:Buffer.alloc(10).toString('base64')});assert.equal((await upload({action:'files.finish',id:r.id})).error.code,'INVALID_ATTACHMENT')
 assert.equal((await upload({action:'files.discard',id:r.id})).ok,true);assert.equal(s.files.size,0);assert.equal((await upload({action:'files.finish',id:r.id})).error.code,'INVALID_ATTACHMENT')
 const next=await upload({action:'files.start',competitionId:cid,requestId:'b'.repeat(32),name:'later.pdf',size:10});s.clock.value+=86400001;assert.equal((await upload({action:'files.chunk',id:next.id,index:0,data:Buffer.alloc(10).toString('base64')})).error.code,'INVALID_ATTACHMENT')
})
test('multi-chunk content is checked and reassembled, out-of-order chunks and concurrent finish are safe',async()=>{
 const s=fixture(),upload=s.upload(),pdf=Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(CHUNK*2,32),Buffer.from('\n%%EOF')])
 const first=await upload({action:'files.start',competitionId:cid,requestId:req,name:'long.pdf',size:pdf.length})
 for(const i of [2,0,1])assert.equal((await upload({action:'files.chunk',id:first.id,index:i,data:pdf.subarray(i*CHUNK,Math.min((i+1)*CHUNK,pdf.length)).toString('base64')})).ok,true)
 const results=await Promise.all([upload({action:'files.finish',id:first.id}),upload({action:'files.finish',id:first.id})]);assert.ok(results.every(r=>r.ok));assert.equal(s.files.size,1);assert.deepEqual([...s.files.values()][0],pdf)
})
test('both deployed functions share identical registration state rules',async()=>{
 assert.deepEqual(await readFile('cloudfunctions/teamManagement/registration-model.js'),await readFile('cloudfunctions/adminAuth/registration-model.js'))
})

test('supported real PNG/Word/Excel assets pass detection; mismatched and unsupported ASF inputs are rejected before parsing',async()=>{
 const {validateFile}=require('../cloudfunctions/teamManagement/registration-files')
 for(const [path,extension] of [['src/static/brand.png','png'],['docs/中国社超上海赛区赛事平台开发计划.docx','docx'],['docs/中国社超上海赛区赛事平台-开发计划与进度.xlsx','xlsx']]){const bytes=await readFile(path);await validateFile(bytes,extension);await assert.rejects(()=>validateFile(bytes,'pdf'))}
 const asf=Buffer.from('3026b2758e66cf11a6d900aa0062ce6c0000000000000000000000000000000000','hex')
 for(const ext of ['pdf','png','jpg','docx','xlsx'])await assert.rejects(()=>validateFile(asf,ext),(e:any)=>e.code==='INVALID_ATTACHMENT')
})

test('approval/cancellation and team dissolution/submission races serialize without dangling references or negative counters',async()=>{
 for(let i=0;i<2;i++){
  const s=fixture(),r=(await s.submit()).registration
  const cancel=()=>s.service({action:'registrations.cancel',id:r.id,expectedVersion:r.version,requestId:'d'.repeat(32)})
  const responses=await Promise.all(i?[cancel(),s.review(r)]:[s.review(r),cancel()]);assert.equal(responses.filter(r=>r.ok).length,1);assert.equal(responses.find(r=>!r.ok).error.code,'CONFLICT');assert.ok(s.read('competitions',cid).registrationStats.occupied>=0)
 }
 const s=fixture(),dissolve=createTeamService({store:s.store,context:()=>({APPID:APP_ID,OPENID:'owner-a'}),logger:{error(){}}})
 const [submitted,dissolved]=await Promise.all([s.submit(),dissolve({action:'dissolve',expectedVersion:1,confirmName:'原球队名'})]);assert.equal([submitted,dissolved].filter(r=>r.ok).length,1)
 const t=s.read('teams','t_'+s.uid),r=s.read('registrations',registrationId(cid,t._id));assert.equal(t.status==='dissolved'&&!!r,false)
})
