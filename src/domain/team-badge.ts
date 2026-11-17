import { TeamClientError, safeBadgeUrl } from './team'
export const BADGE_MAX_BYTES = 256 * 1024
export const BADGE_CHUNK = 64 * 1024
export interface TeamBadgeImage { id:string; teamId:string; size:number; mime:'image/png'|'image/jpeg'; width:number; height:number; url:string }
const invalid=():never=>{throw new TeamClientError('INVALID_RESPONSE','队徽服务返回异常，请重新读取球队。')}
export function badgeMime(bytes:Uint8Array):TeamBadgeImage['mime'] {
  if ([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)) return 'image/png'
  if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'image/jpeg'
  throw new TeamClientError('INVALID_ARGUMENT','队徽仅支持JPG或PNG图片，请重新选择。')
}
export function parseBadgeUpload(v:any,size:number) {
  const count=Math.ceil(size/BADGE_CHUNK)
  if(v?.ok!==true||typeof v.id!=='string'||!/^tb_[a-f0-9]{32}$/.test(v.id)||v.chunkSize!==BADGE_CHUNK||!Array.isArray(v.uploaded)||v.uploaded.length>count||v.uploaded.some((i:any)=>!Number.isInteger(i)||i<0||i>=count)||new Set(v.uploaded).size!==v.uploaded.length)return invalid()
  return {id:v.id,chunkSize:BADGE_CHUNK,uploaded:v.uploaded as number[]}
}
export function parseBadgeImage(v:any):TeamBadgeImage {
  if(!v||typeof v.id!=='string'||!/^tb_[a-f0-9]{32}$/.test(v.id)||typeof v.teamId!=='string'||!/^t_[a-f0-9]{64}$/.test(v.teamId)||!Number.isSafeInteger(v.size)||v.size<1||v.size>BADGE_MAX_BYTES||!['image/png','image/jpeg'].includes(v.mime)||![v.width,v.height].every(n=>Number.isInteger(n)&&n>0&&n<=2048)||v.width*v.height>4_000_000||!safeBadgeUrl(v.url))return invalid()
  return {id:v.id,teamId:v.teamId,size:v.size,mime:v.mime,width:v.width,height:v.height,url:v.url}
}
export function parseBadgeReceipt(v:any,teamId:string,expectedVersion:number) {
  if(v?.ok!==true||v.teamId!==teamId||!Number.isSafeInteger(v.version)||v.version<=expectedVersion)return invalid()
  return {teamId:v.teamId as string,version:v.version as number}
}
export interface BadgeCleanup { dryRun:boolean;scanned:number;eligibleObjects:number;removedObjects:number;protectedBadges:number;deferredBadges:number;nextCursor:string|null }
export function parseBadgeCleanup(v:any):BadgeCleanup {
  if(v?.ok!==true||typeof v.dryRun!=='boolean'||!['scanned','eligibleObjects','removedObjects','protectedBadges','deferredBadges'].every(k=>Number.isSafeInteger(v[k])&&v[k]>=0)||v.scanned>20||v.protectedBadges>v.scanned||v.deferredBadges>v.scanned||v.removedObjects>v.eligibleObjects||v.dryRun&&v.removedObjects!==0||v.nextCursor!==null&&(typeof v.nextCursor!=='string'||!/^tb_[a-f0-9]{32}$/.test(v.nextCursor)))return invalid()
  return {dryRun:v.dryRun,scanned:v.scanned,eligibleObjects:v.eligibleObjects,removedObjects:v.removedObjects,protectedBadges:v.protectedBadges,deferredBadges:v.deferredBadges,nextCursor:v.nextCursor}
}
