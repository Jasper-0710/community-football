import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {randomBytes} from 'node:crypto'
import {parseManagedTeam} from '../src/domain/team'
import {parsePublicTeam} from '../src/domain/content'
import {parseBadgeImage,parseBadgeUpload,parseBadgeReceipt,parseBadgeCleanup,BADGE_MAX_BYTES} from '../src/domain/team-badge'
const require=createRequire(import.meta.url)
const {PNG}=require('pngjs'),jpeg=require('jpeg-js')
const {createTeamService,userId,APP_ID}=require('../cloudfunctions/teamManagement/service')
const {createTeamBadgeService}=require('../cloudfunctions/teamManagement/team-badges')
const {validateTeamBadge}=require('../cloudfunctions/teamManagement/team-badge-validation')
const {createTeamBadgeCleanup}=require('../cloudfunctions/adminAuth/team-badge-cleanup')
const {createAdminTeamService}=require('../cloudfunctions/adminAuth/teams')
const {createContentService}=require('../cloudfunctions/adminAuth/content')
const {createTeamMemory}=require('./helpers/team-store.cjs')
const {createNewsImageStorage}=require('./helpers/news-image-storage.cjs')
const {CHUNK,TTL,LEASE}=require('../cloudfunctions/teamManagement/team-badge-model')
const form={name:'队徽测试球队',district:'徐汇区',description:'球队介绍',contactPhone:'13800000000'}
const png=(value=180)=>PNG.sync.write({width:4,height:3,data:Buffer.alloc(48,value)})
async function fixture(enabled=true){
 const memory=createTeamMemory(),files=createNewsImageStorage(),clock={value:Date.parse('2026-11-17T08:00:00Z')}
 const identity={APPID:APP_ID,OPENID:'badge-owner'},uid=userId(APP_ID,identity.OPENID)
 for(const openId of ['badge-owner','other-owner'])memory.seed('users',userId(APP_ID,openId),{appId:APP_ID,openId,nickname:'领队',role:'leader'})
 const teamService=createTeamService({store:memory.store,storage:files.storage,badgeUploadEnabled:enabled,context:()=>identity,logger:{error(){}}})
 const team=(await teamService({action:'create',requestId:'a'.repeat(32),form})).team
 const make=(who=identity,active=enabled)=>createTeamBadgeService({store:memory.store,storage:files.storage,context:()=>who,enabled:active,now:()=>clock.value,logger:{error(){}}})
 const service=make(),call=(action:string,args:any={})=>service({action:`badges.${action}`,...args})
 const start=(bytes=png(),extra:any={})=>call('start',{teamId:team.id,requestId:randomBytes(16).toString('hex'),size:bytes.length,mime:'image/png',...extra})
 async function upload(bytes=png(),extra:any={}){const started=await start(bytes,extra);assert.equal(started.ok,true,JSON.stringify(started));for(let i=0;i<Math.ceil(bytes.length/CHUNK);i++)assert.equal((await call('chunk',{id:started.id,index:i,data:bytes.subarray(i*CHUNK,(i+1)*CHUNK).toString('base64')})).ok,true);const finished=await call('finish',{id:started.id});assert.equal(finished.ok,true,JSON.stringify(finished));return finished.image}
 const store={read:async(c:string,id:string)=>memory.read(c,id),atomic:memory.store.transaction,listBadges:async(cursor:string,limit:number)=>[...memory.records.entries()].filter(([k,v]:any)=>k.startsWith('teamBadges/')&&(!cursor||v._id>cursor)).map(([,v]:any)=>structuredClone(v)).sort((a:any,b:any)=>a._id.localeCompare(b._id)).slice(0,limit)}
 const cleanup=createTeamBadgeCleanup({store,storage:files.storage,now:()=>clock.value,authorize:async(token:string)=>token==='admin'?{ok:true}:{ok:false,error:{code:'UNAUTHORIZED'}},logger:{error(){}}})
 const clean=(dryRun=true,cursor?:string)=>cleanup({action:'teams.badges.cleanup',token:'admin',dryRun,...(cursor?{cursor}:{})})
 const admin=createAdminTeamService({store:memory.adminStore,storage:files.storage,authorize:async()=>({ok:true}),logger:{error(){}}})
 const content=createContentService({store:{...store,scan:async(name:string)=>[...memory.records.entries()].filter(([k]:any)=>k.startsWith(name+'/')).map(([,v]:any)=>structuredClone(v))},storage:files.storage,authorize:async()=>({ok:true}),logger:{error(){}}})
 const save=(id:string,expectedVersion=memory.read('teams',team.id).version)=>call('save',{teamId:team.id,id,expectedVersion})
 return {...memory,...files,clock,identity,uid,team,teamService,service,make,call,start,upload,store,clean,cleanup,admin,content,save}
}
test('badge uploads use trusted identity, real profile, separate capability, and owner binding',async()=>{
 const f=await fixture(false)
 for(const identity of [{APPID:APP_ID,OPENID:''},{APPID:'foreign',OPENID:'badge-owner'},{APPID:APP_ID,OPENID:'unknown'}])assert.equal((await f.make(identity)({action:'badges.config'})).error.code,'AUTH_REQUIRED')
 assert.equal((await f.call('config')).enabled,false);assert.equal((await f.start()).error.code,'UPLOAD_UNAVAILABLE')
 assert.equal((await f.make({APPID:APP_ID,OPENID:'other-owner'},true)({action:'badges.start',teamId:f.team.id,requestId:'b'.repeat(32),size:png().length,mime:'image/png'})).error.code,'NOT_FOUND')
 assert.equal(f.objects.size,0)
})
test('metadata and field injection reject invalid sizes, types, team IDs and identity overrides',async()=>{
 const f=await fixture()
 for(const extra of [{size:0},{size:BADGE_MAX_BYTES+1},{mime:'image/svg+xml'},{teamId:'forged'},{requestId:'x'},{fileID:'cloud://forged'},{ownerUserId:f.uid},{token:'admin'}])assert.equal((await f.start(png(),extra)).error.code,'INVALID_ARGUMENT')
 const s=await f.start(png(),{userInfo:{OPENID:'other-owner'},tcbContext:{APPID:'foreign'}});assert.equal(s.ok,true)
 assert.equal(f.read('teamBadges',s.id).ownerUserId,f.uid)
})
test('PNG/JPG validation decodes bytes and rejects truncated, oversized, CRC damaged or disguised content',()=>{
 assert.deepEqual(validateTeamBadge(png(),'image/png'),{width:4,height:3})
 const jpg=jpeg.encode({width:4,height:3,data:Buffer.alloc(48,180)},80).data
 assert.deepEqual(validateTeamBadge(jpg,'image/jpeg'),{width:4,height:3})
 const damaged=png();damaged[29]^=1
 const wide=png();wide.writeUInt32BE(2049,16)
 const pixels=png();pixels.writeUInt32BE(2048,16);pixels.writeUInt32BE(2048,20)
 for(const bytes of [damaged,wide,pixels,png().subarray(0,-8),Buffer.from('<svg/>'),Buffer.alloc(BADGE_MAX_BYTES+1)])assert.throws(()=>validateTeamBadge(bytes,'image/png'))
 assert.throws(()=>validateTeamBadge(jpg.subarray(0,-2),'image/jpeg'))
})
test('a 256KiB four-chunk session resumes acknowledged chunks and locks their content',async()=>{
 const f=await fixture(),bytes=randomBytes(BADGE_MAX_BYTES),requestId='b'.repeat(32),s=await f.start(bytes,{requestId})
 for(let i=0;i<4;i++)assert.equal((await f.call('chunk',{id:s.id,index:i,data:bytes.subarray(i*CHUNK,(i+1)*CHUNK).toString('base64')})).ok,true)
 assert.deepEqual((await f.start(bytes,{requestId})).uploaded,[0,1,2,3])
 assert.equal((await f.call('chunk',{id:s.id,index:0,data:randomBytes(CHUNK).toString('base64')})).error.code,'CONFLICT')
 assert.equal((await f.call('finish',{id:s.id})).error.code,'INVALID_ARGUMENT')
 assert.equal(f.read('teams',f.team.id).badgeFileId,'')
})
test('lost upload response is tracked before bytes are written and retries reuse a staged object',async()=>{
 const f=await fixture(),s=await f.start(),chunk={id:s.id,index:0,data:png().toString('base64')}
 f.controls.responseFails=1
 assert.equal((await f.call('chunk',chunk)).error.code,'SERVICE_UNAVAILABLE')
 assert.equal(f.objects.size,1);assert.equal(f.read('teamBadges',s.id).objects.length,1)
 assert.equal((await f.call('chunk',chunk)).ok,true);assert.equal(f.objects.size,1)
 const image=parseBadgeImage((await f.call('finish',{id:s.id})).image)
 assert.equal(image.width,4);assert.equal((await f.call('finish',{id:s.id})).image.id,image.id);assert.equal(f.objects.size,2)
})
test('incomplete, mismatched length and tampered storage never become a ready badge',async()=>{
 const f=await fixture(),s=await f.start()
 assert.equal((await f.call('finish',{id:s.id})).error.code,'CONFLICT')
 for(const args of [{index:1,data:png().toString('base64')},{index:0,data:'a==='},{index:0,data:Buffer.alloc(1).toString('base64')}])assert.equal((await f.call('chunk',{id:s.id,...args})).error.code,'INVALID_ARGUMENT')
 await f.call('chunk',{id:s.id,index:0,data:png().toString('base64')});f.objects.set([...f.objects.keys()][0],Buffer.alloc(png().length))
 assert.equal((await f.call('finish',{id:s.id})).error.code,'INVALID_ARGUMENT');assert.equal(f.read('teamBadges',s.id).status,'uploading')
})
test('save binds final object and badge reference in one transaction; retries do not increment version',async()=>{
 const f=await fixture(),image=await f.upload();assert.equal(f.read('teams',f.team.id).badgeFileId,'')
 assert.equal((await f.save(image.id,1)).version,2);assert.equal((await f.save(image.id,1)).version,2)
 const team=f.read('teams',f.team.id),badge=f.read('teamBadges',image.id)
 assert.equal(team.badgeFileId,badge.fileID);assert.equal(team.badgeId,image.id);assert.equal(badge.referenced,true);assert.equal(badge.expiresAt,null)
 assert.equal(JSON.stringify(team).includes('https://'),false)
 const owner=parseManagedTeam((await f.teamService({action:'mine'})).team);assert.equal(owner.hasBadge,true);assert.match(owner.badgeUrl,/^https:/);assert.equal(owner.badgeUploadEnabled,true)
 assert.equal('_badgeFileId' in owner,false)
})
test('stale writes, cross-team attachments, and partial reference failures leave old badge intact',async()=>{
 const f=await fixture(),a=await f.upload();await f.save(a.id);const b=await f.upload(png(70))
 const before=structuredClone([...f.records])
 assert.equal((await f.save(b.id,1)).error.code,'CONFLICT');assert.deepEqual([...f.records],before)
 f.failures.failAfter=1;assert.equal((await f.save(b.id,2)).error.code,'SERVICE_UNAVAILABLE');assert.deepEqual([...f.records],before)
 f.failures.failAfter=Infinity
 const foreign=f.read('teamBadges',b.id);f.seed('teamBadges',b.id,{...foreign,teamId:`t_${'b'.repeat(64)}`})
 assert.equal((await f.save(b.id,2)).error.code,'INVALID_ARGUMENT');assert.equal(f.read('teams',f.team.id).badgeId,a.id)
})
test('replacement releases old reference for 24h and remove restores default without deleting archive data',async()=>{
 const f=await fixture(),a=await f.upload();await f.save(a.id);const b=await f.upload(png(90));await f.save(b.id)
 assert.equal(f.read('teamBadges',a.id).referenced,false);assert.equal(f.read('teamBadges',a.id).expiresAt,f.clock.value+TTL)
 assert.equal(f.read('teamBadges',b.id).referenced,true)
 assert.equal((await f.call('remove',{teamId:f.team.id,expectedVersion:3})).version,4)
 assert.equal((await f.call('remove',{teamId:f.team.id,expectedVersion:3})).version,4)
 assert.equal(f.read('teams',f.team.id).badgeFileId,'');assert.equal(f.read('teams',f.team.id).badgeId,'')
 assert.equal(f.objects.size,4)
})
test('different leaders cannot chunk, finish, save or remove a known image',async()=>{
 const f=await fixture(),image=await f.upload(),other=f.make({APPID:APP_ID,OPENID:'other-owner'})
 for(const event of [{action:'badges.chunk',id:image.id,index:0,data:png().toString('base64')},{action:'badges.finish',id:image.id},{action:'badges.save',teamId:f.team.id,id:image.id,expectedVersion:1},{action:'badges.remove',teamId:f.team.id,expectedVersion:1}])assert.equal((await other(event)).error.code,'NOT_FOUND')
 assert.equal(f.read('teams',f.team.id).version,1)
})
test('dissolution races serialize against saving; archived badge is preserved and pending sessions cannot attach to a new team',async()=>{
 for(const saveFirst of [true,false]){
  const f=await fixture(),image=await f.upload()
  const save=()=>f.save(image.id,1),dissolve=()=>f.teamService({action:'dissolve',expectedVersion:1,confirmName:form.name})
  const [a,b]=await Promise.all(saveFirst?[save(),dissolve()]:[dissolve(),save()])
  assert.equal(a.ok,true);assert.equal(b.error.code,saveFirst?'CONFLICT':'NOT_FOUND')
  if(saveFirst){await f.teamService({action:'dissolve',expectedVersion:2,confirmName:form.name});assert.equal(f.read('teams',f.team.id).badgeId,image.id)}
  await f.teamService({action:'create',requestId:'c'.repeat(32),form})
  assert.equal((await f.call('finish',{id:image.id})).error.code,'NOT_FOUND');assert.equal((await f.save(image.id,3)).error.code,'NOT_FOUND')
 }
})
test('signing failures leave owned/admin/public team readable and refresh recovers the persisted image',async()=>{
 const f=await fixture(),image=await f.upload();await f.save(image.id)
 const cid=`c_${'1'.repeat(32)}`;f.seed('competitions',cid,{displayEnabled:true});f.seed('registrations','approved',{teamId:f.team.id,competitionId:cid,status:'approved'})
 f.controls.linkFails=true
 assert.equal(parseManagedTeam((await f.teamService({action:'mine'})).team).badgeUrl,'')
 assert.equal(parseManagedTeam((await f.admin({action:'teams.getAdmin',id:f.team.id})).team).hasBadge,true)
 const out=parsePublicTeam((await f.content({action:'directory.teamPublic',id:f.team.id})).team);assert.equal(out.hasBadge,true);assert.equal(out.badgeUrl,'');assert.equal('badgeId' in out,false)
 f.controls.linkFails=false
 const publicResult=(await f.content({action:'directory.teamPublic',id:f.team.id})).team;assert.match(publicResult.badgeUrl,/^https:/)
 for(const secret of ['badgeFileId','badgeId','ownerUserId','contactPhone','leaderUserId'])assert.equal(secret in publicResult,false)
 f.seed('competitions',cid,{displayEnabled:false});assert.equal((await f.content({action:'directory.teamPublic',id:f.team.id})).error.code,'NOT_FOUND')
})
test('cleanup previews without writes, protects active and archived references, and removes only unreferenced files',async()=>{
 const f=await fixture(),a=await f.upload();await f.save(a.id);const abandoned=await f.upload(png(40))
 await f.teamService({action:'dissolve',expectedVersion:2,confirmName:form.name})
 f.clock.value+=TTL+LEASE+1
 const before=f.objects.size,preview=parseBadgeCleanup(await f.clean())
 assert.equal(preview.protectedBadges,1);assert.equal(f.objects.size,before);assert.equal(preview.eligibleObjects,3)
 const report=await f.clean(false);assert.equal(report.removedObjects,3)
 assert.equal(f.objects.size,1);assert.equal(f.objects.has(f.read('teamBadges',a.id).fileID),true)
 assert.equal(f.read('teamBadges',abandoned.id).status,'cleaned');assert.equal((await f.clean(false)).removedObjects,0)
})
test('cleanup enforces admin authorization, partial retries and foreign environment protection',async()=>{
 const f=await fixture(),image=await f.upload();f.clock.value+=TTL+LEASE+1
 assert.equal((await f.cleanup({action:'teams.badges.cleanup',dryRun:false})).error.code,'UNAUTHORIZED')
 f.controls.removeLimit=1;assert.equal((await f.clean(false)).removedObjects,1);f.controls.removeLimit=Infinity;assert.equal((await f.clean(false)).removedObjects,1)
 const b=await f.upload(),file=f.read('teamBadges',b.id);f.seed('teamBadges',b.id,{...file,objects:[...file.objects,{fileID:'cloud://foreign/team-badges/x',cloudPath:'team-badges/x',leaseUntil:0}]});f.clock.value+=TTL+LEASE+1
 const before=f.objects.size;assert.ok((await f.clean(false)).deferredBadges>0);assert.equal(f.objects.size,before)
 assert.equal(image.id.startsWith('tb_'),true)
})
test('expired/claimed sessions cannot bind and concurrent cleaners cannot delete a newly attached badge',async()=>{
 const f=await fixture(),image=await f.upload();f.clock.value+=TTL+1
 assert.equal((await f.save(image.id)).error.code,'INVALID_ARGUMENT')
 const file=f.read('teamBadges',image.id);f.seed('teamBadges',image.id,{...file,expiresAt:f.clock.value+TTL,cleanupLeaseUntil:f.clock.value+1000})
 assert.equal((await f.save(image.id)).error.code,'INVALID_ARGUMENT')
 f.seed('teamBadges',image.id,{...file,expiresAt:f.clock.value+TTL})
 await f.save(image.id);f.clock.value+=TTL+LEASE+1;await f.clean(false)
 assert.equal(f.objects.has(f.read('teams',f.team.id).badgeFileId),true)
})
test('client parsers accept legacy no-badge data but reject unsafe links, malformed capability, chunks and receipts',async()=>{
 const f=await fixture(),image=await f.upload();parseBadgeImage(image)
 for(const extra of [{url:'javascript:alert(1)'},{url:'https://u:p@host/x'},{width:2049},{teamId:'forged'},{size:BADGE_MAX_BYTES+1}])assert.throws(()=>parseBadgeImage({...image,...extra}))
 for(const uploaded of [[0,0],[-1],[1],[0.5]])assert.throws(()=>parseBadgeUpload({ok:true,id:image.id,chunkSize:CHUNK,uploaded},png().length))
 assert.throws(()=>parseBadgeReceipt({ok:true,teamId:f.team.id,version:1},f.team.id,1))
 assert.throws(()=>parseBadgeReceipt({ok:true,teamId:'wrong',version:2},f.team.id,1))
 const owner=(await f.teamService({action:'mine'})).team
 for(const change of [{badgeUrl:'http://unsafe'},{hasBadge:true,badgeId:''},{badgeUploadEnabled:'true'}])assert.throws(()=>parseManagedTeam({...owner,...change}))
 delete owner.badgeId;delete owner.hasBadge;assert.equal(parseManagedTeam(owner).hasBadge,false)
})
