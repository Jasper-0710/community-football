'use strict'
const { createHash } = require('node:crypto')
const APP_ID = 'wx3230f06c755cef3a'
const DISTRICTS = ['黄浦区','徐汇区','长宁区','静安区','普陀区','虹口区','杨浦区','浦东新区','闵行区','宝山区','嘉定区','金山区','松江区','青浦区','奉贤区','崇明区']
const POSITIONS = ['goalkeeper','defender','midfielder','forward']
const PLAYER_ID = /^p_[a-f0-9]{32}$/
class TeamError extends Error { constructor(code, message) { super(message); this.code = code } }
function fail(code, message) { throw new TeamError(code, message) }
function fields(v, keys) { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) fail('INVALID_ARGUMENT', '请求包含不支持的字段。') }
function text(v, label, max, required = true, multiline = false) {
  if (typeof v !== 'string' || /[\p{Cf}\p{Cs}]/u.test(v) || (multiline ? /[\u0000-\u0008\u000b-\u001f\u007f]/ : /[\p{Cc}]/u).test(v)) fail('INVALID_ARGUMENT', `${label}格式不正确。`)
  const s = v.trim()
  if (required && !s || Array.from(s).length > max) fail('INVALID_ARGUMENT', `${label}${required ? '不能为空，且' : ''}最多${max}个字。`)
  return s
}
function teamForm(v) {
  fields(v, ['name','district','description','contactPhone'])
  const form = { name: text(v.name, '队名', 40), district: v.district, description: text(v.description, '球队介绍', 500, false, true), contactPhone: text(v.contactPhone, '联系电话', 30) }
  if (!DISTRICTS.includes(form.district)) fail('INVALID_ARGUMENT', '请选择所属区。')
  // Permit mobile/landline/international numbers; no assumption that every leader has a mainland mobile.
  const digits = form.contactPhone.replace(/[+()\s-]/g, '')
  if (!/^\+?[\d()\s-]+$/.test(form.contactPhone) || !/^\d{7,15}$/.test(digits)) fail('INVALID_ARGUMENT', '请输入有效联系电话，支持手机号、座机及国际区号。')
  return form
}
function playerForm(v) {
  fields(v, ['name','number','position'])
  const p = { name: text(v.name, '球员姓名', 30), number: v.number, position: v.position }
  if (!Number.isInteger(p.number) || p.number < 1 || p.number > 99) fail('INVALID_ARGUMENT', '球衣号码须为1–99的整数。')
  if (!POSITIONS.includes(p.position)) fail('INVALID_ARGUMENT', '请选择球员位置。')
  return p
}
function userId(appId, openId) { return createHash('sha256').update(`${appId}:${openId}`).digest('hex') }
function publicPlayer(p) { return { id:p.id, name:p.name, number:p.number, position:p.position } }
function result(team, user) {
  return { id:team._id, name:team.name, district:team.district, description:team.description, contactPhone:team.contactPhone,
    status:team.status||'active', dissolvedAt:team.dissolvedAt||null,
    leaderNickname:user.nickname, version:team.version, playerCount:team.roster.length, players:team.roster.map(publicPlayer).sort((a,b)=>a.number-b.number),
    badgeUploadEnabled:false, badgeUrl:'', createdAt:team.createdAt, updatedAt:team.updatedAt }
}
function version(v) { if (!Number.isSafeInteger(v) || v < 1) fail('INVALID_ARGUMENT', '球队版本无效，请重新读取资料。') }
function sameVersion(team, v) { if (team.version !== v) fail('CONFLICT', '球队已在其他页面更新，请重新读取后再操作。') }
function assertTeam(team, uid) {
  if (!team || team.leaderUserId !== uid || team.schemaVersion !== 1 || !Array.isArray(team.roster) || ![undefined,'active'].includes(team.status)) fail('SERVICE_UNAVAILABLE', '球队资料暂不可用，请联系平台负责人。')
}
/** All changes to the team, roster, player archives, owner binding and role commit together. */
function createTeamService({ store, context, expectedAppId = APP_ID, now = () => new Date().toISOString(), logger = console }) {
  return async event => {
    try {
      const identity = context()
      if (!identity?.OPENID || typeof identity.OPENID !== 'string' || identity.APPID !== expectedAppId) fail('AUTH_REQUIRED', '请在微信小程序中登录后管理球队。')
      const uid = userId(identity.APPID, identity.OPENID)
      const action = event?.action
      const actions = { mine:[], create:['requestId','form'], update:['expectedVersion','form'], savePlayer:['expectedVersion','id','form'], removePlayer:['expectedVersion','id'], checkDissolution:['expectedVersion'], dissolve:['expectedVersion','confirmName'] }
      const extras = Object.hasOwn(actions, action) ? actions[action] : null
      if (!extras) fail('INVALID_ARGUMENT', '不支持的球队操作。')
      fields(event, ['action','userInfo','tcbContext',...extras])
      const form = ['create','update'].includes(action) ? teamForm(event.form) : action === 'savePlayer' ? playerForm(event.form) : null
      if (action === 'create' && (typeof event.requestId !== 'string' || !/^[a-f0-9]{32}$/.test(event.requestId))) fail('INVALID_ARGUMENT', '创建请求无效，请重新打开表单。')
      if (['update','savePlayer','removePlayer','checkDissolution','dissolve'].includes(action)) version(event.expectedVersion)
      if (action === 'dissolve') text(event.confirmName,'确认队名',40)
      if (['savePlayer','removePlayer'].includes(action) && (typeof event.id !== 'string' || !PLAYER_ID.test(event.id))) fail('INVALID_ARGUMENT', '球员标识无效，请重新读取名单。')
      return await store.transaction(async tx => {
        const user = await tx.get('users', uid)
        if (!user || user.appId !== identity.APPID || user.openId !== identity.OPENID) fail('AUTH_REQUIRED', '请先登录个人中心。')
        const binding = await tx.get('leaderTeamBindings', uid)
        let team = binding?.teamId ? await tx.get('teams', binding.teamId) : null
        if (binding?.teamId) assertTeam(team, uid)
        if (action === 'mine') return { ok:true, team:team ? result(team, user) : null, badgeUploadEnabled:false }
        const timestamp = now()
        if (action === 'create') {
          if (!user.nickname?.trim()) fail('PROFILE_REQUIRED', '请先在个人中心填写昵称，再创建球队。')
          const fingerprint = createHash('sha256').update(JSON.stringify(form)).digest('hex')
          if (team) {
            if (team.creationRequestId !== event.requestId || team.creationFingerprint !== fingerprint) fail('ALREADY_EXISTS', '你已经管理一支球队，请返回查看我的球队。')
            return { ok:true, team:result(team,user), created:false }
          }
          const legacyId = 't_' + uid
          const nextId = 't_' + createHash('sha256').update(`${uid}:${event.requestId}`).digest('hex')
          const legacy = await tx.get('teams', legacyId)
          if (legacy?.creationRequestId === event.requestId || await tx.get('teams', nextId)) fail('CONFLICT', '此建队请求已使用，请重新打开创建表单。')
          if (legacy && !binding) fail('SERVICE_UNAVAILABLE','球队归属资料暂不可用，请联系平台负责人。')
          if (binding && (!Number.isSafeInteger(binding.lastTeamVersion) || binding.lastTeamVersion < 1)) fail('SERVICE_UNAVAILABLE','球队归属资料暂不可用，请联系平台负责人。')
          const id = binding ? nextId : legacyId
          team = { _id:id, schemaVersion:1, status:'active', leaderUserId:uid, ...form, badgeFileId:'', roster:[], version:(binding?.lastTeamVersion||0)+1,
            creationRequestId:event.requestId, creationFingerprint:fingerprint, createdAt:timestamp, updatedAt:timestamp }
          await tx.set('teams',id,team)
          await tx.set('leaderTeamBindings',uid,{teamId:id,createdAt:timestamp})
          await tx.set('users',uid,{...user,role:user.role === 'admin' ? 'admin' : 'leader',phone:form.contactPhone,updatedAt:timestamp})
          return { ok:true, team:result(team,user), created:true }
        }
        if (!team && action==='dissolve' && binding?.lastDissolution?.expectedVersion===event.expectedVersion && binding.lastDissolution.name===event.confirmName) return {ok:true,team:null,dissolved:true}
        if (!team) fail('NOT_FOUND', '请先创建球队，再维护球队与球员资料。')
        if (action === 'checkDissolution' || action === 'dissolve') {
          sameVersion(team,event.expectedVersion)
          if (action==='dissolve' && event.confirmName!==team.name) fail('CONFIRMATION_REQUIRED','请输入完整且一致的球队名称。')
          // Future registration/schedule/result writers MUST read active status and increment
          // this team's version in the same transaction as the reference write.
          if (await tx.hasReferences(team._id)) fail('TEAM_IN_USE','球队已有关联报名、赛程或成绩，暂不能解散，请联系赛事管理员。')
          if (action==='checkDissolution') return {ok:true,canDissolve:true,version:team.version}
          const archived={...team,status:'dissolved',dissolvedAt:timestamp,updatedAt:timestamp,version:team.version+1,leaderNicknameSnapshot:user.nickname}
          await tx.set('teams',team._id,archived)
          await tx.set('leaderTeamBindings',uid,{teamId:null,lastTeamVersion:archived.version,lastDissolution:{teamId:team._id,expectedVersion:event.expectedVersion,name:team.name},updatedAt:timestamp})
          await tx.set('users',uid,{...user,role:user.role==='admin'?'admin':'user',updatedAt:timestamp})
          return {ok:true,team:null,dissolved:true}
        }
        if (action === 'update') {
          sameVersion(team,event.expectedVersion)
          team = {...team,...form,version:team.version+1,updatedAt:timestamp}
          await tx.set('users',uid,{...user,phone:form.contactPhone,updatedAt:timestamp})
        } else {
          const previous = await tx.get('players',event.id)
          if (previous && previous.teamId !== team._id) fail('FORBIDDEN', '只能管理本人球队的球员。')
          const index = team.roster.findIndex(p=>p.id===event.id)
          // Exact retries of a successful add/update/remove return the current team without another write.
          if (action === 'savePlayer' && previous && previous.status==='active' && index>=0
            && previous.lastExpectedVersion===event.expectedVersion && ['name','number','position'].every(k=>previous[k]===form[k])) return {ok:true,team:result(team,user)}
          if (action === 'removePlayer' && previous?.status==='removed' && previous.lastExpectedVersion===event.expectedVersion) return {ok:true,team:result(team,user)}
          sameVersion(team,event.expectedVersion)
          if (action === 'savePlayer') {
            if (previous?.status==='removed') fail('CONFLICT', '该球员已移出名单，请重新添加。')
            if (team.roster.some(p=>p.id!==event.id && p.number===form.number)) fail('NUMBER_IN_USE', '该球衣号码已被本队其他球员使用。')
            if (previous && index<0 || !previous && index>=0) fail('SERVICE_UNAVAILABLE', '球员资料暂不可用，请重新读取。')
            const player = { id:event.id,teamId:team._id,...form,status:'active',createdAt:previous?.createdAt || timestamp,updatedAt:timestamp,lastExpectedVersion:event.expectedVersion }
            const roster = [...team.roster]
            if (index<0) roster.push(publicPlayer(player)); else roster[index]=publicPlayer(player)
            await tx.set('players',event.id,player)
            team={...team,roster,version:team.version+1,updatedAt:timestamp}
          } else {
            if (!previous || previous.status!=='active' || index<0) fail('NOT_FOUND', '该球员已不在当前名单中，请重新读取。')
            // Retain stable player identity for future registration/result references; never hard-delete history.
            await tx.set('players',event.id,{...previous,status:'removed',removedAt:timestamp,updatedAt:timestamp,lastExpectedVersion:event.expectedVersion})
            team={...team,roster:team.roster.filter(p=>p.id!==event.id),version:team.version+1,updatedAt:timestamp}
          }
        }
        await tx.set('teams',team._id,team)
        return {ok:true,team:result(team,user)}
      })
    } catch(error) {
      if(error instanceof TeamError) return {ok:false,error:{code:error.code,message:error.message}}
      logger?.error?.('[teamManagement] operation failed')
      return {ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'球队服务暂不可用。若刚刚保存，请重新读取确认结果后再重试。'}}
    }
  }
}
module.exports={createTeamService,APP_ID,DISTRICTS,POSITIONS,userId}
