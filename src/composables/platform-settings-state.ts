import {ref,computed,readonly} from 'vue'
import {defaultPlatformForm,parsePlatformSettings,themeTokens,type PlatformSettings} from '../domain/platform-settings'
export function createPlatformState(deps:{load:()=>Promise<PlatformSettings>;readCache:()=>unknown;writeCache:(s:PlatformSettings)=>void}){
 const settings=ref<PlatformSettings>({version:0,updatedAt:null,form:defaultPlatformForm()}),loading=ref(false),error=ref(''),confirmed=ref(false)
 let initialized=false,pending:Promise<void>|null=null
 function initialize(){if(initialized)return;initialized=true;try{const cached=deps.readCache();if(cached)settings.value=parsePlatformSettings(cached)}catch{/* Reject corrupt local cache. */}}
 async function refresh(){
  initialize();if(pending)return pending
  loading.value=true;error.value=''
  pending=deps.load().then(raw=>{const next=parsePlatformSettings(raw);if(next.version<settings.value.version)throw new Error('平台设置版本暂未同步，请稍后重试。');settings.value=next;confirmed.value=true;try{deps.writeCache(next)}catch{/* Current in-memory settings remain usable. */}}).catch(e=>{confirmed.value=false;error.value=e instanceof Error?e.message:'平台设置同步失败，请重试。'}).finally(()=>{loading.value=false;pending=null})
  return pending
 }
 return {settings:readonly(settings),loading:readonly(loading),error:readonly(error),confirmed:readonly(confirmed),tokens:computed(()=>themeTokens(settings.value.form as PlatformSettings['form'])),initialize,refresh}
}
