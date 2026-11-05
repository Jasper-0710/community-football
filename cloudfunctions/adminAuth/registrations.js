'use strict'
const M=require('./registration-model')
const actions={'registrations.listAdmin':['competitionId','cursor','status'],'registrations.getAdmin':['id'],'registrations.review':['id','expectedVersion','requestId','decision','reason','playerCount'],'registrations.fileLink':['id','fileId']}
function createAdminRegistrationService({store,authorize,storage,uploadsEnabled=false,now=Date.now,logger=console}){
 return async event=>{try{
  const auth=await authorize(event?.token);if(!auth.ok)return auth
  const action=event?.action
  if(!Object.hasOwn(actions,action))M.fail('INVALID_ARGUMENT','不支持的报名管理操作。')
  M.fields(event,['action','token','userInfo','tcbContext',...actions[action]])
  if(action==='registrations.listAdmin'){
   if(!M.CID.test(event.competitionId)||(event.cursor!=null&&!M.RID.test(event.cursor))||(event.status!=null&&!['pending','approved','rejected','cancelled'].includes(event.status)))M.fail('INVALID_ARGUMENT','请重新选择赛事并刷新名单。')
   const c=await store.competition(event.competitionId);if(!c)M.fail('NOT_FOUND','赛事不存在。')
   const rows=await store.list({competitionId:c._id,cursor:event.cursor||null,status:event.status||null,limit:21})
   if(rows.some(r=>r.competitionId!==c._id||(event.status&&r.status!==event.status)))throw new Error('Mismatched list')
   return {ok:true,registrations:rows.slice(0,20).map(M.summary),nextCursor:rows.length>20?rows[19]._id:null,stats:M.stats(c)}
  }
  if(!M.RID.test(event.id))M.fail('NOT_FOUND','报名记录不存在。')
  if(action==='registrations.review'){
   if(!M.REQUEST.test(event.requestId)||!Number.isSafeInteger(event.expectedVersion)||event.expectedVersion<1||!['approved','rejected'].includes(event.decision))M.fail('INVALID_ARGUMENT','审核请求无效，请重新读取报名。')
   let reason='',count=null
   if(event.decision==='rejected')reason=M.text(event.reason,'驳回原因',500)
   else {if(typeof event.reason!=='string'||event.reason.trim()||!Number.isSafeInteger(event.playerCount))M.fail('INVALID_ARGUMENT','请核对材料并填写参赛人数。');count=event.playerCount}
   const hash=M.fingerprint({id:event.id,version:event.expectedVersion,decision:event.decision,reason,count})
   return await store.transaction(async tx=>{
    const r=await tx.get('registrations',event.id);if(!r)M.fail('NOT_FOUND','报名记录不存在。')
    if(r.lastReviewRequest?.id===event.requestId){if(r.lastReviewRequest.hash!==hash)M.fail('CONFLICT','该审核请求已处理，请刷新。');return {ok:true,registration:M.detail(r)}}
    if(r.version!==event.expectedVersion||r.status!=='pending')M.fail('CONFLICT','报名内容或审核状态已变化，请重新读取后审核。')
    if(count!==null&&(count<r.competitionSnapshot.minPlayers||count>r.competitionSnapshot.maxPlayers))M.fail('INVALID_ARGUMENT',`参赛人数须为${r.competitionSnapshot.minPlayers}–${r.competitionSnapshot.maxPlayers}人。请核对材料，或填写原因驳回。`)
    const c=await tx.get('competitions',r.competitionId);if(!c)throw new Error('Missing competition')
    const time=new Date(now()).toISOString(),updated={...r,status:event.decision,version:r.version+1,updatedAt:time,review:{decision:event.decision,reason,playerCount:count,reviewedAt:time,reviewedBy:auth.admin?.username||'admin'},lastReviewRequest:{id:event.requestId,hash},history:M.history(r,event.decision,'admin',time,reason)}
    await tx.set('competitions',c._id,M.transition(c,r.status,updated.status));await tx.set('registrations',r._id,updated)
    return {ok:true,registration:M.detail(updated)}
   })
  }
  const r=await store.read(event.id);if(!r)M.fail('NOT_FOUND','报名记录不存在。')
  if(action==='registrations.fileLink'){
   const f=r.attachments.find(f=>f.id===event.fileId);if(!f)M.fail('NOT_FOUND','附件不存在。')
   if(!uploadsEnabled)M.fail('UPLOAD_UNAVAILABLE','材料下载暂不可用，请联系平台维护人员。')
   return {ok:true,url:await storage.link(f.fileID),name:f.name,extension:f.extension}
  }
  return {ok:true,registration:M.detail(r)}
 }catch(error){return M.errorResult(error,logger)}}
}
module.exports={createAdminRegistrationService}
