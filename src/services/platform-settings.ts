import {callWechatCloudFunction} from './wechat-cloud'
import {parsePlatformSettings,SettingsClientError} from '@/domain/platform-settings'
export async function getPlatformSettings(){
 let result:any
 try{
  // #ifdef MP-WEIXIN
  result=await callWechatCloudFunction('adminAuth',{action:'settings.getPublic'})
  // #endif
  // #ifndef MP-WEIXIN
  const endpoint=import.meta.env.VITE_COMPETITION_API_URL?.trim()
  if(!endpoint)throw new Error('Missing endpoint')
  const url=new URL(endpoint)
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('Invalid endpoint')
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000)
  try{const response=await fetch(url.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'settings.getPublic'}),credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});result=await response.json();if(!response.ok&&result?.ok!==false)throw new Error('Invalid response')}
  finally{clearTimeout(timer)}
  // #endif
 }catch{throw new SettingsClientError('SERVICE_UNAVAILABLE','暂时无法同步平台设置，稍后可重试。')}
 if(result?.ok!==true)throw new SettingsClientError(result?.error?.code||'INVALID_RESPONSE',result?.error?.message||'平台设置返回异常。')
 return parsePlatformSettings(result.settings)
}
