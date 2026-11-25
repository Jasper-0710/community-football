import {validExternalTarget,type ExternalTarget} from './external-entries'
export type ExternalJumpResult = 'opened' | 'cancelled' | 'unsupported'
export interface ExternalNavigation {
  platform:'weixin'|'h5'
  confirm:(label:string)=>Promise<boolean>
  miniProgram:(appId:string,path:string)=>Promise<void>
  web:(url:string)=>Promise<void>
}
// Keep the operation testable without a WeChat global or a browser location.
export async function openExternalTarget(target:ExternalTarget,label:string,nav:ExternalNavigation):Promise<ExternalJumpResult>{
  if(!validExternalTarget(target,false,true))throw new Error('跳转目标尚未正确配置，请稍后重试。')
  if(target.kind==='miniProgram'&&nav.platform!=='weixin')return 'unsupported'
  if(!await nav.confirm(label))return 'cancelled'
  try{
    if(target.kind==='miniProgram')await nav.miniProgram(target.appId,target.path)
    else await nav.web(target.url)
    return 'opened'
  }catch(e){
    if(/cancel/i.test(String((e as any)?.errMsg||(e as any)?.message||'')))return 'cancelled'
    throw new Error('暂时无法打开目标，请稍后重试或联系运营人员。')
  }
}
