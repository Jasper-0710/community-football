import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createPublicCache,pathFor,query,TTL}=require('../cloudfunctions/adminAuth/public-cache')
const {createPublicReadService}=require('../cloudfunctions/publicRead/service')
test('D13 independent public function serves only fresh successful public reads with the exact filters',async()=>{
 let now=1000000;const files=new Map<string,Buffer>(),storage={async upload(path:string,value:Buffer){files.set(path,Buffer.from(value))},async download(path:string){if(!files.has(path))throw new Error('Missing');return files.get(path)!}}
 const publish=createPublicCache({storage,environment:'customer',enabled:true,now:()=>now}),read=createPublicReadService({storage,environment:'customer',now:()=>now,logger:{error(){}}}),data={action:'news.listPublic',category:'公告'}
 const result={ok:true,articles:[],total:0,nextCursor:null};assert.deepEqual(await publish(data,async()=>result),result)
 const fallback=await read(data);assert.equal(fallback.ok,true);assert.deepEqual(fallback.recovery,{source:'fallback',savedAt:now,expiresAt:now+TTL})
 assert.equal((await read({...data,category:'故事'})).error.code,'SERVICE_UNAVAILABLE')
 for(const action of ['evaluation.getPublic','evaluation.rate','login','backup.create','registrations.fileLink'])assert.equal((await read({action})).error.code,'INVALID_ARGUMENT')
 assert.equal((await read({...data,token:'private'})).error.code,'INVALID_ARGUMENT')
 const wrongEnvironment=createPublicReadService({storage,environment:'other',now:()=>now,logger:{error(){}}});assert.equal((await wrongEnvironment(data)).error.code,'SERVICE_UNAVAILABLE')
 now+=TTL+1;assert.equal((await read(data)).error.code,'SERVICE_UNAVAILABLE')
})
test('D13 public cache excludes trusted identity metadata and private/failed operations; publication failure leaves online reading usable',async()=>{
 const writes:any[]=[],storage={async upload(path:string,data:any){writes.push({path,data})}},publish=createPublicCache({storage,environment:'customer',enabled:true})
 const data={action:'news.listPublic'}
 await publish({...data,userInfo:{openId:'private'},tcbContext:{token:'private'}},async()=>({ok:true,articles:[]}));assert.equal(writes.length,1);assert.equal(writes[0].data.toString().includes('private'),false)
 for(const event of [{action:'evaluation.getPublic'},{...data,token:'private'}])await publish(event,async()=>({ok:true}));await publish(data,async()=>({ok:false,error:{code:'NOT_FOUND'}}));assert.equal(writes.length,1)
 const broken=createPublicCache({storage:{async upload(){throw new Error('Network')}},enabled:true,logger:{error(){}}});assert.deepEqual(await broken(data,async()=>({ok:true,value:'online'})),{ok:true,value:'online'})
 const disabled=createPublicCache({storage,enabled:false});await disabled(data,async()=>({ok:true}));assert.equal(writes.length,1)
 assert.equal(pathFor(query({category:'公告',action:'news.listPublic'})),pathFor(query({action:'news.listPublic',category:'公告'})))
})
test('D13 public deployment copies stay in sync with the primary protocol and HTTP boundary',()=>{for(const file of ['public-cache.js','http.js'])assert.equal(fs.readFileSync(`cloudfunctions/publicRead/${file}`,'utf8'),fs.readFileSync(`cloudfunctions/adminAuth/${file}`,'utf8'))})
