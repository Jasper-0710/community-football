import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createHash,randomBytes} from 'node:crypto'
import {defaultPlatformForm,parsePlatformForm,parsePlatformSettings} from '../src/domain/platform-settings'
import {parseExternalEntries,parsePlatformUploadedImage,validExternalTarget} from '../src/domain/external-entries'
import {openExternalTarget,type ExternalNavigation} from '../src/domain/external-navigation'
import {createAdminApi} from '../admin/src/api'
import {prepareNewsImage} from '../admin/src/news-images'
import {uploadPlatformImage} from '../admin/src/platform-images'
const require=createRequire(import.meta.url)
const {PNG}=require('pngjs')
const {createSettingsService,PUBLIC_ACTIONS}=require('../cloudfunctions/adminAuth/platform-settings')
const {validateExternal,createPlatformImageService}=require('../cloudfunctions/adminAuth/external-entries')
const {CHUNK,TTL,LEASE}=require('../cloudfunctions/adminAuth/news-image-model')
const {createContentMemoryStore}=require('./helpers/content-store.cjs')
const {createNewsImageStorage}=require('./helpers/news-image-storage.cjs')
const {createHttpHandler}=require('../cloudfunctions/adminAuth/http')
const M=require('../cloudfunctions/adminAuth/recovery-model')
const {createRecoveryMemory}=require('./helpers/recovery-store.cjs')
const {createRecoveryService}=require('../cloudfunctions/adminAuth/recovery')
const token='a'.repeat(64),mini={kind:'miniProgram' as const,appId:'wx0123456789abcdef',path:'pages/index/index?from=football',url:''},web={kind:'https' as const,appId:'',path:'',url:'https://example.com/insurance/#/intro'}
const png=(color=100)=>PNG.sync.write({width:4,height:3,data:Buffer.alloc(4*3*4,color)})
function fixture(enabled=true){
 const memory=createContentMemoryStore(),files=createNewsImageStorage(),clock={value:Date.parse('2026-11-25T02:00:00Z')}
 const authorize=async(t:string)=>t===token?{ok:true,admin:{username:'admin'}}:{ok:false,error:{code:'UNAUTHORIZED',message:'请先登录'}}
 const options={store:memory.store,storage:files.storage,authorize,now:()=>clock.value,logger:{error(){}}}
 const settings=createSettingsService(options),images=createPlatformImageService({...options,enabled})
 const call=(action:string,args:any={})=>images({action:`settings.images.${action}`,token,...args})
 const save=(form=defaultPlatformForm(),version=memory.collections.platformSettings.get('primary')?.version||0,requestId=randomBytes(16).toString('hex'))=>settings({action:'settings.update',token,form,expectedVersion:version,requestId})
 async function upload(color=100){const bytes=png(color),start=await call('start',{settingsId:'primary',requestId:randomBytes(16).toString('hex'),name:'保障.png',mime:'image/png',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});assert.equal(start.ok,true);for(let i=0;i<Math.ceil(bytes.length/CHUNK);i++)assert.equal((await call('chunk',{id:start.id,index:i,data:bytes.subarray(i*CHUNK,(i+1)*CHUNK).toString('base64')})).ok,true);const result=await call('finish',{id:start.id});assert.equal(result.ok,true);return result.image}
 return {...memory,...files,clock,authorize,call,settings,images,save,upload}
}
test('F legacy settings/defaults remain disabled and old admin cannot erase configured external content',async()=>{
 const f=fixture(),form:any=defaultPlatformForm();delete form.external
 const r=await f.save(form);assert.equal(r.ok,true);assert.deepEqual(r.settings.form.external,defaultPlatformForm().external)
 assert.deepEqual(parsePlatformForm(form),defaultPlatformForm())
 const next=defaultPlatformForm();next.external.community={...next.external.community,enabled:true,target:mini}
 assert.equal((await f.save(next)).ok,true)
 assert.equal((await f.save(form)).error.code,'CONFLICT')
 assert.equal(f.collections.platformSettings.get('primary').version,2)
})
test('F shared target validation rejects unsafe/incomplete links, unknown fields, duplicate images and over-limit content',()=>{
 const valid=defaultPlatformForm().external
 valid.community={...valid.community,enabled:true,target:mini};valid.insurance.target=web
 assert.deepEqual(parseExternalEntries(valid),validateExternal(valid))
 for(const target of [{...mini,appId:''},{...mini,appId:'wxFORGED'},{...mini,path:'../private'},{...mini,path:'pages/a#x'},{...mini,path:'pages/a\\x'},{...mini,envVersion:'develop'},{...web,url:'javascript:alert(1)'},{...web,url:'http://example.com'},{...web,url:'https://admin:secret@example.com/'},{...web,url:'https://127.0.0.1/'},{...web,url:'https://foo.local/'},{...web,url:'https://example.com/\nhello'},{...web,url:'https://example.com/\\evil'}]){
  const bad={...valid,community:{...valid.community,target}}
  assert.throws(()=>parseExternalEntries(bad));assert.throws(()=>validateExternal(bad))
 }
 for(const change of [{enabled:true,images:[]},{title:'长'.repeat(21)},{images:[{imageId:'ni_'+'1'.repeat(32),caption:''}]},{images:Array.from({length:7},(_,i)=>({imageId:'pi_'+String(i).repeat(32),caption:''}))},{images:Array(2).fill({imageId:'pi_'+'1'.repeat(32),caption:''})},{images:[{imageId:'pi_'+'1'.repeat(32),caption:'',url:'https://evil.example.com'}]}]){
  const bad={...valid,insurance:{...valid.insurance,...change}};assert.throws(()=>parseExternalEntries(bad));assert.throws(()=>validateExternal(bad))
 }
 assert.equal(validExternalTarget({...mini,path:''},false,true),true)
 assert.equal(validExternalTarget(web,false,true),true)
})
test('F platform upload operations require admin, an explicit switch and fixed settings ownership',async()=>{
 const f=fixture(false)
 for(const action of ['config','start','chunk','finish','get','cleanup'])assert.equal((await f.call(action,{token:null})).error.code,'UNAUTHORIZED')
 assert.equal((await f.call('config')).enabled,false)
 assert.equal((await f.call('start')).error.code,'UPLOAD_UNAVAILABLE')
 assert.equal(f.collections.platformImages.size,0)
 const g=fixture(),bytes=png()
 assert.equal((await g.call('start',{settingsId:'other',requestId:'1'.repeat(32),name:'a.png',size:bytes.length,mime:'image/png',sha256:createHash('sha256').update(bytes).digest('hex')})).error.code,'INVALID_ARGUMENT')
})
test('F full admin transport uploads checked chunks; saved IDs resolve to renewed public URLs without private storage metadata',async()=>{
 const f=fixture(),http=createHttpHandler((e:any)=>e.action.startsWith('settings.images.')?f.images(e):f.settings(e),[],PUBLIC_ACTIONS)
 const api=createAdminApi('https://api.example.com',async(_url,init)=>{const r=await http({httpMethod:'POST',headers:init?.headers,body:init?.body});return new Response(r.body,{status:r.statusCode,headers:r.headers})})
 const bytes=png(),draft=await prepareNewsImage({name:'保障.png',size:bytes.length,type:'image/png',async arrayBuffer(){return Uint8Array.from(bytes).buffer}})
 const image=await uploadPlatformImage(draft,fn=>fn(api,token));assert.match(image.id,/^pi_/);assert.equal(draft.progress,100)
 const form=defaultPlatformForm();form.external.insurance={...form.external.insurance,enabled:true,target:web,images:[{imageId:image.id,caption:'保障说明'}]}
 const r=await api.savePlatformSettings(token,0,'1'.repeat(32),form),pub=await f.settings({action:'settings.getPublic'})
 assert.equal(r.version,1);assert.notEqual(pub.settings.insuranceImages[0].url,r.insuranceImages![0].url)
 assert.equal(parsePlatformUploadedImage(image).settingsId,'primary');assert.deepEqual(parsePlatformSettings(pub.settings),pub.settings)
 const stored=f.collections.platformSettings.get('primary');assert.equal(JSON.stringify(stored).includes('https://'),true) // configured external target only
 assert.equal(JSON.stringify(stored).includes('images.example.test'),false)
 for(const privateField of ['fileID','cloudPath','lastRequestId','sha256','settingsId','objects'])assert.equal(JSON.stringify(pub).includes(privateField),false)
 assert.equal(f.collections.platformImages.get(image.id).referenced,true)
 const large=await http({httpMethod:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({action:'settings.images.chunk',id:image.id,index:0,data:'A'.repeat(87000)})})
 assert.equal(JSON.parse(large.body).error.code,'INVALID_ARGUMENT');assert.notEqual(JSON.parse(large.body).error.message,'请求格式不正确。')
})
test('F retries after committed response/link failure do not increment twice; conflicts/invalid image references roll back together',async()=>{
 const f=fixture(),image=await f.upload(),form=defaultPlatformForm();form.external.insurance.images=[{imageId:image.id,caption:''}]
 const request='1'.repeat(32);f.controls.linkFails=true
 assert.equal((await f.save(form,0,request)).error.code,'SERVICE_UNAVAILABLE');assert.equal(f.collections.platformSettings.get('primary').version,1)
 f.controls.linkFails=false;assert.equal((await f.save(form,0,request)).settings.version,1)
 const bad=structuredClone(form);bad.external.insurance.images=[{imageId:'pi_'+'f'.repeat(32),caption:''}]
 assert.equal((await f.save(bad)).error.code,'INVALID_ARGUMENT');assert.equal(f.collections.platformSettings.get('primary').version,1)
 const second=await f.upload(180);bad.external.insurance.images=[{imageId:second.id,caption:''}]
 assert.equal((await f.save(bad,0)).error.code,'CONFLICT');assert.equal(f.collections.platformImages.get(second.id).referenced,false)
 f.failures.write=true;assert.equal((await f.save(bad)).error.code,'SERVICE_UNAVAILABLE');f.failures.write=false
 assert.equal(f.collections.platformImages.get(image.id).referenced,true);assert.equal(f.collections.platformImages.get(second.id).referenced,false)
})
test('F replace/remove retention and cleanup protect current/disabled references, foreign paths and concurrent late binds',async()=>{
 const f=fixture(),a=await f.upload(),b=await f.upload(180),form=defaultPlatformForm()
 form.external.insurance.images=[{imageId:a.id,caption:'第一张'}];assert.equal((await f.save(form)).ok,true)
 f.clock.value+=TTL+LEASE+1
 const dry=await f.call('cleanup',{dryRun:true});assert.equal(dry.protectedImages,1)
 await f.call('cleanup',{dryRun:false});assert.equal(f.objects.has(f.collections.platformImages.get(a.id).fileID),true);assert.equal(f.collections.platformImages.get(b.id).status,'cleaned')
 const bad=structuredClone(form);bad.external.insurance.images=[{imageId:b.id,caption:''}]
 assert.equal((await f.save(bad)).error.code,'INVALID_ARGUMENT')
 const c=await f.upload(80);form.external.insurance.images=[{imageId:c.id,caption:''}];assert.equal((await f.save(form)).ok,true)
 assert.equal(f.collections.platformImages.get(a.id).expiresAt,f.clock.value+TTL)
 assert.equal((await f.call('cleanup',{dryRun:false})).protectedImages,1)
 assert.equal(f.objects.has(f.collections.platformImages.get(a.id).fileID),true)
 f.clock.value+=TTL+LEASE+1;await f.call('cleanup',{dryRun:false});assert.equal(f.collections.platformImages.get(a.id).status,'cleaned')
 assert.equal(f.objects.has(f.collections.platformImages.get(c.id).fileID),true)
 form.external.insurance.images=[];assert.equal((await f.save(form)).ok,true)
 f.clock.value+=TTL+LEASE+1;await f.call('cleanup',{dryRun:false});assert.equal(f.collections.platformImages.get(c.id).status,'cleaned')
 const d=await f.upload();f.collections.platformImages.get(d.id).objects[0].fileID='cloud://foreign/path'
 f.clock.value+=TTL+LEASE+1;assert.ok((await f.call('cleanup',{dryRun:false})).deferredImages)
})
test('F image response cannot substitute unrelated IDs/URLs, dimensions, or missing linked assets',async()=>{
 const f=fixture(),image=await f.upload(),form=defaultPlatformForm();form.external.insurance.images=[{imageId:image.id,caption:''}]
 form.external.insurance.enabled=true
 const r=await f.save(form)
 for(const images of [[],[{...r.settings.insuranceImages[0],id:'pi_'+'0'.repeat(32)}],[{...r.settings.insuranceImages[0],url:'javascript:evil'}],[{...r.settings.insuranceImages[0],width:999999}]])assert.throws(()=>parsePlatformSettings({...r.settings,insuranceImages:images}))
 assert.throws(()=>parsePlatformUploadedImage({...image,settingsId:'other'}))
 f.collections.platformImages.get(image.id).referenced=false;assert.equal((await f.settings({action:'settings.getPublic'})).error.code,'SERVICE_UNAVAILABLE')
 const g=fixture(),foreign=await g.upload(),invalid=defaultPlatformForm();invalid.external.insurance.images=[{imageId:foreign.id,caption:''}]
 g.collections.platformImages.get(foreign.id).fileID='cloud://foreign/path'
 assert.equal((await g.save(invalid)).error.code,'INVALID_ARGUMENT');assert.equal(g.collections.platformSettings.size,0);assert.equal(g.collections.platformImages.get(foreign.id).referenced,false)
})
test('F disabled entries retain admin drafts/references but publish no targets or signed images',async()=>{
 const f=fixture(),image=await f.upload(),form=defaultPlatformForm();form.external.insurance.images=[{imageId:image.id,caption:'未发布介绍'}];form.external.insurance.target=web;form.external.community.target=mini
 const admin=await f.save(form);assert.equal(admin.ok,true);assert.equal(admin.settings.insuranceImages.length,1)
 f.controls.linkFails=true
 const publicResult=await f.settings({action:'settings.getPublic'});assert.equal(publicResult.ok,true)
 assert.deepEqual(publicResult.settings.form.external,defaultPlatformForm().external);assert.equal(publicResult.settings.insuranceImages,undefined)
 assert.equal(f.collections.platformImages.get(image.id).referenced,true);assert.equal(f.collections.platformSettings.get('primary').form.external.insurance.images.length,1)
})
test('F external navigation handles confirmation, mini-program cancellation/failure and browser unsupported state',async()=>{
 const calls:any[]=[],nav:ExternalNavigation={platform:'weixin',confirm:async label=>{calls.push(label);return true},miniProgram:async(...args)=>{calls.push(args)},web:async url=>{calls.push(url)}}
 assert.equal(await openExternalTarget(mini,'社区',nav),'opened');assert.deepEqual(calls[1],[mini.appId,mini.path])
 assert.equal(await openExternalTarget(web,'保障',nav),'opened');assert.equal(calls.at(-1),web.url)
 const before=calls.length;assert.equal(await openExternalTarget(mini,'社区',{...nav,platform:'h5'}),'unsupported');assert.equal(calls.length,before)
 assert.equal(await openExternalTarget(web,'保障',{...nav,confirm:async()=>false}),'cancelled')
 assert.equal(await openExternalTarget(mini,'社区',{...nav,miniProgram:async()=>{throw {errMsg:'navigateToMiniProgram:fail cancel'}}}),'cancelled')
 await assert.rejects(openExternalTarget(mini,'社区',{...nav,miniProgram:async()=>{throw new Error('target unavailable')}}),/暂时无法打开/)
 await assert.rejects(openExternalTarget({...web,url:'http://unsafe.com'},'保障',nav),/尚未正确配置/)
})
test('F backup and restore preserve image bytes and references, and pre-F 19-collection archives remain readable',async()=>{
 const f=createRecoveryMemory(),data=await f.store.snapshot(),legacy=structuredClone(data);delete legacy.platformImages
 assert.deepEqual(M.validateData(legacy).platformImages,[])
 const broken=structuredClone(legacy);delete broken.teams;assert.throws(()=>M.validateData(broken),/格式不完整/)
 const form=defaultPlatformForm(),id='pi_'+'1'.repeat(32),fileID=await f.storage.upload(`platform-images/files/${id}/${'a'.repeat(48)}.png`,png())
 form.external.insurance={...form.external.insurance,enabled:true,images:[{imageId:id,caption:'备份图片'}]}
 f.collections.platformSettings.set('primary',{_id:'primary',version:1,form,updatedAt:'2026-11-25T02:00:00Z'})
 f.collections.platformImages.set(id,{_id:id,settingsId:'primary',status:'ready',referenced:true,fileID,objects:[]})
 const service=createRecoveryService({...f,authorize:async()=>({ok:true,admin:{username:'admin'}}),enabled:true,probe:async()=>true,logger:{error(){}}})
 const saved=await service({action:'backup.create',token,requestId:'1'.repeat(32)});assert.equal(saved.ok,true);assert.equal(saved.backup.assetCount,1)
 f.collections.platformSettings.get('primary').form.external.insurance.enabled=false
 const preview=await service({action:'backup.preview',token,id:saved.backup.id,digest:saved.backup.digest});assert.equal(preview.ok,true);assert.equal(preview.plan.summary.length,20)
 const applied=await service({action:'backup.apply',token,planId:preview.plan.id,confirmation:preview.plan.confirmation});assert.equal(applied.ok,true)
 assert.equal(f.collections.platformSettings.get('primary').form.external.insurance.enabled,true);assert.equal(f.files.has(fileID),true)
 assert.deepEqual(M.assetIds(await f.store.snapshot()),[fileID])
 const missing=await f.store.snapshot();missing.platformImages=[];assert.throws(()=>M.validateData(missing),/关联/)
})
