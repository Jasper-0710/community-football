'use strict'
const {createDirectoryFixture}=require('./directory-fixture.cjs')
const {createTeamMemory}=require('./team-store.cjs')
const {APP_ID,userId,createTeamService}=require('../../cloudfunctions/teamManagement/service')
const {createAdminTeamService}=require('../../cloudfunctions/adminAuth/teams')
const {createContentService}=require('../../cloudfunctions/adminAuth/content')
async function createMaintenanceFixture(){
 const directory=await createDirectoryFixture(),memory=createTeamMemory(),time='2026-11-24T00:00:00.000Z'
 for(const [name,rows] of Object.entries(directory.collections))for(const row of rows.values())memory.seed(name,row._id,row)
 const users=['owner-a','owner-b','owner-c'].map((openId,index)=>({_id:userId(APP_ID,openId),appId:APP_ID,openId,nickname:['档案领队甲','档案领队乙','档案领队丙'][index],avatarFileId:'',phone:'1380000000'+index,role:index===0?'leader':'user',createdAt:time,updatedAt:time}))
 for(const u of users)memory.seed('users',u._id,u)
 const id=directory.tid(1),team=memory.read('teams',id)
 memory.seed('teams',id,{...team,schemaVersion:1,leaderUserId:users[0]._id,contactPhone:users[0].phone,createdAt:time,updatedAt:time})
 memory.seed('leaderTeamBindings',users[0]._id,{teamId:id,createdAt:time})
 for(const [key,t] of memory.records)if(key.startsWith('teams/')){
  if(t._id!==id)memory.seed('teams',t._id,{...t,schemaVersion:1,contactPhone:'13800000009',createdAt:time,updatedAt:time,fixture:{synthetic:true,batchId:'isolated-directory',source:'developer-prepared; no real user submission or review'}})
  for(const p of t.roster)memory.seed('players',p.id,{...p,teamId:t._id,status:'active',createdAt:time,updatedAt:time})
 }
 const authorize=async token=>token==='test-token'?{ok:true,admin:{username:'验收管理员'}}:{ok:false,error:{code:'UNAUTHORIZED',message:'请登录管理后台。'}}
 const deps={logger:{error(){}},authorize}
 const admin=createAdminTeamService({...deps,store:memory.adminStore})
 const contentStore={scan:async name=>[...memory.records].filter(([key])=>key.startsWith(name+'/')).map(([,value])=>structuredClone(value)),read:async(name,id)=>memory.read(name,id)}
 const content=createContentService({...deps,store:contentStore})
 const owner=(index=0)=>createTeamService({store:memory.store,context:()=>({APPID:APP_ID,OPENID:users[index].openId}),logger:{error(){}}})
 let counter=500
 const request=()=> (++counter).toString(16).padStart(32,'0')
 const call=(action,fields={})=>admin({action,token:'test-token',...fields})
 return {...directory,...memory,store:memory.store,contentStore,users,admin,call,content,owner,request,id,time}
}
module.exports={createMaintenanceFixture}
