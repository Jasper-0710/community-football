'use strict'
const {createHash,randomBytes} = require('node:crypto')
const {userId,APP_ID} = require('./service')
const M = require('./team-badge-model')
const {validateTeamBadge,MAX_EDGE,MAX_PIXELS} = require('./team-badge-validation')
const actions = { 'badges.config':[], 'badges.start':['teamId','requestId','size','mime'], 'badges.chunk':['id','index','data'], 'badges.finish':['id'], 'badges.save':['teamId','id','expectedVersion'], 'badges.remove':['teamId','expectedVersion'] }
function fields(event,keys) { if (!event || typeof event !== 'object' || Array.isArray(event) || Object.keys(event).some(k=>!['action','userInfo','tcbContext',...keys].includes(k))) M.fail('INVALID_ARGUMENT','队徽请求包含不支持的字段。') }
function createTeamBadgeService({store,storage,context,expectedAppId=APP_ID,enabled=false,now=Date.now,logger=console}) {
  async function own(tx,uid,identity,teamId) {
    const user=await tx.get('users',uid), binding=await tx.get('leaderTeamBindings',uid)
    if (!user || user.appId!==identity.APPID || user.openId!==identity.OPENID) M.fail('AUTH_REQUIRED','请先登录个人中心。')
    const team=binding?.teamId ? await tx.get('teams',binding.teamId) : null
    if (!team || team.leaderUserId!==uid || team.schemaVersion!==1 || ![undefined,'active'].includes(team.status) || team._id!==teamId) M.fail('NOT_FOUND','只能管理本人当前球队的队徽，请重新读取球队。')
    return team
  }
  async function image(file) {
    if (file.status!=='ready' || !M.inventory(file).some(o=>o.fileID===file.fileID && M.scopedObject(file,o,storage))) M.fail('NOT_FOUND','队徽尚未完成上传。')
    const url=await storage.link(file.fileID)
    if (!M.validUrl(url)) throw new Error('Invalid badge link')
    return {ok:true,image:{id:file._id,teamId:file.teamId,size:file.size,mime:file.mime,width:file.width,height:file.height,url}}
  }
  async function readOwned(id,uid,identity) {
    return store.transaction(async tx=>{
      const file=await tx.get('teamBadges',id)
      if (!file || file.ownerUserId!==uid) M.fail('NOT_FOUND','队徽不存在或不属于本人球队。')
      await own(tx,uid,identity,file.teamId)
      if (!['uploading','ready'].includes(file.status) || !file.referenced && file.expiresAt<=now() || file.cleanupLeaseUntil>now()) M.fail('CONFLICT','本次队徽已过期，请重新选择。')
      return file
    })
  }
  async function upload(file,path,key,bytes,uid,identity) {
    const fileID=await storage.prepare(path), object={key,fileID,cloudPath:path,leaseUntil:now()+M.LEASE}
    if (!M.scopedObject(file,object,storage)) throw new Error('Invalid badge reservation')
    await store.transaction(async tx=>{
      await own(tx,uid,identity,file.teamId)
      const r=await tx.get('teamBadges',file._id)
      if (!r || r.status!=='uploading' || r.expiresAt<=now() || r.cleanupLeaseUntil>now()) M.fail('CONFLICT','队徽上传状态已变化，请重新选择。')
      const prior=(r.objects||[]).find(o=>o.key===key)
      if (prior && prior.fileID!==fileID) M.fail('CONFLICT','已上传分片不能替换内容。')
      if (!prior && (r.objects||[]).length>=32) M.fail('CONFLICT','队徽重试次数过多，请重新选择。')
      await tx.set('teamBadges',r._id,{...r,objects:[...(r.objects||[]).filter(o=>o.key!==key),object]})
    })
    if (await storage.upload(path,bytes)!==fileID) throw new Error('Badge reservation changed')
    return fileID
  }
  return async event=>{
    try {
      const identity=context()
      if (!identity?.OPENID || typeof identity.OPENID!=='string' || identity.APPID!==expectedAppId) M.fail('AUTH_REQUIRED','请在微信小程序中登录后管理队徽。')
      if (!Object.hasOwn(actions,event?.action)) M.fail('INVALID_ARGUMENT','不支持的队徽操作。')
      fields(event,actions[event.action])
      const uid=userId(identity.APPID,identity.OPENID), action=event.action
      if (action==='badges.config') {
        await store.transaction(async tx=>{const user=await tx.get('users',uid);if(!user || user.appId!==identity.APPID || user.openId!==identity.OPENID) M.fail('AUTH_REQUIRED','请先登录个人中心。')})
        return {ok:true,enabled,maxBytes:M.MAX_BYTES,chunkSize:M.CHUNK,maxEdge:MAX_EDGE,maxPixels:MAX_PIXELS}
      }
      if (!enabled) M.fail('UPLOAD_UNAVAILABLE','球队队徽上传尚未开放，请联系管理员。')
      if (action==='badges.start') {
        if (!M.TEAM_ID.test(event.teamId||'') || typeof event.requestId!=='string' || !/^[a-f0-9]{32}$/.test(event.requestId) || !Number.isSafeInteger(event.size) || event.size<1 || event.size>M.MAX_BYTES || !['image/png','image/jpeg'].includes(event.mime)) M.fail('INVALID_ARGUMENT','队徽须为不超过256KiB的JPG或PNG图片。')
        const id=`tb_${event.requestId}`
        return await store.transaction(async tx=>{
          await own(tx,uid,identity,event.teamId)
          const file=await tx.get('teamBadges',id)
          if (file) {
            if (file.ownerUserId!==uid || file.teamId!==event.teamId || file.size!==event.size || file.mime!==event.mime || !['uploading','ready'].includes(file.status) || !file.referenced && file.expiresAt<=now() || file.cleanupLeaseUntil>now()) M.fail('CONFLICT','队徽上传请求已失效，请重新选择。')
            return {ok:true,id,chunkSize:M.CHUNK,uploaded:file.chunks.flatMap((c,i)=>c?[i]:[])}
          }
          await tx.set('teamBadges',id,{_id:id,teamId:event.teamId,ownerUserId:uid,size:event.size,mime:event.mime,status:'uploading',chunks:Array(Math.ceil(event.size/M.CHUNK)).fill(null),objects:[],referenced:false,createdAt:now(),updatedAt:now(),expiresAt:now()+M.TTL})
          return {ok:true,id,chunkSize:M.CHUNK,uploaded:[]}
        })
      }
      if (action==='badges.save' || action==='badges.remove') {
        if (!M.TEAM_ID.test(event.teamId||'') || !Number.isSafeInteger(event.expectedVersion) || event.expectedVersion<1 || action==='badges.save' && !M.BADGE_ID.test(event.id||'')) M.fail('INVALID_ARGUMENT','队徽或球队版本无效，请重新读取。')
        return await store.transaction(async tx=>{
          const team=await own(tx,uid,identity,event.teamId), id=action==='badges.save'?event.id:''
          // Retrying an already committed request cannot overwrite a later team edit.
          if (team.lastBadgeRequest?.expectedVersion===event.expectedVersion && team.lastBadgeRequest.id===id && (team.badgeId||'')===id) return {ok:true,teamId:team._id,version:team.version}
          if (team.version!==event.expectedVersion) M.fail('CONFLICT','球队已在其他页面更新，请重新读取后再保存队徽。')
          const next=id?await tx.get('teamBadges',id):null
          if (id && (!next || next.teamId!==team._id || next.ownerUserId!==uid || next.status!=='ready' || !next.referenced && next.expiresAt<=now() || next.cleanupLeaseUntil>now() || !M.inventory(next).some(o=>o.fileID===next.fileID && M.scopedObject(next,o,storage)))) M.fail('INVALID_ARGUMENT','队徽尚未完成、已过期或不属于当前球队。')
          const previous=team.badgeId && team.badgeId!==id?await tx.get('teamBadges',team.badgeId):null
          if (previous && previous.teamId===team._id) await tx.set('teamBadges',previous._id,{...previous,referenced:false,expiresAt:now()+M.TTL,updatedAt:now()})
          if (next) await tx.set('teamBadges',next._id,{...next,referenced:true,expiresAt:null,updatedAt:now()})
          await tx.set('teams',team._id,{...team,badgeId:id,badgeFileId:next?.fileID||'',lastBadgeRequest:{id,expectedVersion:event.expectedVersion},version:team.version+1,updatedAt:new Date(now()).toISOString()})
          return {ok:true,teamId:team._id,version:team.version+1}
        })
      }
      if (typeof event.id!=='string' || !M.BADGE_ID.test(event.id)) M.fail('NOT_FOUND','队徽不存在。')
      const file=await readOwned(event.id,uid,identity)
      if (action==='badges.chunk') {
        const i=event.index,data=event.data
        if (!Number.isSafeInteger(i) || i<0 || i>=file.chunks.length || typeof data!=='string' || data.length>Math.ceil(M.CHUNK/3)*4 || !/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) M.fail('INVALID_ARGUMENT','队徽分片无效。')
        const bytes=Buffer.from(data,'base64'), hash=createHash('sha256').update(bytes).digest('hex')
        if (bytes.length!==Math.min(M.CHUNK,file.size-i*M.CHUNK) || bytes.toString('base64')!==data) M.fail('INVALID_ARGUMENT','队徽分片大小不匹配。')
        if (file.chunks[i]) {if(file.chunks[i].hash!==hash)M.fail('CONFLICT','已上传分片不能替换内容。');return {ok:true,index:i}}
        const fileID=await upload(file,`team-badges/staging/${file.teamId}/${file._id}/${i}-${hash}`,`chunk-${i}`,bytes,uid,identity)
        await store.transaction(async tx=>{
          await own(tx,uid,identity,file.teamId)
          const r=await tx.get('teamBadges',file._id)
          if(r.status!=='uploading' || r.expiresAt<=now())M.fail('CONFLICT','队徽上传状态已变化。')
          if(r.chunks[i] && r.chunks[i].hash!==hash)M.fail('CONFLICT','已上传分片不能替换内容。')
          const chunks=[...r.chunks];chunks[i]={fileID,hash,size:bytes.length}
          await tx.set('teamBadges',r._id,{...r,chunks,updatedAt:now()})
        })
        return {ok:true,index:i}
      }
      if (file.status==='ready') return await image(file)
      if (file.chunks.some(c=>!c)) M.fail('CONFLICT','队徽尚未上传完整，请重试。')
      const parts=[]
      for(const chunk of file.chunks){
        if(!M.inventory(file).some(o=>o.fileID===chunk.fileID && M.scopedObject(file,o,storage)))throw new Error('Invalid staging scope')
        const bytes=await storage.download(chunk.fileID)
        if(bytes.length!==chunk.size || createHash('sha256').update(bytes).digest('hex')!==chunk.hash)M.fail('INVALID_ARGUMENT','队徽校验失败，请重新选择。')
        parts.push(bytes)
      }
      const bytes=Buffer.concat(parts)
      if(bytes.length!==file.size)M.fail('INVALID_ARGUMENT','队徽大小不匹配。')
      const dimensions=validateTeamBadge(bytes,file.mime), key=randomBytes(24).toString('hex')
      let fileID
      try{fileID=await upload(file,`team-badges/files/${file.teamId}/${file._id}/${key}.${file.mime==='image/png'?'png':'jpg'}`,`final-${key}`,bytes,uid,identity)}
      catch(e){if(e.code==='CONFLICT'){const ready=await readOwned(file._id,uid,identity);if(ready.status==='ready')return await image(ready)}throw e}
      const ready=await store.transaction(async tx=>{
        await own(tx,uid,identity,file.teamId)
        const r=await tx.get('teamBadges',file._id)
        if(r.status==='ready')return r
        if(r.status!=='uploading' || r.expiresAt<=now())M.fail('CONFLICT','队徽上传已过期。')
        const next={...r,...dimensions,fileID,sha256:createHash('sha256').update(bytes).digest('hex'),status:'ready',updatedAt:now()}
        await tx.set('teamBadges',r._id,next);return next
      })
      return await image(ready)
    }catch(error){
      if(error instanceof M.TeamBadgeError)return {ok:false,error:{code:error.code,message:error.message}}
      logger?.error?.('[teamBadges] operation failed')
      return {ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'队徽服务暂不可用，请重试。已上传的分片会保留；保存结果请重新读取确认。'}}
    }
  }
}
module.exports={createTeamBadgeService}
