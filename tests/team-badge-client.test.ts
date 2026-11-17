import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { buildSync } from 'esbuild'

// Exercise the real native preparation/upload client with isolated uni APIs.
// This validates SDK wiring and failure behavior, not a physical WeChat device.
const compiled = buildSync({entryPoints:['src/services/team-badges.ts'],bundle:true,write:false,platform:'node',format:'cjs',external:['./wechat-cloud']}).outputFiles[0].text
const png = () => Uint8Array.from([137,80,78,71,13,10,26,10,...Array(16).fill(0)])
const hasCode = (code:string) => (error:any) => error?.code===code
function fixture(overrides:Record<string,unknown>={},call: (data:any)=>Promise<any> = async()=>({ok:true})) {
  const requests:any[]=[], module={exports:{} as any}
  const uni={
    chooseImage:({success}:any)=>success({tempFilePaths:['original.png']}),
    getFileInfo:({success}:any)=>success({size:24}),
    getImageInfo:({success}:any)=>success({type:'png',width:64,height:64}),
    getFileSystemManager:()=>({readFile:({success}:any)=>success({data:png().buffer})}),
    arrayBufferToBase64:(bytes:ArrayBuffer)=>Buffer.from(bytes).toString('base64'),
    ...overrides,
  }
  vm.runInNewContext(compiled,{module,exports:module.exports,ArrayBuffer,Uint8Array,console,uni,require:(name:string)=>{
    assert.equal(name,'./wechat-cloud')
    return {callWechatCloudFunction:async(name:string,data:any)=>{assert.equal(name,'teamManagement');requests.push(data);return call(data)}}
  }})
  return {...module.exports,requests}
}
test('native badge picker cancellation is silent and never reads or uploads a file',async()=>{
  const f=fixture({chooseImage:({fail}:any)=>fail({errMsg:'chooseImage:fail cancel'}),getFileInfo:()=>assert.fail('cancel must not read')})
  assert.equal(await f.chooseTeamBadge(),null)
  assert.equal(f.requests.length,0)
})
test('native preparation compresses large images within bounds and reads the resulting file',async()=>{
  const compressions:any[]=[],reads:string[]=[]
  const f=fixture({
    getImageInfo:({success}:any)=>success({type:'jpeg',width:2400,height:1200}),
    getFileInfo:({filePath,success}:any)=>success({size:filePath==='original.jpg'?1_000_000:filePath==='pass-1'?300_000:24}),
    compressImage:(options:any)=>{compressions.push(options);options.success({tempFilePath:'pass-'+compressions.length})},
    getFileSystemManager:()=>({readFile:({filePath,success}:any)=>{reads.push(filePath);success({data:png().buffer})}}),
  })
  const draft=await f.prepareTeamBadge('original.jpg')
  assert.equal(draft.path,'pass-2');assert.equal(draft.mime,'image/png')
  assert.deepEqual(compressions.map(({src,compressedWidth,compressedHeight}:any)=>[src,compressedWidth,compressedHeight]),[['original.jpg',512,256],['original.jpg',384,192]])
  assert.deepEqual(reads,['pass-2']);assert.equal(f.requests.length,0)
})
test('invalid native image metadata, unreadable bytes and oversized output fail before upload',async()=>{
  for(const overrides of [
    {getFileInfo:({success}:any)=>success({size:10*1024*1024+1})},
    {getImageInfo:({success}:any)=>success({type:'gif',width:10,height:10})},
    {getImageInfo:({success}:any)=>success({width:10,height:10})},
    {getImageInfo:({success}:any)=>success({type:'png',width:0,height:10})},
  ]){
    const f=fixture(overrides);await assert.rejects(f.prepareTeamBadge('image'),hasCode('INVALID_ARGUMENT'));assert.equal(f.requests.length,0)
  }
  const unreadable=fixture({getFileSystemManager:()=>({readFile:({success}:any)=>success({data:'base64-text'})})})
  await assert.rejects(unreadable.prepareTeamBadge('image'),hasCode('READ_FAILED'))
  let attempts=0
  const huge=fixture({getFileInfo:({success}:any)=>success({size:500_000}),compressImage:({success}:any)=>{attempts++;success({tempFilePath:'large'})}})
  await assert.rejects(huge.prepareTeamBadge('image'),hasCode('INVALID_ARGUMENT'));assert.equal(attempts,3)
})
test('native upload ignores a late chunk result after navigation and validates returned ownership before save',async()=>{
  const teamId='t_'+'a'.repeat(64)
  let current=true
  const f=fixture({},async data=>{
    if(data.action==='badges.start')return {ok:true,id:'tb_'+data.requestId,chunkSize:65536,uploaded:[]}
    if(data.action==='badges.chunk'){current=false;return {ok:true,index:data.index}}
    assert.fail('navigation must stop before finish/save')
  })
  await assert.rejects(f.uploadTeamBadge(teamId,f.createBadgeDraft(png(),'local'),()=>current),hasCode('CANCELLED'))
  assert.equal(f.requests.length,2)
  const foreign=fixture({},async data=>data.action==='badges.start'?{ok:true,id:'tb_'+data.requestId,chunkSize:65536,uploaded:[0]}:{ok:true,image:{id:data.id,teamId:'t_'+'b'.repeat(64),mime:'image/png',size:24,width:1,height:1,url:'https://image.example/badge.png'}})
  await assert.rejects(foreign.uploadTeamBadge(teamId,foreign.createBadgeDraft(png(),'local')),hasCode('INVALID_RESPONSE'))
  assert.equal(foreign.requests.some((r:any)=>r.action==='badges.save'),false)
})
test('native upload and public team projection accept signed HTTPS links without a browser URL global',async()=>{
  const teamId='t_'+'a'.repeat(64),url='https://bucket.example.test/badge.png?sign=abc%2F123'
  const f=fixture({},async data=>data.action==='badges.start'?{ok:true,id:'tb_'+data.requestId,chunkSize:65536,uploaded:[0]}:{ok:true,image:{id:data.id,teamId,mime:'image/png',size:24,width:1,height:1,url}})
  const draft=f.createBadgeDraft(png(),'local')
  assert.equal((await f.uploadTeamBadge(teamId,draft)).url,url)
  assert.equal(draft.progress,100)
  const compiled=buildSync({entryPoints:['src/domain/content.ts'],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text
  const module={exports:{} as any};vm.runInNewContext(compiled,{module,exports:module.exports})
  const team={id:teamId,name:'公开球队',district:'徐汇区',description:'',players:[],hasBadge:true,badgeUrl:url}
  assert.equal(module.exports.parsePublicTeam(team).badgeUrl,url)
  for(const badgeUrl of ['http://example.test/a','https://user:secret@example.test/a','https://example.test/a#fragment','https://example.test:99999/a','https://example.test\\@other.test/a','https://-host.test/a'])assert.throws(()=>module.exports.parsePublicTeam({...team,badgeUrl}))
})
