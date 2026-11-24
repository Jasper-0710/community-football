'use strict'
const {badgeView}=require('./team-badge-model')
const M=require('./team-profile-model')
const actions={
 'teams.listAdmin':['cursor'],'teams.getAdmin':['id'],'teams.leadersAdmin':['cursor'],
 'teams.createAdmin':['requestId','leaderId','form'],
 'teams.updateAdmin':['id','expectedVersion','requestId','form'],
 'teams.savePlayerAdmin':['id','expectedVersion','requestId','playerId','form'],
 'teams.removePlayerAdmin':['id','expectedVersion','requestId','playerId','confirmName'],
 'teams.assignLeaderAdmin':['id','expectedVersion','requestId','leaderId','confirmName'],
 'teams.checkDissolutionAdmin':['id','expectedVersion'],
 'teams.dissolveAdmin':['id','expectedVersion','requestId','confirmName'],
}
function summary(r){return {id:r._id,name:r.name,district:r.district,description:r.description,contactPhone:r.contactPhone,
 status:r.status||'active',dissolvedAt:r.dissolvedAt||null,version:r.version,playerCount:r.roster.length,badgeUploadEnabled:false,badgeId:r.badgeId||'',hasBadge:!!r.badgeFileId,badgeUrl:'',createdAt:r.createdAt,updatedAt:r.updatedAt}}
