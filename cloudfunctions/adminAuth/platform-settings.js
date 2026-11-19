'use strict'
const {createHash}=require('node:crypto')
const schema=require('./platform-settings-schema.json')
const PUBLIC_ACTIONS=['settings.getPublic']
const COLLECTION='platformSettings', ID='primary'
class SettingsError extends Error {constructor(code,message){super(message);this.code=code}}
const fail=(code,message)=>{throw new SettingsError(code,message)}
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)
const keys=(v,allowed)=>object(v)&&Object.keys(v).every(k=>allowed.includes(k))
const text=(v,max)=>typeof v==='string'&&v.trim()===v&&v.length>0&&Array.from(v).length<=max&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(v)
function validateForm(f){
 if(!keys(f,['title','subtitle','theme','customColor','mode','radius','navigation'])||!text(f.title,16)||!text(f.subtitle,24)||!['custom',...schema.themes.map(t=>t.id)].includes(f.theme)||typeof f.customColor!=='string'||!/^#[a-fA-F0-9]{6}$/.test(f.customColor)||!['light','dark'].includes(f.mode)||!['square','soft','round'].includes(f.radius))fail('INVALID_ARGUMENT','请检查平台名称、副标题和主题设置。')
 const ids=schema.defaults.navigation.map(n=>n.id)
 if(!Array.isArray(f.navigation)||f.navigation.length!==6||f.navigation.some(n=>!keys(n,['id','label','icon'])||!ids.includes(n.id)||!text(n.label,4)||!schema.icons.includes(n.icon))||new Set(f.navigation.map(n=>n.id)).size!==6)fail('INVALID_ARGUMENT','请保留六个站内入口，每个入口只出现一次，名称为1–4字。')
 return {title:f.title,subtitle:f.subtitle,theme:f.theme,customColor:f.customColor.toLowerCase(),mode:f.mode,radius:f.radius,navigation:f.navigation.map(n=>({id:n.id,label:n.label,icon:n.icon}))}
}
function present(record){
 if(!record)return {version:0,updatedAt:null,form:JSON.parse(JSON.stringify(schema.defaults))}
 if(!Number.isSafeInteger(record.version)||record.version<1||typeof record.updatedAt!=='string'||!Number.isFinite(Date.parse(record.updatedAt)))throw new Error('Invalid settings record')
 let form
 try{form=validateForm(record.form)}catch{throw new Error('Invalid stored settings')}
 return {version:record.version,updatedAt:record.updatedAt,form}
}
function createSettingsService({store,authorize,now=Date.now,logger=console}){
 return async event=>{
  try{
   if(!object(event)||!['settings.getPublic','settings.getAdmin','settings.update'].includes(event.action))fail('INVALID_ARGUMENT','不支持的平台设置操作。')
   if(!PUBLIC_ACTIONS.includes(event.action)){const auth=await authorize(event.token);if(!auth?.ok)return auth||{ok:false,error:{code:'UNAUTHORIZED',message:'请先登录管理后台。'}}}
   const allowed=['action','userInfo','tcbContext',...(event.action==='settings.getPublic'?[]:['token']),...(event.action==='settings.update'?['expectedVersion','requestId','form']:[])]
   if(!keys(event,allowed))fail('INVALID_ARGUMENT','平台设置包含不支持的字段。')
   if(event.action!=='settings.update')return {ok:true,settings:present(await store.read(COLLECTION,ID))}
   const form=validateForm(event.form)
   if(!Number.isSafeInteger(event.expectedVersion)||event.expectedVersion<0||event.expectedVersion>=Number.MAX_SAFE_INTEGER||typeof event.requestId!=='string'||!/^[a-f0-9]{32}$/.test(event.requestId))fail('INVALID_ARGUMENT','设置版本或保存请求无效，请重新读取。')
   const fingerprint=createHash('sha256').update(JSON.stringify({form,expectedVersion:event.expectedVersion})).digest('hex')
   return await store.atomic(async tx=>{
    const previous=await tx.get(COLLECTION,ID),current=present(previous)
    if(previous?.lastRequestId===event.requestId){if(previous.lastFingerprint!==fingerprint)fail('CONFLICT','相同保存请求的内容已改变，请重新读取。');return {ok:true,settings:current}}
    if(current.version!==event.expectedVersion)fail('CONFLICT','平台设置已被更新，请先重新读取，再应用你的修改。')
    const record={_id:ID,schemaVersion:1,version:current.version+1,form,updatedAt:new Date(now()).toISOString(),lastRequestId:event.requestId,lastFingerprint:fingerprint}
    await tx.set(COLLECTION,ID,record)
    return {ok:true,settings:present(record)}
   })
  }catch(e){if(e instanceof SettingsError)return {ok:false,error:{code:e.code,message:e.message}};logger?.error?.('[settings] operation failed');return {ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'平台设置暂不可用，请重试。保存结果不明时请重新读取确认。'}}}
 }
}
module.exports={createSettingsService,PUBLIC_ACTIONS,validateForm,present}
