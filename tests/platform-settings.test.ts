import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {defaultPlatformForm,parsePlatformForm,parsePlatformSettings,themeTokens,themes} from '../src/domain/platform-settings'
import {createPlatformState} from '../src/composables/platform-settings-state'
const require=createRequire(import.meta.url)
const {createSettingsService,PUBLIC_ACTIONS}=require('../cloudfunctions/adminAuth/platform-settings.js')
const {createContentMemoryStore}=require('./helpers/content-store.cjs')
const {createHttpHandler}=require('../cloudfunctions/adminAuth/http.js')
const TOKEN='a'.repeat(64),requestId='1'.repeat(32),timestamp='2026-11-18T02:00:00.000Z'
const settings=(version=1)=>({version,updatedAt:version?timestamp:null,form:defaultPlatformForm()})
function fixture(){
 const memory=createContentMemoryStore()
 const service=createSettingsService({store:memory.store,authorize:async(token:string)=>token===TOKEN?{ok:true}:{ok:false,error:{code:'UNAUTHORIZED',message:'请先登录'}},now:()=>Date.parse(timestamp),logger:{error(){}}})
 const save=(fields:any={})=>service({action:'settings.update',token:TOKEN,requestId,expectedVersion:0,form:defaultPlatformForm(),...fields})
 return {...memory,service,save}
}
test('settings public defaults are detached, have no management metadata, and only public reads bypass HTTP authentication',async()=>{
 const f=fixture(),r=await f.service({action:'settings.getPublic'})
 assert.deepEqual(r.settings,settings(0));r.settings.form.title='changed'
 assert.equal((await f.service({action:'settings.getPublic'})).settings.form.title,'中国社超')
 const http=createHttpHandler(f.service,['https://admin.example.com'],PUBLIC_ACTIONS)
 for(const action of ['settings.getAdmin','settings.update']){
  assert.equal((await f.service({action,token:'forged',userInfo:{admin:true}})).error.code,'UNAUTHORIZED')
  assert.equal((await http({httpMethod:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action})})).statusCode,401)
 }
 const r2=await http({httpMethod:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'settings.getPublic'})})
 assert.equal(r2.statusCode,200);assert.equal(r2.headers['Cache-Control'],'no-store')
 assert.equal(f.collections.platformSettings.size,0)
})
test('one saved settings document drives public/admin reads and projects only approved fields',async()=>{
 const f=fixture(),form={...defaultPlatformForm(),title:'社区联赛',theme:'custom',customColor:'#AABBDD'}
 const r=await f.save({form});assert.equal(r.ok,true);assert.equal(r.settings.version,1)
 const stored=f.collections.platformSettings.get('primary');assert.equal(stored.lastRequestId,requestId);assert.ok(stored.lastFingerprint)
 const pub=await f.service({action:'settings.getPublic'}),admin=await f.service({action:'settings.getAdmin',token:TOKEN})
 assert.deepEqual(pub,admin);assert.deepEqual(Object.keys(pub.settings).sort(),['form','updatedAt','version'])
 assert.equal(pub.settings.form.customColor,'#aabbdd');assert.deepEqual(parsePlatformSettings(pub.settings),pub.settings)
 assert.equal(JSON.stringify(pub).includes(requestId),false)
})
test('lost acknowledgement retries commit once and changed reuse is rejected',async()=>{
 const f=fixture(),r=await f.save(),retry=await f.save()
 assert.deepEqual(r,retry);assert.equal(f.collections.platformSettings.get('primary').version,1)
 assert.equal((await f.save({form:{...defaultPlatformForm(),title:'不同内容'}})).error.code,'CONFLICT')
 assert.equal((await f.save({expectedVersion:1})).error.code,'CONFLICT')
 assert.equal(f.collections.platformSettings.get('primary').version,1)
})
test('competing administrators cannot silently overwrite another saved version',async()=>{
 const f=fixture(),results=await Promise.all([f.save(),f.save({requestId:'2'.repeat(32),form:{...defaultPlatformForm(),title:'第二个编辑'}})])
 assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).error.code,'CONFLICT')
 assert.equal(f.collections.platformSettings.get('primary').version,1)
 const next=await f.save({expectedVersion:1,requestId:'3'.repeat(32),form:{...defaultPlatformForm(),title:'已重新读取'}})
 assert.equal(next.settings.version,2);assert.equal((await f.save()).error.code,'CONFLICT')
})
test('invalid fields, navigation destinations, unsafe CSS values and forged metadata cannot be saved',async()=>{
 const f=fixture(),base=defaultPlatformForm()
 const invalid=[{title:''},{title:' leading'},{title:'名'.repeat(17)},{subtitle:'副'.repeat(25)},{title:'隐\u202e藏'},{theme:'unknown'},{mode:'auto'},{radius:'100px'},{customColor:'red'},{customColor:'#fff;url(x)'},{version:99},{navigation:base.navigation.slice(0,5)},{navigation:[...base.navigation.slice(1),base.navigation[1]]},{navigation:base.navigation.map((n,i)=>i? n:{...n,id:'https://evil.example'})},{navigation:base.navigation.map((n,i)=>i? n:{...n,icon:'../../x'})},{navigation:base.navigation.map((n,i)=>i? n:{...n,label:'名称太长了'})},{navigation:base.navigation.map((n,i)=>i? n:{...n,url:'https://evil.example'})}]
 for(const change of invalid)assert.equal((await f.save({form:{...base,...change}})).error.code,'INVALID_ARGUMENT',JSON.stringify(change))
 for(const fields of [{expectedVersion:-1},{expectedVersion:0.5},{expectedVersion:Number.MAX_SAFE_INTEGER},{requestId:'short'},{role:'admin'}])assert.equal((await f.save(fields)).error.code,'INVALID_ARGUMENT')
 assert.equal(f.collections.platformSettings.size,0)
})
test('unicode limits count code points, text stays data, and all six navigation entries can be reordered',async()=>{
 const f=fixture(),form=defaultPlatformForm();form.title='⚽'.repeat(16);form.navigation.reverse();form.navigation[0].label='<b>'
 const r=await f.save({form});assert.equal(r.ok,true);assert.deepEqual(r.settings.form,parsePlatformForm(form))
 assert.equal(r.settings.form.navigation[0].id,'profile')
})
test('read/write outages and malformed persisted documents report unavailable without fabricated defaults or partial commits',async()=>{
 const f=fixture();f.failures.read=true
 assert.equal((await f.service({action:'settings.getPublic'})).error.code,'SERVICE_UNAVAILABLE')
 assert.equal((await f.save()).error.code,'SERVICE_UNAVAILABLE');f.failures.read=false;f.failures.write=true
 assert.equal((await f.save()).error.code,'SERVICE_UNAVAILABLE');assert.equal(f.collections.platformSettings.size,0)
 f.failures.write=false;await f.save();const stored=f.collections.platformSettings.get('primary');stored.form.navigation=[]
 assert.equal((await f.service({action:'settings.getPublic'})).error.code,'SERVICE_UNAVAILABLE')
 assert.equal((await f.save({expectedVersion:1,requestId:'2'.repeat(32)})).error.code,'SERVICE_UNAVAILABLE');assert.equal(stored.version,1)
})
test('server/client settings catalog stays identical and every configured icon exists',async()=>{
 const {readFile,access}=await import('node:fs/promises')
 assert.equal(await readFile('src/domain/platform-settings-schema.json','utf8'),await readFile('cloudfunctions/adminAuth/platform-settings-schema.json','utf8'))
 const schema=require('../cloudfunctions/adminAuth/platform-settings-schema.json')
 for(const icon of schema.icons)for(const tone of ['ink','white','muted'])await access(`src/static/icons/${icon}-${tone}.png`)
})
test('client parser refuses malformed versions/forms and removes private projection fields',()=>{
 for(const value of [null,{...settings(),version:-1},{...settings(),version:1.5},{...settings(),updatedAt:null},{...settings(0),updatedAt:timestamp},{...settings(),form:{...defaultPlatformForm(),mode:'bad'}}])assert.throws(()=>parsePlatformSettings(value))
 assert.deepEqual(parsePlatformSettings({...settings(),secret:'private'}),settings())
})
function luminance(hex:string){return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[0.2126,0.7152,0.0722][i],0)}
const contrast=(a:string,b:string)=>(Math.max(luminance(a),luminance(b))+0.05)/(Math.min(luminance(a),luminance(b))+0.05)
test('eight themes and arbitrary custom colors keep button/navigation text readable in both modes',()=>{
 for(const mode of ['light','dark'] as const)for(const color of [...themes.map(t=>t.color),'#ffffff','#000000','#777777','#ff0000','#00ff00','#0000ff']){
  const tokens=themeTokens({...defaultPlatformForm(),theme:'custom',customColor:color,mode})
  assert.ok(contrast(tokens['--accent'],tokens['--on-accent'])>=4.5,`${mode} ${color} button`)
  for(const bg of ['--paper','--surface','--surface-soft'])assert.ok(contrast(tokens['--green'],tokens[bg])>=4.5,`${mode} ${color} ${bg}`)
  assert.ok(contrast('#ffffff',tokens['--theme-hero'])>=4.5)
 }
 const fallback=themeTokens({...defaultPlatformForm(),theme:'custom',customColor:'#f'})
 assert.equal(fallback['--accent'],themes[0].color);assert.equal(JSON.stringify(fallback).includes('NaN'),false)
})
test('cache is validated once and concurrent refresh calls share one network load',async()=>{
 let calls=0,reads=0,release!:(v:any)=>void
 const cached=settings(3),state=createPlatformState({load:()=>{calls++;return new Promise(r=>release=r)},readCache:()=>{reads++;return cached},writeCache(){}})
 state.initialize();state.initialize();assert.equal(reads,1);assert.equal(state.settings.value.version,3);assert.equal(state.confirmed.value,false)
 const a=state.refresh(),b=state.refresh();assert.equal(calls,1);release(settings(4));await Promise.all([a,b])
 assert.equal(state.settings.value.version,4);assert.equal(state.confirmed.value,true);assert.equal(state.loading.value,false)
})
test('failed or stale refresh preserves last good settings and retry applies current version',async()=>{
 let next:any=settings(3),reject=false;const written:any[]=[]
 const state=createPlatformState({load:async()=>{if(reject)throw new Error('离线');return next},readCache:()=>settings(2),writeCache:s=>written.push(s)})
 await state.refresh();reject=true;await state.refresh();assert.equal(state.settings.value.version,3);assert.equal(state.error.value,'离线')
 reject=false;next=settings(1);await state.refresh();assert.equal(state.settings.value.version,3);assert.ok(state.error.value)
 next=settings(4);await state.refresh();assert.equal(state.settings.value.version,4);assert.equal(state.error.value,'');assert.deepEqual(written.map(s=>s.version),[3,4])
})
test('corrupt cache and denied device storage do not prevent usable fresh settings',async()=>{
 const state=createPlatformState({load:async()=>settings(2),readCache:()=>({version:'bad'}),writeCache(){throw new Error('storage denied')}})
 state.initialize();assert.equal(state.settings.value.version,0);await state.refresh();assert.equal(state.settings.value.version,2);assert.equal(state.error.value,'')
 const denied=createPlatformState({load:async()=>settings(),readCache(){throw new Error('storage denied')},writeCache(){}})
 await denied.refresh();assert.equal(denied.settings.value.version,1)
})
test('invalid cloud response cannot poison cache or replace a valid theme',async()=>{
 let writes=0;const state=createPlatformState({load:async()=>({...settings(2),form:{title:'bad'}} as any),readCache:()=>settings(1),writeCache(){writes++}})
 await state.refresh();assert.equal(state.settings.value.version,1);assert.equal(writes,0);assert.ok(state.error.value);assert.equal(state.loading.value,false)
})
