'use strict'

const { createHash } = require('node:crypto')
const PUBLIC_ACTIONS = ['competitions.listPublic', 'competitions.getPublic']
const ACTIONS = [...PUBLIC_ACTIONS, 'competitions.listAdmin', 'competitions.create', 'competitions.update', 'competitions.visibility', 'competitions.registration']
const ID = /^c_[a-f0-9]{32}$/
const FORMATS = ['group_knockout', 'round_robin', 'knockout', 'other']
class CompetitionError extends Error { constructor(code, message) { super(message); this.code = code } }
function fail(code, message) { throw new CompetitionError(code, message) }
function object(v) { return !!v && typeof v === 'object' && !Array.isArray(v) }
function fields(v, allowed) {
  if (!object(v) || Object.keys(v).some(k => !allowed.includes(k))) fail('INVALID_ARGUMENT', '请求包含不支持的字段。')
}
function text(value, label, max, required = true) {
  if (typeof value !== 'string') fail('INVALID_ARGUMENT', `请填写${label}。`)
  const v = value.trim()
  if ((required && !v) || Array.from(v).length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v)) fail('INVALID_ARGUMENT', `${label}须${required ? '为1' : '不超过0'}–${max}个字符，且不能含控制字符。`)
  return v
}
function day(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2020-01-01' || value > '2100-12-31') fail('INVALID_ARGUMENT', `${label}格式不正确。`)
  const d = new Date(value + 'T00:00:00.000Z')
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) fail('INVALID_ARGUMENT', `${label}不是有效日期。`)
  return value
}
function instant(value, label) {
  if (value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail('INVALID_ARGUMENT', `${label}格式不正确。`)
  const time = new Date(value)
  if (!Number.isFinite(time.getTime()) || time.toISOString() !== value) fail('INVALID_ARGUMENT', `${label}不是有效时间。`)
  day(value.slice(0, 10), label)
  return value
}
function boolean(value) { if (typeof value !== 'boolean') fail('INVALID_ARGUMENT', '开关值必须为布尔值。'); return value }
function registrationConfig(value) {
  if (value == null) return null // Older events must explicitly configure D05 before accepting submissions.
  fields(value, ['projects', 'teamLimit', 'minPlayers', 'maxPlayers'])
  if (!Array.isArray(value.projects) || value.projects.length < 1 || value.projects.length > 20) fail('INVALID_ARGUMENT', '请设置1–20个报名项目。')
  const projects = value.projects.map(v => text(v, '报名项目', 40))
  if (new Set(projects).size !== projects.length) fail('INVALID_ARGUMENT', '报名项目不能重复。')
  if (value.teamLimit !== null && (!Number.isSafeInteger(value.teamLimit) || value.teamLimit < 1 || value.teamLimit > 10000)) fail('INVALID_ARGUMENT', '球队上限须为1–10000，或选择不限额。')
  if (![value.minPlayers, value.maxPlayers].every(v => Number.isSafeInteger(v) && v >= 1 && v <= 200) || value.maxPlayers < value.minPlayers) fail('INVALID_ARGUMENT', '每队人数须为1–200，且上限不小于下限。')
  return { projects, teamLimit: value.teamLimit, minPlayers: value.minPlayers, maxPlayers: value.maxPlayers }
}
function validateForm(input) {
  fields(input, ['name', 'description', 'format', 'formatDescription', 'startDate', 'endDate', 'venue', 'registrationRequirements', 'registrationStartAt', 'registrationEndAt', 'registrationConfig'])
  const data = {
    name: text(input.name, '赛事名称', 80), description: text(input.description, '赛事介绍', 1000),
    format: input.format, formatDescription: text(input.formatDescription, '赛制说明', 1000),
    startDate: day(input.startDate, '赛事开始日期'), endDate: day(input.endDate, '赛事结束日期'),
    venue: text(input.venue, '比赛地点', 120), registrationRequirements: text(input.registrationRequirements, '参赛要求', 1000),
    registrationStartAt: instant(input.registrationStartAt, '报名开始时间'), registrationEndAt: instant(input.registrationEndAt, '报名截止时间'),
    ...(Object.hasOwn(input, 'registrationConfig') ? { registrationConfig: registrationConfig(input.registrationConfig) } : {}),
  }
  if (!FORMATS.includes(data.format)) fail('INVALID_ARGUMENT', '请选择有效的赛制类型。')
  if (data.endDate < data.startDate) fail('INVALID_ARGUMENT', '赛事结束日期不能早于开始日期。')
  if (!!data.registrationStartAt !== !!data.registrationEndAt) fail('INVALID_ARGUMENT', '报名开始和截止时间须同时填写。')
  if (data.registrationStartAt && data.registrationEndAt <= data.registrationStartAt) fail('INVALID_ARGUMENT', '报名截止时间须晚于开始时间。')
  return data
}
function registrationStatus(record, time) {
  if (!record.registrationEnabled) return 'disabled'
  if (!record.registrationStartAt || !record.registrationEndAt) return 'disabled'
  if (time < Date.parse(record.registrationStartAt)) return 'upcoming'
  return time < Date.parse(record.registrationEndAt) ? 'open' : 'closed'
}
function resultRecord(record, time, admin = false) {
  const out = { id: record._id, name: record.name, description: record.description, format: record.format, formatDescription: record.formatDescription,
    startDate: record.startDate, endDate: record.endDate, venue: record.venue, registrationRequirements: record.registrationRequirements,
    registrationStartAt: record.registrationStartAt, registrationEndAt: record.registrationEndAt, registrationEnabled: record.registrationEnabled,
    registrationStatus: registrationStatus(record, time), updatedAt: new Date(record.updatedAt).toISOString(),
    registrationConfig: record.registrationConfig || null, registrationRulesVersion: record.registrationRulesVersion || 1,
    registrationStats: record.registrationStats || { pending: 0, approved: 0, occupied: 0 } }
  if (admin) Object.assign(out, { displayEnabled: record.displayEnabled, version: record.version, createdAt: new Date(record.createdAt).toISOString() })
  return out
}
function checkRegistration(record) {
  if (record.registrationEnabled && (!record.registrationStartAt || !record.registrationEndAt)) fail('INVALID_ARGUMENT', '开启报名前请先设置报名开始和截止时间。')
}

/** store.list({publicOnly,cursor,limit}), store.read(id), store.transaction(id, callback). */
function createCompetitionService({ store, authorize, now = Date.now, logger = console }) {
  return async event => {
    try {
      if (!object(event) || !ACTIONS.includes(event.action)) fail('INVALID_ARGUMENT', '不支持的赛事操作。')
      const publicOnly = PUBLIC_ACTIONS.includes(event.action)
      if (!publicOnly) {
        const auth = await authorize(event.token)
        if (!auth.ok) return auth
      }
      const base = ['action', 'token', 'userInfo', 'tcbContext']
      const time = now()
      if (event.action === 'competitions.listPublic' || event.action === 'competitions.listAdmin') {
        fields(event, [...base, 'cursor'])
        if (event.cursor != null && (typeof event.cursor !== 'string' || !ID.test(event.cursor))) fail('INVALID_ARGUMENT', '分页位置无效，请刷新赛事列表。')
        const rows = await store.list({ publicOnly, cursor: event.cursor || null, limit: 21 })
        // Defense in depth: do not serialize hidden records even if the adapter returns one.
        if (publicOnly && rows.some(r => !r.displayEnabled)) throw new Error('Public query included private data')
        return { ok: true, competitions: rows.slice(0, 20).map(r => resultRecord(r, time, !publicOnly)), nextCursor: rows.length > 20 ? rows[19]._id : null }
      }
      if (event.action === 'competitions.getPublic') {
        fields(event, [...base, 'id'])
        if (typeof event.id !== 'string' || !ID.test(event.id)) fail('NOT_FOUND', '赛事不存在或暂未公开。')
        const record = await store.read(event.id)
        if (!record || !record.displayEnabled) fail('NOT_FOUND', '赛事不存在或暂未公开。')
        return { ok: true, competition: resultRecord(record, time) }
      }
      if (event.action === 'competitions.create') {
        fields(event, [...base, 'requestId', 'form'])
        if (typeof event.requestId !== 'string' || !/^[a-f0-9]{32}$/.test(event.requestId)) fail('INVALID_ARGUMENT', '创建请求标识无效，请重新打开新建表单。')
        const form = validateForm(event.form), id = 'c_' + event.requestId
        const fingerprint = createHash('sha256').update(JSON.stringify(form)).digest('hex')
        return await store.transaction(id, async (existing, save) => {
          if (existing) {
            if (existing.creationFingerprint !== fingerprint) fail('CONFLICT', '这次创建请求已保存，请刷新列表确认结果后再新建赛事。')
            return { ok: true, competition: resultRecord(existing, now(), true), created: false }
          }
          const record = { _id: id, ...form, displayEnabled: false, registrationEnabled: false, version: 1, creationFingerprint: fingerprint, createdAt: time, updatedAt: time }
          await save(record)
          return { ok: true, competition: resultRecord(record, time, true), created: true }
        })
      }
      const action = event.action
      fields(event, [...base, 'id', 'expectedVersion', ...(action === 'competitions.update' ? ['form'] : ['enabled'])])
      if (typeof event.id !== 'string' || !ID.test(event.id)) fail('INVALID_ARGUMENT', '赛事标识无效。')
      if (!Number.isSafeInteger(event.expectedVersion) || event.expectedVersion < 1) fail('INVALID_ARGUMENT', '赛事版本无效，请刷新后重试。')
      const form = action === 'competitions.update' ? validateForm(event.form) : null
      const enabled = form ? null : boolean(event.enabled)
      return await store.transaction(event.id, async (record, save) => {
        if (!record) fail('NOT_FOUND', '赛事不存在，请刷新列表。')
        if (record.version !== event.expectedVersion) fail('CONFLICT', '赛事已在其他页面更新，请刷新后核对最新资料。')
        const updated = { ...record, ...(form || {}), ...(action === 'competitions.visibility' ? { displayEnabled: enabled } : {}), ...(action === 'competitions.registration' ? { registrationEnabled: enabled } : {}), version: record.version + 1, updatedAt: now() }
        if (form) updated.registrationRulesVersion = (record.registrationRulesVersion || 1) + 1
        if (record.registrationStats?.occupied && !updated.registrationConfig) fail('INVALID_ARGUMENT', '已有报名，不能清空报名配置。')
        if (updated.registrationConfig?.teamLimit != null && updated.registrationConfig.teamLimit < (record.registrationStats?.occupied || 0)) fail('INVALID_ARGUMENT', '球队上限不能小于当前已占用名额。')
        if (record.registrationStats?.occupied && record.registrationConfig?.projects.some(p => !updated.registrationConfig?.projects.includes(p))) fail('INVALID_ARGUMENT', '已有报名，不能删除原报名项目，可继续新增项目。')
        checkRegistration(updated)
        await save(updated)
        return { ok: true, competition: resultRecord(updated, now(), true) }
      })
    } catch (error) {
      if (error instanceof CompetitionError) return { ok: false, error: { code: error.code, message: error.message } }
      logger?.error?.('[competitions] operation failed')
      return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '赛事服务暂不可用，请稍后重试。' } }
    }
  }
}

function createApplicationRouter(auth, competitions) {
  return event => typeof event?.action === 'string' && event.action.startsWith('competitions.') ? competitions(event) : auth(event)
}
module.exports = { createCompetitionService, createApplicationRouter, PUBLIC_ACTIONS, registrationStatus, validateForm }
