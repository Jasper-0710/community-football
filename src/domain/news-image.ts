import { ContentClientError, safeContentImage } from './content'
export interface NewsImageConfig { enabled: boolean; maxBytes: number; chunkSize: number; maxEdge: number; maxPixels: number }
export interface NewsImage { id: string; articleId: string; name: string; size: number; mime: 'image/jpeg' | 'image/png'; width: number; height: number; url: string }
export interface NewsImageUpload { id: string; chunkSize: number; uploaded: number[] }
export interface NewsImageCleanup { dryRun: boolean; scanned: number; eligibleObjects: number; removedObjects: number; protectedImages: number; deferredImages: number; nextCursor: string | null }
export const NEWS_IMAGE_MAX_BYTES = 2 * 1024 * 1024
export const NEWS_IMAGE_CHUNK = 64 * 1024
const id = (v: unknown): v is string => typeof v === 'string' && /^ni_[a-f0-9]{32}$/.test(v)
const int = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
const invalid = (): never => { throw new ContentClientError('INVALID_RESPONSE','图片服务返回异常，请重试。') }
export function parseNewsImageConfig(v: any): NewsImageConfig {
  if (v?.ok !== true || typeof v.enabled !== 'boolean' || v.maxBytes !== NEWS_IMAGE_MAX_BYTES || v.chunkSize !== NEWS_IMAGE_CHUNK || v.maxEdge !== 4096 || v.maxPixels !== 8_000_000) return invalid()
  return {enabled:v.enabled,maxBytes:v.maxBytes,chunkSize:v.chunkSize,maxEdge:v.maxEdge,maxPixels:v.maxPixels}
}
export function parseNewsImage(v: any): NewsImage {
  if (!v || !id(v.id) || typeof v.articleId !== 'string' || !/^n_[a-f0-9]{32}$/.test(v.articleId) || typeof v.name !== 'string' || !v.name.trim() || Array.from(v.name).length > 120 || !int(v.size) || !v.size || v.size > NEWS_IMAGE_MAX_BYTES || !['image/png','image/jpeg'].includes(v.mime) || !int(v.width) || !int(v.height) || !v.width || !v.height || v.width > 4096 || v.height > 4096 || v.width*v.height > 8_000_000 || !safeContentImage(v.url)) return invalid()
  return {id:v.id,articleId:v.articleId,name:v.name,size:v.size,mime:v.mime,width:v.width,height:v.height,url:v.url}
}
export function parseNewsImageUpload(v: any, validId: (v:unknown)=>boolean = id): NewsImageUpload {
  const chunks = Math.ceil(NEWS_IMAGE_MAX_BYTES / NEWS_IMAGE_CHUNK)
  if (v?.ok !== true || !validId(v.id) || v.chunkSize !== NEWS_IMAGE_CHUNK || !Array.isArray(v.uploaded) || v.uploaded.length > chunks || v.uploaded.some((i: unknown) => !int(i) || Number(i) >= chunks) || new Set(v.uploaded).size !== v.uploaded.length) return invalid()
  return {id:v.id,chunkSize:v.chunkSize,uploaded:v.uploaded}
}
export function parseNewsImageCleanup(v: any, validId: (v:unknown)=>boolean = id): NewsImageCleanup {
  if (v?.ok !== true || typeof v.dryRun !== 'boolean' || !['scanned','eligibleObjects','removedObjects','protectedImages','deferredImages'].every(k => int(v[k])) || v.scanned > 20 || v.protectedImages > v.scanned || v.deferredImages > v.scanned || v.removedObjects > v.eligibleObjects || v.dryRun && v.removedObjects !== 0 || v.nextCursor !== null && !validId(v.nextCursor)) return invalid()
  return {dryRun:v.dryRun,scanned:v.scanned,eligibleObjects:v.eligibleObjects,removedObjects:v.removedObjects,protectedImages:v.protectedImages,deferredImages:v.deferredImages,nextCursor:v.nextCursor}
}
