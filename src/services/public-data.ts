import { onMounted, onUnmounted } from 'vue'
import { callWechatCloudFunction,setWechatRecoveryGuard } from './wechat-cloud'
import { setRecoveryWriteCheck,assertRecoveryWritable } from './recovery-write'
import { createPublicRecovery, PublicReadError } from './public-recovery'
import { parseCompetition, parseCompetitionPage } from '../domain/competition'
import { parseMatch, parseMatchPage } from '../domain/match'
import { parseStandings } from '../domain/standings'
import { parseNewsArticle, parseNewsPage, parseSearchPage, parsePublicTeam, parsePlayerProfile } from '../domain/content'
import { parseLivePage } from '../domain/match-live'
import { parsePlatformSettings } from '../domain/platform-settings'
import { parseEvaluationPublic } from '../domain/evaluation'
const actions = new Set(['competitions.listPublic','competitions.getPublic','matches.listPublic','matches.getPublic','standings.getPublic','news.listPublic','news.getPublic','search.public','search.suggestions','directory.teamPublic','directory.playerPublic','live.listPublic','settings.getPublic'])
function sanitize(data: Record<string,unknown>, raw: any): any {
  if (raw?.ok !== true) throw new PublicReadError(raw?.error?.code || 'INVALID_RESPONSE', raw?.error?.message || '公开服务返回异常，请重试。')
  const wrap = (fields: object) => ({ ok:true,...fields })
  switch (data.action) {
    case 'competitions.listPublic': return wrap(parseCompetitionPage(raw))
    case 'competitions.getPublic': { const c = parseCompetition(raw.competition); if(c.id!==data.id)break; return wrap({competition:c}) }
    case 'matches.listPublic': { const page = parseMatchPage(raw); if(page.matches.some(m=>m.competitionId!==data.competitionId))break; return wrap(page) }
    case 'matches.getPublic': { const m = parseMatch(raw.match); if(m.id!==data.id)break; return wrap({match:m}) }
    case 'standings.getPublic': { const s = parseStandings(raw); if(s.competitionId!==data.competitionId)break; return wrap(s) }
    case 'news.listPublic': return wrap(parseNewsPage(raw))
    case 'news.getPublic': { const a = parseNewsArticle(raw.article,false,true); if(a.id!==data.id)break; return wrap({article:a}) }
    case 'search.public': return wrap(parseSearchPage(raw))
    case 'search.suggestions': if(Array.isArray(raw.words)&&raw.words.length<=8&&raw.words.every((word:unknown)=>typeof word==='string'&&word.trim()&&Array.from(word).length<=40))return wrap({words:[...new Set(raw.words)]}); break
    case 'directory.teamPublic': { const team=parsePublicTeam(raw.team); if(team.id!==data.id)break; return wrap({team}) }
    case 'directory.playerPublic': { const player=parsePlayerProfile(raw.player); if(player.id!==data.id||player.teamId!==data.teamId)break; return wrap({player}) }
    case 'live.listPublic': return wrap(parseLivePage(raw,false,String(data.matchId)))
    case 'settings.getPublic': return wrap({settings:parsePlatformSettings(raw.settings)})
    case 'evaluation.getPublic': return wrap(parseEvaluationPublic(raw))
  }
  throw new PublicReadError('INVALID_RESPONSE','公开数据与本次请求不匹配，请重新读取。')
}
export async function fetchPublicGateway(endpoint: string, data: Record<string,unknown>) {
  let url: URL
  try { url=new URL(endpoint); if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search)throw new Error() }
  catch { throw new PublicReadError('NOT_CONFIGURED','公开服务地址尚未正确配置。') }
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000)
  try {
    const response=await fetch(url.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal})
    let value:any
    try{value=await response.json()}catch{throw new PublicReadError(response.status>=500?'SERVICE_UNAVAILABLE':'INVALID_RESPONSE','公开服务返回异常，请稍后重试。')}
    if(response.status>=500&&!(value?.ok===false&&typeof value.error?.code==='string'&&typeof value.error?.message==='string'))throw new PublicReadError('SERVICE_UNAVAILABLE','公开服务暂不可用。')
    if(!response.ok&&value?.ok!==false)throw new PublicReadError('INVALID_RESPONSE','公开服务返回异常。')
    return value
  }catch(error){if(error instanceof PublicReadError)throw error;throw new PublicReadError(controller.signal.aborted?'TIMEOUT':'NETWORK_ERROR','暂时无法连接公开服务，请检查网络后重试。')}
  finally{clearTimeout(timer)}
}
async function primary(data: Record<string,unknown>): Promise<unknown> {
  // #ifdef MP-WEIXIN
  return callWechatCloudFunction('adminAuth',data)
  // #endif
  // #ifndef MP-WEIXIN
  return fetchPublicGateway(import.meta.env.VITE_COMPETITION_API_URL?.trim()||'',data)
  // #endif
}
let fallbackRead:((data:Record<string,unknown>)=>Promise<unknown>)|undefined
// #ifdef MP-WEIXIN
if(import.meta.env.VITE_PUBLIC_FALLBACK_FUNCTION==='publicRead')fallbackRead=data=>callWechatCloudFunction('publicRead',data)
// #endif
// #ifndef MP-WEIXIN
const fallback=import.meta.env.VITE_PUBLIC_FALLBACK_API_URL?.trim()
if(fallback)fallbackRead=data=>fetchPublicGateway(fallback,data)
// #endif
const key=`community-football.public-snapshots.v1:${import.meta.env.VITE_WECHAT_CLOUD_ENV_ID||''}:${import.meta.env.VITE_COMPETITION_API_URL||''}`
export const publicRecovery=createPublicRecovery({primary,fallback:fallbackRead,sanitize,cacheable:action=>actions.has(action),readCache:()=>uni.getStorageSync(key),writeCache:value=>uni.setStorageSync(key,value)})
setRecoveryWriteCheck(()=>publicRecovery.assertWritable())
setWechatRecoveryGuard(assertRecoveryWritable)
export const requestPublicData=(data:Record<string,unknown>)=>publicRecovery.read(data)
export function useRecoveryRefresh(handler:()=>unknown){let dispose:(()=>void)|undefined;onMounted(()=>{dispose=publicRecovery.subscribe(handler)});onUnmounted(()=>dispose?.())}
let started=false
export function initializePublicRecovery(){
 if(started)return;started=true
 uni.getNetworkType({success:result=>publicRecovery.setOnline(result.networkType!=='none')})
 uni.onNetworkStatusChange(result=>publicRecovery.setOnline(result.isConnected))
 // #ifdef H5
 publicRecovery.setOnline(navigator.onLine)
 window.addEventListener('online',()=>publicRecovery.setOnline(true));window.addEventListener('offline',()=>publicRecovery.setOnline(false))
 // #endif
}
