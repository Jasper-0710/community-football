'use strict'
const {createHash}=require('node:crypto')
const CID=/^c_[a-f0-9]{32}$/, RID=/^r_[a-f0-9]{64}$/, FID=/^f_[a-f0-9]{32}$/, REQUEST=/^[a-f0-9]{32}$/
class RegistrationError extends Error { constructor(code,message){super(message);this.code=code} }
const fail=(code,message)=>{throw new RegistrationError(code,message)}
function fields(v,allowed){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))fail('INVALID_ARGUMENT','请求包含不支持的字段。')}
function text(v,label,max){if(typeof v!=='string'||!v.trim()||Array.from(v.trim()).length>max||/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(v))fail('INVALID_ARGUMENT',`请正确填写${label}（最多${max}字）。`);return v.trim()}
const registrationId=(competitionId,teamId)=>'r_'+createHash('sha256').update(`${competitionId}:${teamId}`).digest('hex')
const fingerprint=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const occupied=status=>['pending','approved'].includes(status)
function stats(c){const s=c.registrationStats||{pending:0,approved:0,occupied:0};if(!['pending','approved','occupied'].every(k=>Number.isSafeInteger(s[k])&&s[k]>=0)||s.occupied!==s.pending+s.approved)throw new Error('Invalid registration counters');return {...s}}
function transition(c,previous,next){const s=stats(c);if(occupied(previous)){s[previous]--;s.occupied--}if(occupied(next)){s[next]++;s.occupied++}if(Object.values(s).some(n=>n<0))throw new Error('Invalid registration counters');if(c.registrationConfig?.teamLimit!=null&&s.occupied>c.registrationConfig.teamLimit)fail('CAPACITY_FULL','当前球队名额已满，请关注后续空余名额。');return {...c,registrationStats:s,registrationMutationVersion:(c.registrationMutationVersion||0)+1}}
function open(c,time){if(!c||!c.displayEnabled)fail('NOT_FOUND','赛事不存在或暂未公开。');if(!c.registrationEnabled||!c.registrationStartAt||!c.registrationEndAt||time<Date.parse(c.registrationStartAt)||time>=Date.parse(c.registrationEndAt))fail('REGISTRATION_CLOSED','当前不在报名开放时间内。');if(!c.registrationConfig)fail('NOT_CONFIGURED','本赛事报名安排尚未完善，请稍后再试。')}
function beforeDeadline(c,time){if(!c?.registrationEndAt||time>=Date.parse(c.registrationEndAt))fail('REGISTRATION_LOCKED','报名已截止，资料与撤销操作已锁定。')}
function summary(r){return {id:r._id,competitionId:r.competitionId,teamId:r.teamId,competitionName:r.competitionSnapshot.name,teamName:r.form.teamName,district:r.form.district,project:r.form.project,status:r.status,version:r.version,attachmentCount:r.attachments.length,createdAt:r.createdAt,submittedAt:r.submittedAt,updatedAt:r.updatedAt}}
function fileView(f){return {id:f.id||f._id,name:f.name,size:f.size,extension:f.extension}}
function detail(r){return {...summary(r),form:{...r.form},attachments:r.attachments.map(fileView),review:r.review?{decision:r.review.decision,reason:r.review.reason,playerCount:r.review.playerCount,reviewedAt:r.review.reviewedAt}:null,requirements:r.competitionSnapshot.requirements,minPlayers:r.competitionSnapshot.minPlayers,maxPlayers:r.competitionSnapshot.maxPlayers,history:(r.history||[]).map(x=>({...x}))}}
function history(r,status,actor,time,reason=''){return [...(r?.history||[]),{status,actor,at:time,reason}].slice(-20)}
const errorResult=(error,logger)=>{if(error instanceof RegistrationError)return {ok:false,error:{code:error.code,message:error.message}};logger?.error?.('[registrations] operation failed');return {ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'报名服务暂不可用。若刚刚提交，请重新读取报名记录确认结果。'}}}
module.exports={CID,RID,FID,REQUEST,RegistrationError,fail,fields,text,registrationId,fingerprint,occupied,stats,transition,open,beforeDeadline,summary,fileView,detail,history,errorResult}
