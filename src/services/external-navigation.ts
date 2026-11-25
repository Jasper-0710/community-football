import {openExternalTarget,type ExternalNavigation} from '@/domain/external-navigation'
import type {ExternalTarget} from '@/domain/external-entries'
export function jumpExternal(target:ExternalTarget,label:string,key:'community'|'insurance'){
  const nav:ExternalNavigation={
    platform:'h5',
    confirm:label=>new Promise(resolve=>uni.showModal({title:'即将离开赛事平台',content:`将打开“${label}”的外部服务，是否继续？`,confirmText:'继续打开',cancelText:'留在这里',success:r=>resolve(r.confirm),fail:()=>resolve(false)})),
    miniProgram:()=>Promise.reject(new Error('Unsupported platform')),
    web:()=>Promise.reject(new Error('Unsupported platform')),
  }
  // #ifdef H5
  nav.web=async url=>{window.location.assign(url)}
  // #endif
  // #ifdef MP-WEIXIN
  nav.platform='weixin'
  nav.miniProgram=(appId,path)=>new Promise((resolve,reject)=>uni.navigateToMiniProgram({appId,path,envVersion:'release',success:()=>resolve(),fail:reject}))
  nav.web=()=>new Promise((resolve,reject)=>uni.navigateTo({url:`/pages/external/web?entry=${key}`,success:()=>resolve(),fail:reject}))
  // #endif
  return openExternalTarget(target,label,nav)
}
