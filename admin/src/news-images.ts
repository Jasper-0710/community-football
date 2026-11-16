import { ContentClientError } from '../../src/domain/content'
import { NEWS_IMAGE_MAX_BYTES } from '../../src/domain/news-image'
import type { AdminApi } from './api'
export interface NewsImageDraft { requestId: string; name: string; size: number; mime: 'image/png' | 'image/jpeg'; sha256: string; bytes: Uint8Array; progress: number }
export async function prepareNewsImage(file: Pick<File,'name'|'size'|'type'|'arrayBuffer'>): Promise<NewsImageDraft> {
  if (!file.size || file.size > NEWS_IMAGE_MAX_BYTES || Array.from(file.name).length > 120 || /[\\/<>:|?*\x00-\x1f\x7f]/u.test(file.name)) throw new ContentClientError('INVALID_ARGUMENT','请选择不超过2MB的JPG或PNG图片。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = bytes.slice(0,8).join(',') === '137,80,78,71,13,10,26,10' ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : null
  if (bytes.length !== file.size || !mime || file.type && file.type !== mime || (mime === 'image/png' ? !/\.png$/i.test(file.name) : !/\.jpe?g$/i.test(file.name))) throw new ContentClientError('INVALID_ARGUMENT','文件内容与格式不符，请选择有效的JPG或PNG图片。')
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n => n.toString(16).padStart(2,'0')).join('')
  return {requestId:Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join(''),name:file.name,size:file.size,mime,sha256,bytes,progress:0}
}
function base64(bytes: Uint8Array) { let raw = ''; for (let i=0;i<bytes.length;i+=4096) raw += String.fromCharCode(...bytes.subarray(i,i+4096)); return btoa(raw) }
export async function uploadNewsImage(draft: NewsImageDraft, articleId: string, authorized: <T>(fn:(api:AdminApi,token:string)=>Promise<T>)=>Promise<T>, current:()=>boolean = ()=>true) {
  const check = () => { if (!current()) throw new ContentClientError('CANCELLED','图片上传已取消。') }
  check()
  const {requestId,name,size,mime,sha256} = draft
  const start = await authorized((api,token)=>api.startNewsImage(token,{articleId,requestId,name,size,mime,sha256}))
  const count = Math.ceil(size/start.chunkSize)
  if (start.id !== `ni_${requestId}` || start.uploaded.some(i=>i>=count)) throw new ContentClientError('INVALID_RESPONSE','图片上传状态异常，请重新选择。')
  let done = start.uploaded.length
  draft.progress = Math.floor(done/count*90)
  for (let index=0;index<count;index++) {
    check()
    if (start.uploaded.includes(index)) continue
    await authorized((api,token)=>api.newsImageChunk(token,start.id,index,base64(draft.bytes.subarray(index*start.chunkSize,Math.min(size,(index+1)*start.chunkSize)))))
    check(); done++; draft.progress = Math.floor(done/count*90)
  }
  check()
  const image = await authorized((api,token)=>api.finishNewsImage(token,start.id))
  check()
  if (image.articleId !== articleId || image.id !== start.id || image.size !== size || image.mime !== mime) throw new ContentClientError('INVALID_RESPONSE','返回图片与本次上传不匹配。')
  draft.progress = 100
  return image
}
