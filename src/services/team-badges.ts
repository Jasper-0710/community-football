import { callWechatCloudFunction } from './wechat-cloud'
import { TeamClientError, teamRequestId } from '@/domain/team'
import { BADGE_MAX_BYTES, badgeMime, parseBadgeUpload, parseBadgeImage, parseBadgeReceipt } from '@/domain/team-badge'
export interface BadgeDraft { requestId:string; path:string; bytes:Uint8Array; mime:'image/png'|'image/jpeg'; progress:number; imageId?:string }
async function request(data:Record<string,unknown>) {
  let value:any
  try { value=await callWechatCloudFunction('teamManagement',data,data.action==='badges.finish'?65_000:20_000) }
  catch { throw new TeamClientError('SERVICE_UNAVAILABLE','暂时无法连接队徽服务。上传可重试；若刚刚保存，请重新读取球队确认结果。') }
  if(value?.ok!==true)throw new TeamClientError(value?.error?.code||'INVALID_RESPONSE',value?.error?.message||'队徽服务返回异常，请重试。')
  return value
}
export function createBadgeDraft(bytes:Uint8Array,path:string):BadgeDraft {
  if(!bytes.byteLength||bytes.byteLength>BADGE_MAX_BYTES)throw new TeamClientError('INVALID_ARGUMENT','处理后的队徽不能超过256KiB，请选择更小的图片。')
  return {requestId:teamRequestId(),path,bytes,mime:badgeMime(bytes),progress:0}
}
export async function chooseTeamBadge():Promise<BadgeDraft|null> {
  const path=await new Promise<string|null>((resolve,reject)=>uni.chooseImage({count:1,sizeType:['original'],sourceType:['album','camera'],success:r=>resolve(r.tempFilePaths[0]||null),fail:e=>String(e.errMsg).includes('cancel')?resolve(null):reject(new TeamClientError('CHOOSE_FAILED','暂时无法选择队徽，请重试。'))}))
  return path?prepareTeamBadge(path):null
}
export async function prepareTeamBadge(path:string):Promise<BadgeDraft> {
  const sizeOf=(filePath:string)=>new Promise<number>((resolve,reject)=>uni.getFileInfo({filePath,success:r=>resolve(r.size),fail:()=>reject(new TeamClientError('READ_FAILED','图片无法读取，请重新选择。'))}))
  const size=await sizeOf(path)
  if(!Number.isFinite(size)||size<=0||size>10*1024*1024)throw new TeamClientError('INVALID_ARGUMENT','请选择小于10MB的JPG或PNG队徽。')
  const info=await new Promise<UniApp.GetImageInfoSuccessData>((resolve,reject)=>uni.getImageInfo({src:path,success:resolve,fail:()=>reject(new TeamClientError('INVALID_ARGUMENT','图片无法打开，请重新选择JPG或PNG队徽。'))}))
  if(!['png','jpg','jpeg'].includes((info.type||'').toLowerCase())||![info.width,info.height].every(v=>Number.isFinite(v)&&v>0))throw new TeamClientError('INVALID_ARGUMENT','队徽仅支持JPG或PNG图片。')
  let preview=path,outputSize=size
  const edge=Math.max(info.width,info.height)
  for(const [target,quality] of [[512,85],[384,70],[256,50]]) {
    if(outputSize<=BADGE_MAX_BYTES&&(preview!==path||edge<=512))break
    const ratio=Math.min(1,target/edge)
    preview=await new Promise<string>((resolve,reject)=>uni.compressImage({src:path,compressedWidth:Math.max(1,Math.round(info.width*ratio)),compressedHeight:Math.max(1,Math.round(info.height*ratio)),quality,success:r=>resolve(r.tempFilePath),fail:()=>reject(new TeamClientError('COMPRESS_FAILED','队徽处理失败，请换一张JPG或PNG图片。'))}))
    outputSize=await sizeOf(preview)
  }
  if(outputSize>BADGE_MAX_BYTES)throw new TeamClientError('INVALID_ARGUMENT','队徽压缩后仍超过256KiB，请选择更小的图片。')
  const contents=await new Promise<ArrayBuffer>((resolve,reject)=>uni.getFileSystemManager().readFile({filePath:preview,success:r=>r.data instanceof ArrayBuffer?resolve(r.data):reject(new TeamClientError('READ_FAILED','队徽读取失败，请重新选择。')),fail:()=>reject(new TeamClientError('READ_FAILED','队徽读取失败，请重新选择。'))}))
  return createBadgeDraft(new Uint8Array(contents),preview)
}
export async function uploadTeamBadge(teamId:string,draft:BadgeDraft,current:()=>boolean=()=>true) {
  const check=()=>{if(!current())throw new TeamClientError('CANCELLED','队徽上传已取消。')}
  check()
  const size=draft.bytes.byteLength,start=parseBadgeUpload(await request({action:'badges.start',teamId,requestId:draft.requestId,size,mime:draft.mime}),size)
  if(start.id!==`tb_${draft.requestId}`)throw new TeamClientError('INVALID_RESPONSE','队徽上传标识不匹配。')
  const count=Math.ceil(size/start.chunkSize);let done=start.uploaded.length
  draft.progress=Math.floor(done/count*90)
  for(let index=0;index<count;index++) {
    check();if(start.uploaded.includes(index))continue
    const part=draft.bytes.slice(index*start.chunkSize,(index+1)*start.chunkSize)
    const result=await request({action:'badges.chunk',id:start.id,index,data:uni.arrayBufferToBase64(part.buffer)})
    if(result.index!==index)throw new TeamClientError('INVALID_RESPONSE','队徽分片回执异常，请重试。')
    check();draft.progress=Math.floor(++done/count*90)
  }
  check()
  const image=parseBadgeImage((await request({action:'badges.finish',id:start.id})).image)
  check()
  if(image.teamId!==teamId||image.id!==start.id||image.size!==size||image.mime!==draft.mime)throw new TeamClientError('INVALID_RESPONSE','返回队徽与本次上传不匹配。')
  draft.imageId=image.id;draft.progress=100
  return image
}
export async function saveTeamBadge(teamId:string,expectedVersion:number,id:string) { return parseBadgeReceipt(await request({action:'badges.save',teamId,expectedVersion,id}),teamId,expectedVersion) }
export async function removeTeamBadge(teamId:string,expectedVersion:number) { return parseBadgeReceipt(await request({action:'badges.remove',teamId,expectedVersion}),teamId,expectedVersion) }
