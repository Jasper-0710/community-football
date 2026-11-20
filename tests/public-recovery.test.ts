import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createPublicRecovery,PublicReadError} from '../src/services/public-recovery'
function fixture(){
 let now=1000000,stored:any,primary:any={ok:true,value:'主服务',privateToken:'must-not-persist'},fallback:any={ok:true,value:'备用服务',recovery:{source:'fallback',savedAt:1000000,expiresAt:1120000}},primaryCalls=0,fallbackCalls=0
 const options={primary:async()=>{primaryCalls++;if(primary instanceof Error)throw primary;return primary},fallback:async()=>{fallbackCalls++;if(fallback instanceof Error)throw fallback;return fallback},sanitize:(_data:any,r:any)=>{if(r?.ok!==true)throw new PublicReadError(r?.error?.code||'INVALID_RESPONSE','失败');if(typeof r.value!=='string')throw new PublicReadError('INVALID_RESPONSE','失败');return{ok:true,value:r.value}},cacheable:(action:string)=>action==='news.listPublic',readCache:()=>stored,writeCache:(value:any)=>{stored=structuredClone(value)},now:()=>now}
 const state=createPublicRecovery(options),data={action:'news.listPublic'}
 return{state,data,options,get stored(){return stored},setStored(v:any){stored=v},primary(v:any){primary=v},fallback(v:any){fallback=v},advance(ms:number){now+=ms},get primaryCalls(){return primaryCalls},get fallbackCalls(){return fallbackCalls}}
}
const offline=()=>new PublicReadError('NETWORK_ERROR','断网')
test('D13 only sanitized successful primary responses become environment-scoped public snapshots',async()=>{
 const f=fixture();assert.equal((await f.state.read(f.data)).value,'主服务');assert.equal(JSON.stringify(f.stored).includes('privateToken'),false)
 f.primary(offline());assert.equal((await f.state.read(f.data)).value,'备用服务');assert.equal(f.state.notices.value[0].source,'fallback');assert.equal(f.stored.rows[0].value.value,'主服务');assert.throws(()=>f.state.assertWritable(),/只读/)
 f.fallback(offline());assert.equal((await f.state.read(f.data)).value,'主服务');assert.equal(f.state.notices.value[0].source,'snapshot');assert.equal(f.state.notices.value[0].savedAt,1000000)
 f.primary({ok:true,value:'已更新'});assert.equal((await f.state.read(f.data)).value,'已更新');assert.equal(f.state.notices.value.length,0);f.state.assertWritable()
})
test('D13 cache misses, first offline start, corrupt data and expired/future snapshots never fabricate business data',async()=>{
 const f=fixture();f.primary(offline());f.fallback(offline());await assert.rejects(f.state.read(f.data));await f.state.read(f.data).catch(()=>{})
 const seeded=fixture();await seeded.state.read(seeded.data);seeded.primary(offline());seeded.fallback(offline());seeded.advance(30*60000+1);await assert.rejects(seeded.state.read(seeded.data))
 const corrupt=fixture();corrupt.setStored({version:1,rows:[{key:JSON.stringify(corrupt.data),savedAt:1000000,value:{ok:true,value:42}}]});corrupt.primary(offline());corrupt.fallback(offline());await assert.rejects(corrupt.state.read(corrupt.data))
 const future=fixture();future.setStored({version:1,rows:[{key:JSON.stringify(future.data),savedAt:2000000,value:{ok:true,value:'未来'}}]});future.primary(offline());future.fallback(offline());await assert.rejects(future.state.read(future.data))
})
test('D13 authoritative hidden/forbidden/invalid responses do not fall back, and access denial purges public snapshots',async()=>{
 for(const code of ['NOT_FOUND','FORBIDDEN','UNAUTHORIZED','INVALID_RESPONSE']){
  const f=fixture();await f.state.read(f.data);f.primary({ok:false,error:{code}});await assert.rejects(f.state.read(f.data),(e:any)=>e.code===code);assert.equal(f.fallbackCalls,0)
  if(code!=='INVALID_RESPONSE')assert.equal(f.stored.rows.length,0)
 }
 const f=fixture();await f.state.read(f.data);f.primary(offline());f.fallback({ok:false,error:{code:'NOT_FOUND'}});await assert.rejects(f.state.read(f.data),(e:any)=>e.code==='NOT_FOUND');assert.equal(f.stored.rows.length,0)
})
test('D13 private evaluations/identity data never enter snapshots or use alternate HTTP identity',async()=>{
 const f=fixture(),data={action:'evaluation.getPublic',matchId:'match'};await f.state.read(data);assert.equal(f.stored,undefined)
 f.primary(offline());await assert.rejects(f.state.read(data));assert.equal(f.fallbackCalls,0)
})
test('D13 snapshots are isolated by all filter/cursor fields and storage failures do not fail online reads',async()=>{
 const f=fixture();await f.state.read({...f.data,category:'公告'});f.primary(offline());f.fallback(offline());await assert.rejects(f.state.read({...f.data,category:'故事'}));await assert.rejects(f.state.read({...f.data,category:'公告',cursor:'page2'}))
 const s=createPublicRecovery({...f.options,readCache:()=>{throw new Error('disabled')},writeCache:()=>{throw new Error('full')},primary:async()=>({ok:true,value:'正常'})});assert.equal((await s.read(f.data)).value,'正常')
})
test('D13 reconnection triggers registered loaders once and unsubscribe preserves disposed pages',async()=>{
 const f=fixture();let calls=0;const off=f.state.subscribe(async()=>{calls++;await f.state.read(f.data)})
 f.state.setOnline(false);assert.throws(()=>f.state.assertWritable());f.state.setOnline(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(f.state.readOnly.value,false)
 await f.state.retry();assert.equal(calls,2);off();await f.state.retry();assert.equal(calls,2)
})
test('D13 late responses cannot overwrite a newer confirmed snapshot or its source label',async()=>{
 let finish!:(value:any)=>void,calls=0,stored:any
 const f=fixture(),state=createPublicRecovery({...f.options,primary:()=>++calls===1?new Promise(resolve=>finish=resolve):Promise.resolve({ok:true,value:'新'}),writeCache:v=>stored=v})
 const old=state.read(f.data);await state.read(f.data);finish({ok:true,value:'旧'});await old;assert.equal(stored.rows[0].value.value,'新')
})
test('D13 bounded LRU retains at most 40 snapshots',async()=>{const f=fixture();for(let i=0;i<45;i++){f.advance(1);await f.state.read({...f.data,category:String(i)})}assert.equal(f.stored.rows.length,40)})
test('D13 another successful public query cannot enable writes while a stale snapshot remains displayed',async()=>{
 const f=fixture();await f.state.read(f.data);f.primary(offline());await f.state.read(f.data)
 f.primary({ok:true,value:'其他正常内容'});await f.state.read({...f.data,category:'公告'})
 assert.equal(f.state.readOnly.value,true);assert.throws(()=>f.state.assertWritable(),/只读/)
 await f.state.read(f.data);assert.equal(f.state.readOnly.value,false)
})
test('D13 explicit reconnection keeps current fallback views read-only and releases closed-view snapshot notices after a successful reload',async()=>{
 const f=fixture();await f.state.read(f.data);f.primary(offline());await f.state.read(f.data)
 const current={...f.data,category:'公告'},off=f.state.subscribe(()=>f.state.read(current))
 await f.state.retry();assert.equal(f.state.readOnly.value,true);assert.ok(f.state.notices.value.some(n=>n.key.includes('公告')))
 f.primary({ok:true,value:'已重新连接'});await f.state.retry();assert.equal(f.state.notices.value.length,0);assert.equal(f.state.readOnly.value,false);off()
})
