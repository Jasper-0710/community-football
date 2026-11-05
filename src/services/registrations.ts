import {callWechatCloudFunction,WechatCloudError} from './wechat-cloud'
import {parseRegistration,parseRegistrationPage,parsePreparation,parseRegistrationFile,parseFileLink,RegistrationClientError,type RegistrationForm,type RegistrationFile} from '@/domain/registration'
import {teamRequestId} from '@/domain/team'
declare const wx:any
async function request(data:Record<string,unknown>):Promise<any>{
 let value:any
 try{value=await callWechatCloudFunction('teamManagement',data,data.action==='files.finish'?65_000:20_000)}catch(e){
  if(e instanceof WechatCloudError&&e.code==='UNSUPPORTED')throw new RegistrationClientError('UNSUPPORTED','请在微信小程序中报名。')
  throw new RegistrationClientError('SERVICE_UNAVAILABLE','暂时无法连接报名服务。若刚刚提交，请重新读取记录确认结果。')
 }
 if(value?.ok!==true)throw new RegistrationClientError(value?.error?.code||'INVALID_RESPONSE',value?.error?.message||'报名服务返回异常，请重新读取。')
 return value
}
export async function prepareRegistration(competitionId:string){return parsePreparation(await request({action:'registrations.prepare',competitionId}))}
export async function listMyRegistrations(cursor?:string){return parseRegistrationPage(await request({action:'registrations.listMine',...(cursor?{cursor}:{})}))}
export async function getMyRegistration(id:string){const r=await request({action:'registrations.getMine',id});if(typeof r.locked!=='boolean'||r.deadline!==null&&(typeof r.deadline!=='string'||!Number.isFinite(Date.parse(r.deadline))))throw new RegistrationClientError('INVALID_RESPONSE','报名时间返回异常。');return {registration:parseRegistration(r.registration),locked:r.locked,deadline:r.deadline as string|null}}
export async function submitRegistration(competitionId:string,expectedVersion:number,rulesVersion:number,requestId:string,form:RegistrationForm,attachmentIds:string[]){return parseRegistration((await request({action:'registrations.submit',competitionId,expectedVersion,rulesVersion,requestId,form,attachmentIds})).registration)}
export async function cancelRegistration(id:string,expectedVersion:number,requestId:string){return parseRegistration((await request({action:'registrations.cancel',id,expectedVersion,requestId})).registration)}
export async function registrationFileLink(id:string,fileId:string){return parseFileLink(await request({action:'registrations.fileLink',id,fileId}))}
export interface UploadDraft {requestId:string;path:string;name:string;size:number;id?:string;progress:number;file?:RegistrationFile;error:string;existing?:boolean}
export async function chooseRegistrationFiles(count:number):Promise<UploadDraft[]>{
 // #ifdef MP-WEIXIN
 return new Promise((resolve,reject)=>wx.chooseMessageFile({count:Math.min(5,count),type:'file',extension:['pdf','jpg','jpeg','png','docx','xlsx'],success:(r:any)=>resolve(r.tempFiles.map((f:any)=>({requestId:teamRequestId(),path:f.path,name:f.name,size:f.size,progress:0,error:''}))),fail:(e:any)=>String(e.errMsg).includes('cancel')?resolve([]):reject(new Error('暂时无法选择文件，请重试。'))}))
 // #endif
 // #ifndef MP-WEIXIN
 throw new RegistrationClientError('UNSUPPORTED','请在微信小程序中选择报名材料。')
 // #endif
}
export async function uploadRegistrationFile(competitionId:string,draft:UploadDraft):Promise<void>{
 if(draft.size<1||draft.size>10*1024*1024||!['pdf','jpg','jpeg','png','docx','xlsx'].includes(draft.name.split('.').pop()?.toLowerCase()||''))throw new Error('附件支持 PDF、JPG、PNG、DOCX、XLSX，每个不超过10MB。')
 const start=await request({action:'files.start',competitionId,requestId:draft.requestId,name:draft.name,size:draft.size})
 if(typeof start.id!=='string'||!/^f_[a-f0-9]{32}$/.test(start.id)||start.chunkSize!==192*1024||!Array.isArray(start.uploaded))throw new RegistrationClientError('INVALID_RESPONSE','附件上传服务返回异常。')
 draft.id=start.id
 for(let i=0;i<Math.ceil(draft.size/start.chunkSize);i++){
  if(!start.uploaded.includes(i)){
   let data=''
   // #ifdef MP-WEIXIN
   data=await new Promise<string>((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:draft.path,encoding:'base64',position:i*start.chunkSize,length:Math.min(start.chunkSize,draft.size-i*start.chunkSize),success:(r:any)=>resolve(r.data),fail:()=>reject(new Error('文件读取失败，请移除后重新选择。'))}))
   // #endif
   await request({action:'files.chunk',id:draft.id,index:i,data})
  }
  draft.progress=Math.round(Math.min(draft.size,(i+1)*start.chunkSize)/draft.size*95)
 }
 draft.file=parseRegistrationFile((await request({action:'files.finish',id:draft.id})).file);draft.progress=100;draft.error=''
}
export async function discardRegistrationFile(id:string){await request({action:'files.discard',id})}
export async function openRegistrationFile(id:string,fileId:string){
 const link=await registrationFileLink(id,fileId)
 // #ifdef MP-WEIXIN
 if(['png','jpg','jpeg'].includes(link.extension)){await new Promise<void>((resolve,reject)=>wx.previewImage({current:link.url,urls:[link.url],success:()=>resolve(),fail:()=>reject(new Error('图片打开失败，请重试。'))}));return}
 const path=await new Promise<string>((resolve,reject)=>wx.downloadFile({url:link.url,success:(r:any)=>r.statusCode===200?resolve(r.tempFilePath):reject(new Error('材料下载失败，请重试。')),fail:()=>reject(new Error('材料下载失败，请重试。'))}))
 try{await new Promise<void>((resolve,reject)=>wx.openDocument({filePath:path,fileType:link.extension,showMenu:true,success:()=>resolve(),fail:()=>reject(new Error('材料打开失败，请确认文件格式。'))}))}finally{wx.getFileSystemManager().unlink({filePath:path,fail:()=>{}})}
 // #endif
 // #ifndef MP-WEIXIN
 throw new RegistrationClientError('UNSUPPORTED','请在微信小程序中查看材料。')
 // #endif
}
