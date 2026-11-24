'use strict'
const {createHash}=require('node:crypto')
const TEAM=/^t_[a-f0-9]{64}$/, PLAYER=/^p_[a-f0-9]{32}$/, USER=/^[a-f0-9]{64}$/, REQUEST=/^[a-f0-9]{32}$/
const APP_ID='wx3230f06c755cef3a'
const DISTRICTS=['黄浦区','徐汇区','长宁区','静安区','普陀区','虹口区','杨浦区','浦东新区','闵行区','宝山区','嘉定区','金山区','松江区','青浦区','奉贤区','崇明区']
const POSITIONS=['goalkeeper','defender','midfielder','forward']
class TeamError extends Error {constructor(code,message){super(message);this.code=code}}
function fail(code,message){throw new TeamError(code,message)}
function fields(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))fail('INVALID_ARGUMENT','请求包含不支持的字段。')}
function text(v,label,max,required=true,multiline=false){
 if(typeof v!=='string'||/[\p{Cf}\p{Cs}]/u.test(v)||(multiline?/[\u0000-\u0008\u000b-\u001f\u007f]/:/[\p{Cc}]/u).test(v))fail('INVALID_ARGUMENT',`${label}格式不正确。`)
 const s=v.trim();if(required&&!s||Array.from(s).length>max)fail('INVALID_ARGUMENT',`${label}${required?'不能为空，且':''}最多${max}个字。`);return s
}
function teamForm(v){
 fields(v,['name','district','description','contactPhone'])
 const form={name:text(v.name,'队名',40),district:v.district,description:text(v.description,'球队介绍',500,false,true),contactPhone:text(v.contactPhone,'联系电话',30)}
 if(!DISTRICTS.includes(form.district))fail('INVALID_ARGUMENT','请选择所属区。')
 if(!/^\+?[\d()\s-]+$/.test(form.contactPhone)||!/^\d{7,15}$/.test(form.contactPhone.replace(/[+()\s-]/g,'')))fail('INVALID_ARGUMENT','请输入有效联系电话，支持手机号、座机及国际区号。')
 return form
}
function playerForm(v){
 fields(v,['name','number','position']);const p={name:text(v.name,'球员姓名',30),number:v.number,position:v.position}
 if(!Number.isInteger(p.number)||p.number<1||p.number>99)fail('INVALID_ARGUMENT','球衣号码须为1–99的整数。')
 if(!POSITIONS.includes(p.position))fail('INVALID_ARGUMENT','请选择球员位置。');return p
}
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const realUser=u=>!!u&&u.appId===APP_ID&&typeof u.openId==='string'&&!!u.openId&&u._id===createHash('sha256').update(`${APP_ID}:${u.openId}`).digest('hex')
const synthetic=t=>t?.fixture?.synthetic===true&&typeof t.fixture.batchId==='string'&&!!t.fixture.batchId&&t.fixture.source==='developer-prepared; no real user submission or review'
const publicPlayer=p=>({id:p.id,name:p.name,number:p.number,position:p.position})
module.exports={TEAM,PLAYER,USER,REQUEST,APP_ID,DISTRICTS,POSITIONS,TeamError,fail,fields,text,teamForm,playerForm,digest,realUser,synthetic,publicPlayer}
