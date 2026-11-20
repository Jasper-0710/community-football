'use strict'
const {TTL,MAX_BYTES,query,pathFor,ACTIONS}=require('./public-cache')
function createPublicReadService({storage,environment,now=Date.now,logger=console}){
 return async event=>{
  const data=query(event)
  if(!data)return{ok:false,error:{code:'INVALID_ARGUMENT',message:'备用服务仅支持公开内容读取。'}}
  try{
   const bytes=await storage.download(pathFor(data))
   if(bytes.length>MAX_BYTES)throw new Error('Oversized cache')
   const saved=JSON.parse(bytes.toString('utf8'))
   if(saved.schemaVersion!==1||saved.environment!==environment||JSON.stringify(saved.query)!==JSON.stringify(data)||!Number.isFinite(saved.savedAt)||saved.savedAt>now()+60000||saved.expiresAt!==saved.savedAt+TTL||saved.expiresAt<=now()||saved.result?.ok!==true)throw new Error('Expired or invalid cache')
   return{...saved.result,recovery:{source:'fallback',savedAt:saved.savedAt,expiresAt:saved.expiresAt}}
  }catch{logger?.error?.('[publicRead] no fresh public snapshot');return{ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'云端备用内容尚未生成或已过期，请稍后重试。'}}}
 }
}
module.exports={createPublicReadService,PUBLIC_ACTIONS:ACTIONS}
