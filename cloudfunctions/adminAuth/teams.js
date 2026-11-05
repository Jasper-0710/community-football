'use strict'
const ID=/^t_[a-f0-9]{64}$/
function summary(r){return {id:r._id,name:r.name,district:r.district,description:r.description,contactPhone:r.contactPhone,
  status:r.status||'active',dissolvedAt:r.dissolvedAt||null,
  version:r.version,playerCount:r.roster.length,badgeUploadEnabled:false,badgeUrl:'',createdAt:r.createdAt,updatedAt:r.updatedAt}}
function createAdminTeamService({store,authorize,logger=console}){
 return async event=>{
  try{
   const auth=await authorize(event?.token);if(!auth.ok)return auth
   const action=event?.action,keys=action==='teams.listAdmin'?['cursor']:action==='teams.getAdmin'?['id']:null
   if(!keys||Object.keys(event).some(k=>!['action','token','userInfo','tcbContext',...keys].includes(k)))return {ok:false,error:{code:'INVALID_ARGUMENT',message:'不支持的球队档案请求。'}}
   if(action==='teams.listAdmin'){
    if(event.cursor!=null&&(typeof event.cursor!=='string'||!ID.test(event.cursor)))return {ok:false,error:{code:'INVALID_ARGUMENT',message:'分页位置无效，请刷新球队列表。'}}
    const rows=await store.list(event.cursor||null,21)
    return {ok:true,teams:rows.slice(0,20).map(summary),nextCursor:rows.length>20?rows[19]._id:null}
   }
   if(typeof event.id!=='string'||!ID.test(event.id))return {ok:false,error:{code:'NOT_FOUND',message:'球队不存在，请刷新列表。'}}
   const team=await store.read(event.id)
   if(!team)return {ok:false,error:{code:'NOT_FOUND',message:'球队不存在，请刷新列表。'}}
   const leader=await store.user(team.leaderUserId)
   return {ok:true,team:{...summary(team),leaderNickname:team.status==='dissolved'?team.leaderNicknameSnapshot||'':leader?.nickname||'',players:team.roster.map(p=>({id:p.id,name:p.name,number:p.number,position:p.position})).sort((a,b)=>a.number-b.number)}}
  }catch{logger?.error?.('[adminTeams] operation failed');return {ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'球队档案暂不可用，请重试。'}}}
 }
}
module.exports={createAdminTeamService}
