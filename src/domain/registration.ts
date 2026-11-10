import {parseRegistrationConfig,parseRegistrationStats,type RegistrationConfig,type RegistrationStats} from './competition'
import {teamDistricts} from './team'
export const registrationStates={pending:'待审核',approved:'已通过',rejected:'已驳回',cancelled:'已撤销'} as const
export type RegistrationState=keyof typeof registrationStates
export interface RegistrationForm {teamName:string;district:string;project:string;leaderName:string;contactPhone:string}
export interface RegistrationFile {id:string;name:string;size:number;extension:string}
export interface RegistrationSummary {id:string;competitionId:string;teamId:string;competitionName:string;teamName:string;district:string;project:string;status:RegistrationState;version:number;attachmentCount:number;createdAt:string;submittedAt:string;updatedAt:string}
export interface RegistrationPlayerRules {minPlayers:number;maxPlayers:number;rulesVersion:number}
export interface RegistrationDetail extends RegistrationSummary {form:RegistrationForm;attachments:RegistrationFile[];review:{decision:'approved'|'rejected';reason:string;playerCount:number|null;reviewedAt:string;rules:RegistrationPlayerRules|null}|null;reviewRules:RegistrationPlayerRules|null;requirements:string;minPlayers:number;maxPlayers:number;history:{status:RegistrationState;actor:'leader'|'admin';at:string;reason:string}[]}
export interface RegistrationPreparation {team:{id:string;name:string;district:string;contactPhone:string}|null;registration:RegistrationDetail|null;uploadsEnabled:boolean;serverTime:string;competition:{id:string;name:string;registrationEnabled:boolean;registrationStartAt:string|null;registrationEndAt:string|null;registrationConfig:RegistrationConfig|null;rulesVersion:number;registrationStats:RegistrationStats}}
export class RegistrationClientError extends Error {constructor(public code:string,message:string){super(message);this.name='RegistrationClientError'}}
const bad=()=>{throw new RegistrationClientError('INVALID_RESPONSE','报名服务返回异常，请重新读取。')}
const iso=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))
const status=(v:unknown)=>typeof v==='string'&&Object.prototype.hasOwnProperty.call(registrationStates,v)
const strings=(v:any,keys:string[])=>keys.every(k=>typeof v?.[k]==='string'&&v[k].trim())
export function parseRegistrationFile(f:any):RegistrationFile {
 if(!f||typeof f.id!=='string'||!/^f_[a-f0-9]{32}$/.test(f.id)||typeof f.name!=='string'||!f.name.trim()||!Number.isSafeInteger(f.size)||f.size<1||f.size>10*1024*1024||!['pdf','png','jpg','jpeg','docx','xlsx'].includes(f.extension))bad()
 return {id:f.id,name:f.name,size:f.size,extension:f.extension}
}
export function parseRegistrationSummary(r:any):RegistrationSummary {
 if(!r||!/^r_[a-f0-9]{64}$/.test(r.id)||!/^c_[a-f0-9]{32}$/.test(r.competitionId)||!/^t_[a-f0-9]{64}$/.test(r.teamId)||!strings(r,['competitionName','teamName','district','project'])||!status(r.status)||!Number.isSafeInteger(r.version)||r.version<1||!Number.isSafeInteger(r.attachmentCount)||r.attachmentCount<1||r.attachmentCount>5||![r.createdAt,r.submittedAt,r.updatedAt].every(iso))bad()
 return {id:r.id,competitionId:r.competitionId,teamId:r.teamId,competitionName:r.competitionName,teamName:r.teamName,district:r.district,project:r.project,status:r.status,version:r.version,attachmentCount:r.attachmentCount,createdAt:r.createdAt,submittedAt:r.submittedAt,updatedAt:r.updatedAt}
}
function parsePlayerRules(r:any):RegistrationPlayerRules|null {
 if(r==null)return null
 if(![r.minPlayers,r.maxPlayers].every(n=>Number.isSafeInteger(n)&&n>0&&n<=200)||r.minPlayers>r.maxPlayers||!Number.isSafeInteger(r.rulesVersion)||r.rulesVersion<1)bad()
 return {minPlayers:r.minPlayers,maxPlayers:r.maxPlayers,rulesVersion:r.rulesVersion}
}
export function parseRegistration(r:any):RegistrationDetail {
 const base=parseRegistrationSummary(r)
 if(!strings(r.form,['teamName','district','project','leaderName','contactPhone'])||!teamDistricts.includes(r.form.district)||!Array.isArray(r.attachments)||r.attachments.length!==base.attachmentCount||typeof r.requirements!=='string'||![r.minPlayers,r.maxPlayers].every(n=>Number.isSafeInteger(n)&&n>0&&n<=200)||r.minPlayers>r.maxPlayers||!Array.isArray(r.history)||r.history.length>20||r.history.some((h:any)=>!status(h.status)||!['leader','admin'].includes(h.actor)||!iso(h.at)||typeof h.reason!=='string'))bad()
 const attachments=r.attachments.map(parseRegistrationFile);if(new Set(attachments.map((a:RegistrationFile)=>a.id)).size!==attachments.length)bad()
 const review=r.review,reviewRules=parsePlayerRules(r.reviewRules),decidedRules=parsePlayerRules(review?.rules)
 const approvedRange=decidedRules||{minPlayers:r.minPlayers,maxPlayers:r.maxPlayers}
 if(review!==null&&(!review||!['approved','rejected'].includes(review.decision)||typeof review.reason!=='string'||!iso(review.reviewedAt)||review.decision==='approved'&&(!Number.isSafeInteger(review.playerCount)||review.playerCount<approvedRange.minPlayers||review.playerCount>approvedRange.maxPlayers)||review.decision==='rejected'&&(!review.reason.trim()||review.playerCount!==null)))bad()
 if((base.status==='approved'||base.status==='rejected')&&review?.decision!==base.status)bad()
 return {...base,form:{teamName:r.form.teamName,district:r.form.district,project:r.form.project,leaderName:r.form.leaderName,contactPhone:r.form.contactPhone},attachments,review:review?{decision:review.decision,reason:review.reason,playerCount:review.playerCount,reviewedAt:review.reviewedAt,rules:decidedRules}:null,reviewRules,requirements:r.requirements,minPlayers:r.minPlayers,maxPlayers:r.maxPlayers,history:r.history.map((h:any)=>({status:h.status,actor:h.actor,at:h.at,reason:h.reason}))}
}
export function parseRegistrationPage(v:any){
 if(!v||!Array.isArray(v.registrations)||v.registrations.length>20||v.nextCursor!==null&&(typeof v.nextCursor!=='string'||!/^r_[a-f0-9]{64}$/.test(v.nextCursor)))bad()
 return {registrations:v.registrations.map(parseRegistrationSummary),nextCursor:v.nextCursor as string|null}
}
export function parsePreparation(v:any):RegistrationPreparation {
 const c=v?.competition,t=v?.team
 if(!c||!/^c_[a-f0-9]{32}$/.test(c.id)||typeof c.name!=='string'||!c.name||typeof c.registrationEnabled!=='boolean'||![c.registrationStartAt,c.registrationEndAt].every(d=>d===null||iso(d))||!Number.isSafeInteger(c.rulesVersion)||c.rulesVersion<1||typeof v.uploadsEnabled!=='boolean'||!iso(v.serverTime)||t!==null&&(!strings(t,['id','name','district','contactPhone'])||!/^t_[a-f0-9]{64}$/.test(t.id)))bad()
 return {team:t?{id:t.id,name:t.name,district:t.district,contactPhone:t.contactPhone}:null,registration:v.registration===null?null:parseRegistration(v.registration),uploadsEnabled:v.uploadsEnabled,serverTime:v.serverTime,competition:{id:c.id,name:c.name,registrationEnabled:c.registrationEnabled,registrationStartAt:c.registrationStartAt,registrationEndAt:c.registrationEndAt,registrationConfig:parseRegistrationConfig(c.registrationConfig),rulesVersion:c.rulesVersion,registrationStats:parseRegistrationStats(c.registrationStats)}}
}
export function parseFileLink(v:any){
 let u:URL;try{u=new URL(v.url)}catch{return bad()}
 if(u.protocol!=='https:'||u.username||u.password||typeof v.name!=='string'||!['pdf','png','jpg','jpeg','docx','xlsx'].includes(v.extension))bad()
 return {url:u.href,name:v.name as string,extension:v.extension as string}
}
export const fileSize=(bytes:number)=>bytes>=1024*1024?`${(bytes/1024/1024).toFixed(1)} MB`:`${Math.max(1,Math.ceil(bytes/1024))} KB`
