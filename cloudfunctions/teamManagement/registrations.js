'use strict'
const {APP_ID,userId,DISTRICTS}=require('./service')
const M=require('./registration-model')
const actions={
 'registrations.listMine':['cursor'],'registrations.getMine':['id'],'registrations.prepare':['competitionId'],
 'registrations.submit':['competitionId','expectedVersion','rulesVersion','requestId','form','attachmentIds'],
 'registrations.cancel':['id','expectedVersion','requestId'], 'registrations.fileLink':['id','fileId'],
}
function createRegistrationService({store,context,storage,uploadsEnabled=false,expectedAppId=APP_ID,now=Date.now,logger=console}){
 async function identity(){const x=context();if(typeof x?.OPENID!=='string'||!x.OPENID||x.APPID!==expectedAppId)M.fail('AUTH_REQUIRED','请在微信小程序中登录后报名。');const uid=userId(x.APPID,x.OPENID);const u=await store.transaction(tx=>tx.get('users',uid));if(!u||u.appId!==x.APPID||u.openId!==x.OPENID)M.fail('AUTH_REQUIRED','请先登录个人中心。');return uid}
 async function ownTeam(tx,uid){const binding=await tx.get('leaderTeamBindings',uid);if(!binding?.teamId)return null;const team=await tx.get('teams',binding.teamId);if(!team||team.leaderUserId!==uid||![undefined,'active'].includes(team.status))M.fail('TEAM_REQUIRED','请先创建自己的球队。');return team}
 return async event=>{try{
  const uid=await identity(),action=event?.action
  if(!Object.hasOwn(actions,action))M.fail('INVALID_ARGUMENT','不支持的报名操作。')
  M.fields(event,['action','userInfo','tcbContext',...actions[action]])
  if(action==='registrations.listMine'){
   if(event.cursor!=null&&!M.RID.test(event.cursor))M.fail('INVALID_ARGUMENT','分页位置无效，请刷新报名记录。')
   const records=await store.list({ownerUserId:uid,cursor:event.cursor||null,limit:21})
   if(records.some(r=>r.ownerUserId!==uid))throw new Error('Unexpected registration owner')
   return {ok:true,registrations:records.slice(0,20).map(M.summary),nextCursor:records.length>20?records[19]._id:null}
  }
  if(['registrations.getMine','registrations.fileLink'].includes(action)){
   if(!M.RID.test(event.id))M.fail('NOT_FOUND','报名记录不存在。')
   const r=await store.read(event.id);if(!r||r.ownerUserId!==uid)M.fail('NOT_FOUND','报名记录不存在。')
   if(action==='registrations.fileLink'){
    const file=r.attachments.find(f=>f.id===event.fileId);if(!file)M.fail('NOT_FOUND','附件不存在。')
    if(!uploadsEnabled)M.fail('UPLOAD_UNAVAILABLE','材料查看暂不可用，请稍后再试。')
    return {ok:true,url:await storage.link(file.fileID),name:file.name,extension:file.extension}
   }
   const c=await store.competition(r.competitionId)
   return {ok:true,registration:M.detail(r),locked:!c?.registrationEndAt||now()>=Date.parse(c.registrationEndAt),deadline:c?.registrationEndAt||null}
  }
  if(action==='registrations.prepare'){
   if(!M.CID.test(event.competitionId))M.fail('NOT_FOUND','赛事不存在或暂未公开。')
   return await store.transaction(async tx=>{
    const c=await tx.get('competitions',event.competitionId);if(!c||!c.displayEnabled)M.fail('NOT_FOUND','赛事不存在或暂未公开。')
    const team=await ownTeam(tx,uid),r=team?await tx.get('registrations',M.registrationId(c._id,team._id)):null
    if(r&&r.ownerUserId!==uid)throw new Error('Unexpected owner')
    return {ok:true,team:team?{id:team._id,name:team.name,district:team.district,contactPhone:team.contactPhone}:null,registration:r?M.detail(r):null,uploadsEnabled,
     competition:{id:c._id,name:c.name,registrationEnabled:c.registrationEnabled,registrationStartAt:c.registrationStartAt,registrationEndAt:c.registrationEndAt,registrationConfig:c.registrationConfig||null,rulesVersion:c.registrationRulesVersion||1,registrationStats:M.stats(c)},serverTime:new Date(now()).toISOString()}
   })
  }
  if(!M.REQUEST.test(event.requestId)||!Number.isSafeInteger(event.expectedVersion)||event.expectedVersion<0)M.fail('INVALID_ARGUMENT','请求标识无效，请重新读取后操作。')
  if(action==='registrations.cancel'){
   if(!M.RID.test(event.id))M.fail('NOT_FOUND','报名记录不存在。')
   const hash=M.fingerprint({action,id:event.id,version:event.expectedVersion})
   return await store.transaction(async tx=>{
    const r=await tx.get('registrations',event.id);if(!r||r.ownerUserId!==uid)M.fail('NOT_FOUND','报名记录不存在。')
    if(r.lastOwnerRequest?.id===event.requestId){if(r.lastOwnerRequest.hash!==hash)M.fail('CONFLICT','请重新读取报名记录。');return {ok:true,registration:M.detail(r)}}
    if(r.version!==event.expectedVersion)M.fail('CONFLICT','报名记录已更新，请重新读取后操作。')
    const c=await tx.get('competitions',r.competitionId);M.beforeDeadline(c,now())
    if(r.status==='cancelled')M.fail('CONFLICT','该报名已撤销，请重新读取。')
    const updated={...r,status:'cancelled',version:r.version+1,updatedAt:new Date(now()).toISOString(),lastOwnerRequest:{id:event.requestId,hash},history:M.history(r,'cancelled','leader',new Date(now()).toISOString())}
    await tx.set('competitions',c._id,M.transition(c,r.status,'cancelled'));await tx.set('registrations',r._id,updated)
    return {ok:true,registration:M.detail(updated)}
   })
  }
  if(!M.CID.test(event.competitionId))M.fail('NOT_FOUND','赛事不存在或暂未公开。')
  M.fields(event.form,['teamName','district','project','leaderName','contactPhone'])
  const form={teamName:M.text(event.form.teamName,'球队名',40),district:event.form.district,project:M.text(event.form.project,'报名项目',40),leaderName:M.text(event.form.leaderName,'领队姓名',30),contactPhone:M.text(event.form.contactPhone,'联系方式',30)}
  if(!DISTRICTS.includes(form.district)||!/^\+?[0-9][0-9 ()-]{5,29}$/.test(form.contactPhone)||form.contactPhone.replace(/\D/g,'').length<7)M.fail('INVALID_ARGUMENT','请选择上海所属区并填写有效联系电话。')
  if(!Array.isArray(event.attachmentIds)||event.attachmentIds.length<1||event.attachmentIds.length>5||event.attachmentIds.some(id=>typeof id!=='string'||!M.FID.test(id))||new Set(event.attachmentIds).size!==event.attachmentIds.length)M.fail('INVALID_ARGUMENT','请上传1–5份报名材料。')
  const hash=M.fingerprint({action,competitionId:event.competitionId,expectedVersion:event.expectedVersion,rulesVersion:event.rulesVersion,form,attachmentIds:event.attachmentIds})
  return await store.transaction(async tx=>{
   const team=await ownTeam(tx,uid);if(!team)M.fail('TEAM_REQUIRED','请先创建自己的球队，再提交报名。')
   const id=M.registrationId(event.competitionId,team._id),r=await tx.get('registrations',id)
   if(r&&r.ownerUserId!==uid)throw new Error('Unexpected owner')
   if(r?.lastOwnerRequest?.id===event.requestId){if(r.lastOwnerRequest.hash!==hash)M.fail('CONFLICT','本次提交已处理，请重新读取。');return {ok:true,registration:M.detail(r)}}
   if(!uploadsEnabled)M.fail('UPLOAD_UNAVAILABLE','报名材料服务暂未开放，请稍后再试。')
   if((r?.version||0)!==event.expectedVersion)M.fail('CONFLICT','报名记录已更新，请重新读取后操作。')
   const c=await tx.get('competitions',event.competitionId)
   if(r){M.beforeDeadline(c,now());if(!c?.displayEnabled)M.fail('NOT_FOUND','赛事暂未公开，请稍后再试。');if(!M.occupied(r.status))M.open(c,now())}else M.open(c,now())
   if(!c.registrationConfig)M.fail('NOT_CONFIGURED','本赛事报名安排尚未完善。')
   if((c.registrationRulesVersion||1)!==event.rulesVersion)M.fail('CONFLICT','赛事报名要求已更新，请重新读取后核对。')
   if(!c.registrationConfig.projects.includes(form.project))M.fail('INVALID_ARGUMENT','请选择本赛事的报名项目。')
   const attachments=[]
   for(const id of event.attachmentIds){const f=await tx.get('registrationFiles',id);if(!f||f.ownerUserId!==uid||f.competitionId!==c._id||f.status!=='ready'||(f.registrationId&&f.registrationId!==(r?._id||M.registrationId(c._id,team._id)))||(!f.registrationId&&f.expiresAt<=now()))M.fail('INVALID_ATTACHMENT','报名材料已失效，请重新上传。');attachments.push({id:f._id,name:f.name,size:f.size,extension:f.extension,fileID:f.fileID})}
   const time=new Date(now()).toISOString(),updated={_id:id,ownerUserId:uid,competitionId:c._id,teamId:team._id,form,attachments,status:'pending',review:null,version:(r?.version||0)+1,createdAt:r?.createdAt||time,submittedAt:time,updatedAt:time,competitionSnapshot:{name:c.name,requirements:c.registrationRequirements,minPlayers:c.registrationConfig.minPlayers,maxPlayers:c.registrationConfig.maxPlayers},lastOwnerRequest:{id:event.requestId,hash},history:M.history(r,'pending','leader',time)}
   await tx.set('competitions',c._id,M.transition(c,r?.status,'pending'))
   // This write serializes first reference creation against team dissolution.
   await tx.set('teams',team._id,{...team,version:team.version+1})
   for(const f of attachments){const saved=await tx.get('registrationFiles',f.id);await tx.set('registrationFiles',f.id,{...saved,registrationId:id})}
   const user=await tx.get('users',uid)
   await tx.set('users',uid,{...user,registrationUploadSlots:(user.registrationUploadSlots||[]).filter(s=>!event.attachmentIds.includes(s.id))})
   await tx.set('registrations',id,updated)
   return {ok:true,registration:M.detail(updated)}
  })
 }catch(error){return M.errorResult(error,logger)}}
}
module.exports={createRegistrationService,registrationId:M.registrationId}
