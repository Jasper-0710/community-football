import {callWechatCloudFunction,WechatCloudError} from './wechat-cloud'
import {parseManagedTeam,TeamClientError,type TeamForm,type PlayerForm} from '@/domain/team'
async function request(data:Record<string,unknown>):Promise<any>{
 let value:any
 try{value=await callWechatCloudFunction<unknown>('teamManagement',data)}catch(e){
  if(e instanceof WechatCloudError && e.code==='UNSUPPORTED')throw new TeamClientError('UNSUPPORTED','请在微信小程序中管理球队。')
  throw new TeamClientError('SERVICE_UNAVAILABLE','暂时无法连接球队服务。若刚刚保存，请重新读取确认结果后再重试。')
 }
 if(value?.ok!==true)throw new TeamClientError(value?.error?.code||'INVALID_RESPONSE',value?.error?.message||'球队服务返回异常，请重试。')
 return value
}
export async function getMyTeam(){const r=await request({action:'mine'});return r.team===null?null:parseManagedTeam(r.team)}
export async function createMyTeam(requestId:string,form:TeamForm){return parseManagedTeam((await request({action:'create',requestId,form})).team)}
export async function updateMyTeam(expectedVersion:number,form:TeamForm){return parseManagedTeam((await request({action:'update',expectedVersion,form})).team)}
export async function saveTeamPlayer(expectedVersion:number,id:string,form:PlayerForm){return parseManagedTeam((await request({action:'savePlayer',expectedVersion,id,form})).team)}
export async function removeTeamPlayer(expectedVersion:number,id:string){return parseManagedTeam((await request({action:'removePlayer',expectedVersion,id})).team)}
export async function checkTeamDissolution(expectedVersion:number){
 const r=await request({action:'checkDissolution',expectedVersion})
 if(r.canDissolve!==true||r.version!==expectedVersion)throw new TeamClientError('INVALID_RESPONSE','解散条件返回异常，请重新读取。')
}
export async function dissolveMyTeam(expectedVersion:number,confirmName:string){
 const r=await request({action:'dissolve',expectedVersion,confirmName})
 if(r.dissolved!==true||r.team!==null)throw new TeamClientError('INVALID_RESPONSE','解散结果返回异常，请重新读取。')
}
