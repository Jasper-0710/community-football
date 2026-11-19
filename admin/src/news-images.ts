import { ContentClientError } from '../../src/domain/content'
import { NEWS_IMAGE_MAX_BYTES } from '../../src/domain/news-image'
import type { AdminApi } from './api'
export interface NewsImageDraft { requestId: string; name: string; size: number; mime: 'image/png' | 'image/jpeg'; sha256: string; bytes: Uint8Array; progress: number }
function checkDimensions(bytes: Uint8Array, mime: 'image/png' | 'image/jpeg') {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0, height = 0
  if (mime === 'image/png' && bytes.length >= 33 && view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452) {
    width = view.getUint32(16); height = view.getUint32(20)
  } else if (mime === 'image/jpeg') {
    let offset = 2
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) break
      while (offset < bytes.length && bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue
      if (offset + 2 > bytes.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        if (length < 8) break
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break
      }
      offset += length
    }
  }
  if (!width || !height) throw new ContentClientError('INVALID_ARGUMENT','图片尺寸无法读取，请重新选择有效的JPG或PNG图片。')
  if (width > 4096 || height > 4096 || width * height > 8_000_000) throw new ContentClientError('INVALID_ARGUMENT',`图片尺寸为${width}×${height}，边长不能超过4096像素，总像素不能超过800万。请缩小图片后重新选择。`)
}
const requestId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')
export async function prepareNewsImage(file: Pick<File,'name'|'size'|'type'|'arrayBuffer'>): Promise<NewsImageDraft> {
  if (!file.size || file.size > NEWS_IMAGE_MAX_BYTES || Array.from(file.name).length > 120 || /[\\/<>:|?*\x00-\x1f\x7f]/u.test(file.name)) throw new ContentClientError('INVALID_ARGUMENT','请选择不超过2MB的JPG或PNG图片。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = bytes.slice(0,8).join(',') === '137,80,78,71,13,10,26,10' ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : null
  if (bytes.length !== file.size || !mime || file.type && file.type !== mime || (mime === 'image/png' ? !/\.png$/i.test(file.name) : !/\.jpe?g$/i.test(file.name))) throw new ContentClientError('INVALID_ARGUMENT','文件内容与格式不符，请选择有效的JPG或PNG图片。')
  checkDimensions(bytes, mime)
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n => n.toString(16).padStart(2,'0')).join('')
  return {requestId:requestId(),name:file.name,size:file.size,mime,sha256,bytes,progress:0}
}
function base64(bytes: Uint8Array) { let raw = ''; for (let i=0;i<bytes.length;i+=4096) raw += String.fromCharCode(...bytes.subarray(i,i+4096)); return btoa(raw) }
export async function uploadNewsImage(draft: NewsImageDraft, articleId: string, authorized: <T>(fn:(api:AdminApi,token:string)=>Promise<T>)=>Promise<T>, current:()=>boolean = ()=>true) {
  return uploadPreparedImage(draft, {
    prefix: 'ni',
    start: fields => authorized((api, token) => api.startNewsImage(token, { ...fields, articleId })),
    chunk: (id, index, data) => authorized((api, token) => api.newsImageChunk(token, id, index, data)),
    finish: id => authorized((api, token) => api.finishNewsImage(token, id)),
    matches: image => image.articleId === articleId,
  }, current)
}
export async function uploadPreparedImage<T extends { id: string; size: number; mime: string }>(draft: NewsImageDraft, transport: {
  prefix: string
  start(fields: {requestId: string; name: string; size: number; mime: 'image/png' | 'image/jpeg'; sha256: string}): Promise<{id: string; chunkSize: number; uploaded: number[]}>
  chunk(id: string, index: number, data: string): Promise<void>
  finish(id: string): Promise<T>
  matches(image: T): boolean
}, current: () => boolean = () => true): Promise<T> {
  const check = () => { if (!current()) throw new ContentClientError('CANCELLED','图片上传已取消。') }
  check()
  const {name,size,mime,sha256} = draft
  const startUpload = () => transport.start({requestId:draft.requestId,name,size,mime,sha256})
  let start
  try { start = await startUpload() }
  catch (e) {
    if (!e || typeof e !== 'object' || !('code' in e) || e.code !== 'UPLOAD_RESTART_REQUIRED') throw e
    check(); draft.requestId = requestId(); draft.progress = 0; start = await startUpload()
  }
  const count = Math.ceil(size/start.chunkSize)
  if (start.id !== `${transport.prefix}_${draft.requestId}` || start.uploaded.some(i=>i>=count)) throw new ContentClientError('INVALID_RESPONSE','图片上传状态异常，请重新选择。')
  let done = start.uploaded.length
  draft.progress = Math.floor(done/count*90)
  for (let index=0;index<count;index++) {
    check()
    if (start.uploaded.includes(index)) continue
    await transport.chunk(start.id,index,base64(draft.bytes.subarray(index*start.chunkSize,Math.min(size,(index+1)*start.chunkSize))))
    check(); done++; draft.progress = Math.floor(done/count*90)
  }
  check()
  const image = await transport.finish(start.id)
  check()
  if (!transport.matches(image) || image.id !== start.id || image.size !== size || image.mime !== mime) throw new ContentClientError('INVALID_RESPONSE','返回图片与本次上传不匹配。')
  draft.progress = 100
  return image
}
