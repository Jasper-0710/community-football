'use strict'
const {randomBytes,createHash}=require('node:crypto')
const FileType=require('file-type')
const {APP_ID,userId}=require('./service')
const M=require('./registration-model')
const MAX_FILE=10*1024*1024,CHUNK=192*1024,TTL=24*60*60*1000
const EXTENSIONS=['pdf','png','jpg','jpeg','docx','xlsx']
function metadata(name,size){name=M.text(name,'附件文件名',120);if(/[\\/<>:|?*]/.test(name)||!Number.isSafeInteger(size)||size<1||size>MAX_FILE)M.fail('INVALID_ARGUMENT','附件须为1字节至10MB，文件名不能包含路径字符。');const extension=name.split('.').pop().toLowerCase();if(!EXTENSIONS.includes(extension))M.fail('INVALID_ARGUMENT','请上传 PDF、JPG、PNG、DOCX 或 XLSX 文件。');return {name,size,extension}}
function fileResult(f){return {ok:true,file:M.fileView(f)}}
async function validateFile(bytes,extension){
 // Only dispatch the six supported formats to the detector. In particular,
 // unsupported ASF input must never reach the legacy SDK-compatible parser.
 const signature=extension==='pdf'?bytes.subarray(0,5).equals(Buffer.from('%PDF-')):extension==='png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):['jpg','jpeg'].includes(extension)?bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')):['docx','xlsx'].includes(extension)&&bytes.subarray(0,4).equals(Buffer.from('504b0304','hex'))
 if(!signature)M.fail('INVALID_ATTACHMENT','文件内容与格式不符，请更换有效材料。')
 let detected
 try{detected=await FileType.fromBuffer(bytes)}catch{M.fail('INVALID_ATTACHMENT','文件格式不完整，请重新选择材料。')}
 if(!detected||detected.ext!==(extension==='jpeg'?'jpg':extension))M.fail('INVALID_ATTACHMENT','文件内容与格式不符，请更换有效材料。')
 if(extension==='pdf'&&!bytes.subarray(Math.max(0,bytes.length-1024)).includes(Buffer.from('%%EOF')))M.fail('INVALID_ATTACHMENT','PDF 文件不完整。')
 if(['docx','xlsx'].includes(extension)&&(/vbaProject\.bin/i.test(bytes.toString('latin1'))))M.fail('INVALID_ATTACHMENT','请上传不含宏的 Word 或 Excel 文件。')
}
function createRegistrationFileService({store,storage,context,enabled=false,expectedAppId=APP_ID,now=Date.now,logger=console}){
 async function remove(ids){if(ids.length)try{await storage.remove(ids)}catch{logger?.error?.('[registrationFiles] temporary cleanup pending')}}
 const actions={'files.start':['competitionId','requestId','name','size'],'files.chunk':['id','index','data'],'files.finish':['id'],'files.discard':['id']}
 return async event=>{try{
  const x=context();if(typeof x?.OPENID!=='string'||!x.OPENID||x.APPID!==expectedAppId)M.fail('AUTH_REQUIRED','请先登录后上传材料。')
  const uid=userId(x.APPID,x.OPENID),action=event?.action
  if(!Object.hasOwn(actions,action))M.fail('INVALID_ARGUMENT','不支持的附件操作。')
  M.fields(event,['action','userInfo','tcbContext',...actions[action]])
  if(!enabled)M.fail('UPLOAD_UNAVAILABLE','报名材料上传暂未开放，请稍后再试。')
  const user=await store.transaction(tx=>tx.get('users',uid));if(!user||user.appId!==x.APPID||user.openId!==x.OPENID)M.fail('AUTH_REQUIRED','请先登录个人中心。')
  if(action==='files.start'){
   if(!M.CID.test(event.competitionId)||!M.REQUEST.test(event.requestId))M.fail('INVALID_ARGUMENT','上传请求无效，请重新选择文件。')
   const meta=metadata(event.name,event.size),id='f_'+createHash('sha256').update(`${uid}:${event.requestId}`).digest('hex').slice(0,32)
   return await store.transaction(async tx=>{
    const c=await tx.get('competitions',event.competitionId)
    const binding=await tx.get('leaderTeamBindings',uid),r=binding?.teamId?await tx.get('registrations',M.registrationId(event.competitionId,binding.teamId)):null
    if(r&&r.ownerUserId===uid&&M.occupied(r.status)){M.beforeDeadline(c,now());if(!c?.displayEnabled)M.fail('NOT_FOUND','赛事暂未公开。')}else M.open(c,now())
    const existing=await tx.get('registrationFiles',id)
    if(existing){if(existing.ownerUserId!==uid||existing.competitionId!==c._id||existing.name!==meta.name||existing.size!==meta.size||existing.expiresAt<=now()||existing.status==='discarded')M.fail('CONFLICT','本次上传已失效，请重新选择文件。');return {ok:true,id,chunkSize:CHUNK,uploaded:existing.chunks.map((c,i)=>c?i:-1).filter(i=>i>=0)}}
    // Bound unfinished uploads per account without trusting a client-side counter.
    const current=await tx.get('users',uid),active=(current.registrationUploadSlots||[]).filter(s=>s.expiresAt>now())
    if(active.length>=10)M.fail('UPLOAD_LIMIT','未提交的材料较多，请移除不用的附件后重试，或在24小时后再试。')
    const expiresAt=now()+TTL
    await tx.set('registrationFiles',id,{_id:id,...meta,ownerUserId:uid,competitionId:c._id,status:'uploading',chunks:Array(Math.ceil(meta.size/CHUNK)).fill(null),expiresAt,createdAt:now()})
    await tx.set('users',uid,{...current,registrationUploadSlots:[...active,{id,expiresAt}]})
    return {ok:true,id,chunkSize:CHUNK,uploaded:[]}
   })
  }
  if(!M.FID.test(event.id))M.fail('NOT_FOUND','附件不存在。')
  const f=await store.transaction(tx=>tx.get('registrationFiles',event.id));if(!f||f.ownerUserId!==uid)M.fail('NOT_FOUND','附件不存在。')
  if(action==='files.discard'){
   await store.transaction(async tx=>{const r=await tx.get('registrationFiles',f._id);if(r.registrationId)M.fail('CONFLICT','已提交的材料保留为报名记录，不能直接删除。');await tx.set('registrationFiles',r._id,{...r,status:'discarded'});const u=await tx.get('users',uid);await tx.set('users',uid,{...u,registrationUploadSlots:(u.registrationUploadSlots||[]).filter(s=>s.id!==r._id)})})
   await remove([...(f.chunks||[]).filter(Boolean).map(c=>c.fileID),...(f.fileID?[f.fileID]:[])])
   return {ok:true,discarded:true}
  }
  if(f.status==='discarded'||(!f.registrationId&&f.expiresAt<=now()))M.fail('INVALID_ATTACHMENT','上传已过期，请重新选择文件。')
  if(action==='files.chunk'){
   if(f.status!=='uploading')M.fail('CONFLICT','该附件已完成上传。')
   const i=event.index,expected=i===f.chunks.length-1?f.size-i*CHUNK:CHUNK
   if(!Number.isSafeInteger(i)||i<0||i>=f.chunks.length||typeof event.data!=='string'||event.data.length>Math.ceil(CHUNK/3)*4||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.data))M.fail('INVALID_ARGUMENT','附件传输内容无效。')
   const bytes=Buffer.from(event.data,'base64');if(bytes.length!==expected||bytes.toString('base64')!==event.data)M.fail('INVALID_ARGUMENT','附件大小不匹配，请重新上传。')
   const hash=createHash('sha256').update(bytes).digest('hex')
   if(f.chunks[i]){if(f.chunks[i].hash!==hash)M.fail('CONFLICT','已传输内容不能替换，请重新选择文件。');return {ok:true,index:i}}
   // Content-addressed chunks can only ever be overwritten by identical bytes.
   const fileID=await storage.upload(`registration-staging/${uid}/${f._id}/${i}-${hash}`,bytes)
   try{await store.transaction(async tx=>{const r=await tx.get('registrationFiles',f._id);if(r.status!=='uploading'||r.expiresAt<=now())M.fail('CONFLICT','上传状态已变化，请重新读取。');if(r.chunks[i]&&r.chunks[i].hash!==hash)M.fail('CONFLICT','该部分已上传不同内容。');const chunks=[...r.chunks];chunks[i]={fileID,hash,size:bytes.length};await tx.set('registrationFiles',r._id,{...r,chunks})})}catch(error){/* A transport failure may occur after commit; leave this bounded staging object for cleanup. */throw error}
   return {ok:true,index:i}
  }
  if(f.status==='ready')return fileResult(f)
  if(f.chunks.some(c=>!c))M.fail('UPLOAD_INCOMPLETE','附件尚未上传完整，请重试。')
  const buffers=[]
  for(let i=0;i<f.chunks.length;i+=3){const batch=await Promise.all(f.chunks.slice(i,i+3).map(async c=>{const b=await storage.download(c.fileID);if(b.length!==c.size||createHash('sha256').update(b).digest('hex')!==c.hash)M.fail('INVALID_ATTACHMENT','上传内容校验失败，请重新选择文件。');return b}));buffers.push(...batch)}
  const bytes=Buffer.concat(buffers);if(bytes.length!==f.size)M.fail('INVALID_ATTACHMENT','附件大小不匹配。');await validateFile(bytes,f.extension)
  // Final paths are generated by the server and are never exposed as upload targets.
  const finalID=await storage.upload(`registration-materials/${randomBytes(24).toString('hex')}.${f.extension}`,bytes)
  let committed
  try{committed=await store.transaction(async tx=>{const r=await tx.get('registrationFiles',f._id);if(r.status==='ready')return r;if(r.status!=='uploading'||r.expiresAt<=now())M.fail('CONFLICT','上传已失效，请重新选择文件。');const ready={...r,status:'ready',fileID:finalID,sha256:createHash('sha256').update(bytes).digest('hex')};await tx.set('registrationFiles',r._id,ready);return ready})}catch(error){/* Keep the final object if commit outcome is unknown; cleanup reconciles the registry. */throw error}
  if(committed.fileID!==finalID)await remove([finalID])
  await remove(f.chunks.map(c=>c.fileID))
  return fileResult(committed)
 }catch(error){return M.errorResult(error,logger)}}
}
module.exports={createRegistrationFileService,validateFile,metadata,MAX_FILE,CHUNK,EXTENSIONS}
