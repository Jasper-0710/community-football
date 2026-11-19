import { ContentClientError, safeContentImage } from './content'
import { NEWS_IMAGE_MAX_BYTES, NEWS_IMAGE_CHUNK, type NewsImageConfig, type NewsImageCleanup } from './news-image'
export interface LiveImage { url: string; caption: string; imageId?: string | null }
export interface LiveForm { text: string; minute: number | null; images: LiveImage[] }
export interface LiveEntry extends LiveForm { id: string; matchId: string; createdAt: string; updatedAt: string; corrected: boolean; version?: number }
export interface LivePage { entries: LiveEntry[]; nextCursor: string | null }
export interface LiveUploadedImage { id: string; entryId: string; name: string; size: number; mime: 'image/png' | 'image/jpeg'; width: number; height: number; url: string }
export interface LiveImageUpload { id: string; chunkSize: number; uploaded: number[] }
export type LiveImageConfig = NewsImageConfig
export type LiveImageCleanup = NewsImageCleanup
const invalid = (): never => { throw new ContentClientError('INVALID_RESPONSE', '直播服务返回异常，请重新读取。') }
const entryId = (v: unknown) => typeof v === 'string' && /^l_[a-f0-9]{32}$/.test(v)
const imageId = (v: unknown) => typeof v === 'string' && /^li_[a-f0-9]{32}$/.test(v)
const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max
const text = (v: unknown, max: number) => typeof v === 'string' && Array.from(v).length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v)
const iso = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v))
export function parseLiveEntry(v: any, admin = false): LiveEntry {
  if (!v || !entryId(v.id) || typeof v.matchId !== 'string' || !/^m_[a-f0-9]{32}$/.test(v.matchId) || !text(v.text, 1000) || v.minute !== null && !integer(v.minute, 150)
    || !Array.isArray(v.images) || v.images.length > 4 || !v.text.trim() && !v.images.length || !iso(v.createdAt) || !iso(v.updatedAt) || Date.parse(v.updatedAt) < Date.parse(v.createdAt)
    || typeof v.corrected !== 'boolean' || admin && (!integer(v.version) || !v.version || v.corrected !== (v.version > 1))) return invalid()
  const images: LiveImage[] = v.images.map((i: any) => {
    if (!i || !safeContentImage(i.url) || !text(i.caption, 100) || admin && i.imageId !== null && !imageId(i.imageId) || !admin && Object.prototype.hasOwnProperty.call(i, 'imageId')) return invalid()
    return { url: i.url, caption: i.caption, ...(admin ? { imageId: i.imageId } : {}) }
  })
  return { id: v.id, matchId: v.matchId, text: v.text, minute: v.minute, images, createdAt: v.createdAt, updatedAt: v.updatedAt, corrected: v.corrected, ...(admin ? { version: v.version } : {}) }
}
export function parseLivePage(v: any, admin = false, matchId?: string): LivePage {
  if (v?.ok !== true || !Array.isArray(v.entries) || v.entries.length > 20 || v.nextCursor !== null && (typeof v.nextCursor !== 'string' || v.nextCursor.length > 300 || !/^[A-Za-z0-9_-]+$/.test(v.nextCursor))) return invalid()
  const entries = v.entries.map((e: any) => parseLiveEntry(e, admin)) as LiveEntry[]
  if (new Set(entries.map(e => e.id)).size !== entries.length || entries.some(e => matchId && e.matchId !== matchId) || entries.some((e, i) => i > 0 && (e.createdAt > entries[i - 1].createdAt || e.createdAt === entries[i - 1].createdAt && e.id > entries[i - 1].id))) return invalid()
  return { entries, nextCursor: v.nextCursor }
}
export function parseLiveUploadedImage(v: any): LiveUploadedImage {
  if (!v || !imageId(v.id) || !entryId(v.entryId) || !text(v.name, 120) || !v.name.trim() || !integer(v.size, NEWS_IMAGE_MAX_BYTES) || !v.size || !['image/png', 'image/jpeg'].includes(v.mime)
    || !integer(v.width, 4096) || !integer(v.height, 4096) || !v.width || !v.height || v.width * v.height > 8_000_000 || !safeContentImage(v.url)) return invalid()
  return { id: v.id, entryId: v.entryId, name: v.name, size: v.size, mime: v.mime, width: v.width, height: v.height, url: v.url }
}
export function parseLiveImageUpload(v: any): LiveImageUpload {
  if (v?.ok !== true || !imageId(v.id) || v.chunkSize !== NEWS_IMAGE_CHUNK || !Array.isArray(v.uploaded) || v.uploaded.length > 32 || v.uploaded.some((i: unknown) => !integer(i, 31)) || new Set(v.uploaded).size !== v.uploaded.length) return invalid()
  return { id: v.id, chunkSize: v.chunkSize, uploaded: v.uploaded }
}
export function parseLiveImageCleanup(v: any): LiveImageCleanup {
  if (v?.ok !== true || typeof v.dryRun !== 'boolean' || !['scanned', 'eligibleObjects', 'removedObjects', 'protectedImages', 'deferredImages'].every(k => integer(v[k])) || v.scanned > 20 || v.protectedImages > v.scanned || v.deferredImages > v.scanned || v.removedObjects > v.eligibleObjects || v.dryRun && v.removedObjects !== 0 || v.nextCursor !== null && !imageId(v.nextCursor)) return invalid()
  return { dryRun: v.dryRun, scanned: v.scanned, eligibleObjects: v.eligibleObjects, removedObjects: v.removedObjects, protectedImages: v.protectedImages, deferredImages: v.deferredImages, nextCursor: v.nextCursor }
}