function active(team){if(!team)M.fail('NOT_FOUND','球队不存在，请刷新列表。');if(team.status==='dissolved')M.fail('CONFLICT','已解散档案仅供查看，不能继续修改。');if(![undefined,'active'].includes(team.status)||team.schemaVersion!==1||!Array.isArray(team.roster)||!Number.isSafeInteger(team.version)||team.version<1)throw new Error('Invalid team')}
function version(team,v){if(team.version!==v)M.fail('CONFLICT','球队已在其他页面更新，请重新读取后再操作。')}
function audit(team,event,hash,actor,at){return {...team,lastAdminRequest:{id:event.requestId,hash},adminHistory:[...(team.adminHistory||[]),{action:event.action,requestId:event.requestId,actor,at,fromVersion:event.expectedVersion||0,toVersion:team.version,...(event.playerId?{playerId:event.playerId}:{})}].slice(-50)}}
async function ownership(tx,team){
 const user=await tx.get('users',team.leaderUserId)
 const binding=await tx.get('leaderTeamBindings',team.leaderUserId)
 if(!user&&!binding&&M.synthetic(team))return null
 if(!M.realUser(user)||binding?.teamId!==team._id)throw new Error('Invalid ownership')
 return user
}
async function candidate(tx,id){
 const user=await tx.get('users',id),binding=await tx.get('leaderTeamBindings',id)
 if(!M.realUser(user))M.fail('INVALID_ARGUMENT','请选择已在本小程序登录的微信用户。')
 if(!user.nickname?.trim())M.fail('PROFILE_REQUIRED','该用户尚未填写昵称，请先在小程序完善资料。')
 if(binding?.teamId)M.fail('ALREADY_EXISTS','该用户已管理一支球队，请选择其他领队。')
 if(binding&&(!Number.isSafeInteger(binding.lastTeamVersion)||binding.lastTeamVersion<1)||!binding&&user.role==='leader')throw new Error('Invalid leader binding')
 if(!binding&&await tx.get('teams','t_'+id))throw new Error('Missing legacy ownership binding')
 return {user,binding}
}
function createAdminTeamService({store,storage,authorize,now=()=>new Date().toISOString(),logger=console}){
 async function view(team,leader){return {...summary(team),...await badgeView(team,storage),leaderNickname:team.status==='dissolved'?team.leaderNicknameSnapshot||'':leader?.nickname||'',players:team.roster.map(M.publicPlayer).sort((a,b)=>a.number-b.number)}}
 return async event=>{try{
  const auth=await authorize(event?.token);if(!auth.ok)return auth
  const action=event?.action;if(!Object.hasOwn(actions,action))M.fail('INVALID_ARGUMENT','不支持的球队档案请求。')
  M.fields(event,['action','token','userInfo','tcbContext',...actions[action]])
  if(['teams.listAdmin','teams.leadersAdmin'].includes(action)){
   const leaders=action==='teams.leadersAdmin'
   if(event.cursor!=null&&(typeof event.cursor!=='string'||!(leaders?M.USER:M.TEAM).test(event.cursor)))M.fail('INVALID_ARGUMENT','分页位置无效，请刷新列表。')
   const rows=await (leaders?store.leaders(event.cursor||null,21):store.list(event.cursor||null,21))
   const nextCursor=rows.length>20?rows[19]._id:null
   if(!leaders)return {ok:true,teams:await Promise.all(rows.slice(0,20).map(async r=>({...summary(r),...await badgeView(r,storage)}))),nextCursor}
   const options=[]
   for(const u of rows.slice(0,20))if(M.realUser(u)){
    const b=await store.binding(u._id),reason=b?.teamId?'已管理球队':!u.nickname?.trim()?'请先填写昵称':(b&&(!Number.isSafeInteger(b.lastTeamVersion)||b.lastTeamVersion<1)||!b&&u.role==='leader')?'归属资料需核对':''
    const digits=typeof u.phone==='string'?u.phone.replace(/\D/g,''):''
    options.push({id:u._id,nickname:u.nickname||'',phoneHint:digits.length>=7?`手机或座机尾号 ${digits.slice(-4)}`:'',available:!reason,reason})
   }
   return {ok:true,leaders:options,nextCursor}
  }
  if(action==='teams.getAdmin'){
   if(typeof event.id!=='string'||!M.TEAM.test(event.id))M.fail('NOT_FOUND','球队不存在，请刷新列表。')
   const team=await store.read(event.id);if(!team)M.fail('NOT_FOUND','球队不存在，请刷新列表。')
   return {ok:true,team:await view(team,await store.user(team.leaderUserId))}
  }
  const create=action==='teams.createAdmin',check=action==='teams.checkDissolutionAdmin'
  if(!create&&(typeof event.id!=='string'||!M.TEAM.test(event.id)))M.fail('NOT_FOUND','球队不存在，请刷新列表。')
  if(!create&&(!Number.isSafeInteger(event.expectedVersion)||event.expectedVersion<1))M.fail('INVALID_ARGUMENT','球队版本无效，请重新读取资料。')
  if(!check&&(typeof event.requestId!=='string'||!M.REQUEST.test(event.requestId)))M.fail('INVALID_ARGUMENT','请求标识无效，请重新打开表单。')
  if((create||action==='teams.assignLeaderAdmin')&&(typeof event.leaderId!=='string'||!M.USER.test(event.leaderId)))M.fail('INVALID_ARGUMENT','请选择球队领队。')
  if(['teams.savePlayerAdmin','teams.removePlayerAdmin'].includes(action)&&(typeof event.playerId!=='string'||!M.PLAYER.test(event.playerId)))M.fail('INVALID_ARGUMENT','球员标识无效，请重新读取名单。')
  const form=create||action==='teams.updateAdmin'?M.teamForm(event.form):action==='teams.savePlayerAdmin'?M.playerForm(event.form):null
  if(['teams.removePlayerAdmin','teams.assignLeaderAdmin','teams.dissolveAdmin'].includes(action))M.text(event.confirmName,'确认名称',40)
  const hash=M.digest({action,id:event.id||null,expectedVersion:event.expectedVersion||0,leaderId:event.leaderId||null,playerId:event.playerId||null,confirmName:event.confirmName||null,form})
  const result=await store.transaction(async tx=>{
   const at=now(),actor=auth.admin?.username||'admin'
   if(create){
    // Request-derived ID and immutable fingerprint survive later roster changes.
    const id='t_'+M.digest(['admin',event.requestId]),previous=await tx.get('teams',id)
    if(previous){if(previous.adminCreation?.hash!==hash)M.fail('CONFLICT','此建队请求已使用，请重新打开表单。');return {team:previous,user:await tx.get('users',previous.leaderUserId),created:false}}
    const {user,binding}=await candidate(tx,event.leaderId)
    let team={_id:id,schemaVersion:1,status:'active',leaderUserId:user._id,...form,badgeFileId:'',roster:[],version:(binding?.lastTeamVersion||0)+1,adminCreation:{requestId:event.requestId,hash},createdAt:at,updatedAt:at}
    team=audit(team,event,hash,actor,at)
    await tx.set('teams',id,team);await tx.set('leaderTeamBindings',user._id,{teamId:id,createdAt:at})
    await tx.set('users',user._id,{...user,role:user.role==='admin'?'admin':'leader',phone:form.contactPhone,updatedAt:at})
    return {team,user,created:true}
   }
   let team=await tx.get('teams',event.id)
   if(!team)M.fail('NOT_FOUND','球队不存在，请刷新列表。')
   if(!check&&team.lastAdminRequest?.id===event.requestId){if(team.lastAdminRequest.hash!==hash)M.fail('CONFLICT','本次请求已处理且内容不同，请重新读取。');return {team,user:await tx.get('users',team.leaderUserId)}}
   active(team);version(team,event.expectedVersion)
   let user=await ownership(tx,team)
   if(check||action==='teams.dissolveAdmin'||action==='teams.assignLeaderAdmin'){
    if(action==='teams.assignLeaderAdmin'&&team.leaderUserId===event.leaderId)M.fail('INVALID_ARGUMENT','请选择其他领队。')
    if(await tx.hasReferences(team._id))M.fail('TEAM_IN_USE','球队已有关联报名、赛程或成绩，不能解散或更换领队；仍可维护基本资料和当前名单。')
    if(!user)M.fail('INVALID_ARGUMENT','模拟档案没有可释放的真实领队，请先核对归属资料。')
    if(check)return {canDissolve:true,version:team.version}
    if(event.confirmName!==team.name)M.fail('CONFIRMATION_REQUIRED','请输入完整且一致的球队名称。')
    let next=null
    if(action==='teams.assignLeaderAdmin')next=await candidate(tx,event.leaderId)
    const nextVersion=Math.max(team.version,next?.binding?.lastTeamVersion||0)+1
    await tx.set('leaderTeamBindings',user._id,{teamId:null,lastTeamVersion:nextVersion,updatedAt:at,...(next?{}:{lastDissolution:{teamId:team._id,expectedVersion:event.expectedVersion,name:team.name}})})
    await tx.set('users',user._id,{...user,role:user.role==='admin'?'admin':'user',updatedAt:at})
    if(next){
     await tx.set('leaderTeamBindings',next.user._id,{teamId:team._id,createdAt:at})
     await tx.set('users',next.user._id,{...next.user,role:next.user.role==='admin'?'admin':'leader',phone:team.contactPhone,updatedAt:at})
     team={...team,leaderUserId:next.user._id,version:nextVersion};user=next.user
    }else team={...team,status:'dissolved',dissolvedAt:at,leaderNicknameSnapshot:user.nickname,version:nextVersion}
   }else if(action==='teams.updateAdmin'){
    team={...team,...form,version:team.version+1}
    if(user)await tx.set('users',user._id,{...user,phone:form.contactPhone,updatedAt:at})
   }else{
    const previous=await tx.get('players',event.playerId),index=team.roster.findIndex(p=>p.id===event.playerId)
    if(previous&&previous.teamId!==team._id)M.fail('FORBIDDEN','球员不属于当前球队。')
    if(action==='teams.savePlayerAdmin'){
     if(previous?.status==='removed')M.fail('CONFLICT','该球员已移出名单，请重新添加。')
     if(previous&&previous.status!=='active')throw new Error('Invalid player status')
     if(previous&&index<0||!previous&&index>=0)throw new Error('Invalid player roster')
     if(team.roster.some(p=>p.id!==event.playerId&&p.number===form.number))M.fail('NUMBER_IN_USE','该球衣号码已被本队其他球员使用。')
     const player={...previous,id:event.playerId,teamId:team._id,...form,status:'active',createdAt:previous?.createdAt||at,updatedAt:at}
     // Invalidate leader-side retry receipts when an admin edits a player.
     delete player.lastExpectedVersion
     const roster=[...team.roster];if(index<0)roster.push(M.publicPlayer(player));else roster[index]=M.publicPlayer(player)
     await tx.set('players',event.playerId,player);team={...team,roster,version:team.version+1}
    }else{
     if(!previous||previous.status!=='active'||index<0)M.fail('NOT_FOUND','该球员已不在当前名单中，请重新读取。')
     if(event.confirmName!==previous.name)M.fail('CONFIRMATION_REQUIRED','球员名称已变化，请重新读取名单。')
     const archived={...previous,status:'removed',removedAt:at,updatedAt:at};delete archived.lastExpectedVersion
     await tx.set('players',event.playerId,archived);team={...team,roster:team.roster.filter(p=>p.id!==event.playerId),version:team.version+1}
    }
   }
   team=audit({...team,updatedAt:at},event,hash,actor,at);await tx.set('teams',team._id,team)
   return {team,user}
  })
  if(check)return {ok:true,...result}
  return {ok:true,action,requestId:event.requestId,team:await view(result.team,result.user),...(create?{created:result.created}:{})}
 }catch(error){
  if(error instanceof M.TeamError)return {ok:false,error:{code:error.code,message:error.message}}
  logger?.error?.('[adminTeams] operation failed');return {ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'球队档案暂不可用。若刚刚保存，请重试本次提交或重新读取确认结果。'}}
 }}
}
module.exports={createAdminTeamService}
