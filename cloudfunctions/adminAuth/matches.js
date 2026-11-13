'use strict'

const { createHash } = require('node:crypto')
const { calculateStandings, assertSchedule, protectResults, StandingsError } = require('./standings-engine')

const PUBLIC_ACTIONS = ['matches.listPublic', 'matches.getPublic']
const ACTIONS = [...PUBLIC_ACTIONS, 'matches.listAdmin', 'matches.create', 'matches.update']
const ID = /^m_[a-f0-9]{32}$/
const COMPETITION_ID = /^c_[a-f0-9]{32}$/
const TEAM_ID = /^t_[a-f0-9]{64}$/
const STAGES = ['group', 'quarter', 'semi', 'final']
const STATUSES = ['scheduled', 'postponed']
const PUBLIC_STATUSES = [...STATUSES, 'live', 'finished']

class MatchError extends Error { constructor(code, message) { super(message); this.code = code } }
function fail(code, message) { throw new MatchError(code, message) }
function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value) }
function fields(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_ARGUMENT', '请求包含不支持的字段。')
}
function text(value, label, max, required = true) {
  if (typeof value !== 'string') fail('INVALID_ARGUMENT', `请填写${label}。`)
  const result = value.trim()
  if ((required && !result) || Array.from(result).length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(result)) fail('INVALID_ARGUMENT', `${label}格式不正确。`)
  return result
}
function nullableText(value, label, max) { return value == null || value === '' ? null : text(value, label, max) }
function instant(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail('INVALID_ARGUMENT', `${label}格式不正确。`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail('INVALID_ARGUMENT', `${label}不是有效时间。`)
  return value
}
function id(value, pattern, label, nullable = true) {
  if (value == null || value === '') { if (nullable) return null; fail('INVALID_ARGUMENT', `${label}不能为空。`) }
  if (typeof value !== 'string' || !pattern.test(value)) fail('INVALID_ARGUMENT', `${label}无效。`)
  return value
}
function positiveInt(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 128) fail('INVALID_ARGUMENT', `${label}须为1–128的整数。`)
  return value
}
function validateForm(input) {
  fields(input, ['competitionId', 'stage', 'round', 'groupId', 'slot', 'homeTeamId', 'awayTeamId', 'homeFrom', 'awayFrom', 'scheduledAt', 'venue', 'status'])
  if (!COMPETITION_ID.test(input.competitionId)) fail('INVALID_ARGUMENT', '赛事标识无效。')
  if (!STAGES.includes(input.stage)) fail('INVALID_ARGUMENT', '比赛轮次无效。')
  const round = positiveInt(input.round, '比赛轮次')
  if (!STATUSES.includes(input.status)) fail('INVALID_ARGUMENT', '比赛状态无效。')
  const homeTeamId = id(input.homeTeamId, TEAM_ID, '主队标识'), awayTeamId = id(input.awayTeamId, TEAM_ID, '客队标识')
  if (homeTeamId && awayTeamId && homeTeamId === awayTeamId) fail('INVALID_ARGUMENT', '主队和客队不能相同。')
  const homeFrom = id(input.homeFrom, ID, '主队来源比赛'), awayFrom = id(input.awayFrom, ID, '客队来源比赛')
  if (homeTeamId && homeFrom || awayTeamId && awayFrom) fail('INVALID_ARGUMENT', '同一方请选择确定球队或来源比赛，不可同时填写。')
  if (homeFrom && homeFrom === awayFrom) fail('INVALID_ARGUMENT', '主客队不能来自同一场比赛。')
  if (input.stage === 'group' && (homeFrom || awayFrom)) fail('INVALID_ARGUMENT', '小组赛不能使用淘汰赛晋级来源。')
  return {
    competitionId: input.competitionId, stage: input.stage, round,
    groupId: nullableText(input.groupId, '分组名称', 40),
    slot: input.slot == null || input.slot === '' ? null : positiveInt(input.slot, '签位'),
    homeTeamId, awayTeamId,
    homeFrom, awayFrom,
    scheduledAt: instant(input.scheduledAt, '比赛时间'), venue: text(input.venue, '比赛场地', 120), status: input.status,
  }
}
function publicResult(result) {
  if (!result) return null
  return {
    state: result.state || 'finished', minute: result.minute ?? null, homeScore: result.homeScore, awayScore: result.awayScore,
    penalties: result.penalties || null, goals: (result.goals || []).map(goal => ({ teamId: goal.teamId, minute: goal.minute, ownGoal: goal.ownGoal, scorer: goal.scorer ? { ...goal.scorer } : null, assist: goal.assist ? { ...goal.assist } : null })),
    cards: (result.cards || []).map(card => ({ teamId: card.teamId, minute: card.minute, kind: card.kind, player: { ...card.player } })),
    substitutions: (result.substitutions || []).map(change => ({ teamId: change.teamId, minute: change.minute, playerIn: { ...change.playerIn }, playerOut: { ...change.playerOut } })),
    stats: result.stats ? { possession: [...result.stats.possession], shots: [...result.stats.shots], shotsOnTarget: [...result.stats.shotsOnTarget], corners: [...result.stats.corners], fouls: [...result.stats.fouls], offsides: [...result.stats.offsides] } : null,
  }
}
function recordView(record, admin = false, includeResult = false) {
  const result = { id: record._id, competitionId: record.competitionId, stage: record.stage, round: record.round, groupId: record.groupId || null,
    slot: record.slot ?? null, homeTeamId: record.homeTeamId || null, awayTeamId: record.awayTeamId || null,
    homeFrom: record.homeFrom || null, awayFrom: record.awayFrom || null, scheduledAt: new Date(record.scheduledAt).toISOString(), venue: record.venue,
    status: record.status, homeScore: record.result?.homeScore ?? null, awayScore: record.result?.awayScore ?? null,
    penalties: record.result?.penalties || null, homeQualification: record.homeQualification || null, awayQualification: record.awayQualification || null,
    updatedAt: new Date(record.updatedAt).toISOString(), ...(includeResult ? { result: publicResult(record.result) } : {}) }
  if (admin) Object.assign(result, { version: record.version, createdAt: new Date(record.createdAt).toISOString() })
  return result
}
async function namedView(store, record, admin = false, resolved = record, includeResult = false) {
  const result = recordView(record, admin, includeResult)
  if (typeof store.team !== 'function') return result
  const [home, away] = await Promise.all([
    resolved.homeTeamId ? store.team(resolved.homeTeamId) : null,
    resolved.awayTeamId ? store.team(resolved.awayTeamId) : null,
  ])
  return { ...result, ...(!admin ? { homeTeamId: resolved.homeTeamId, awayTeamId: resolved.awayTeamId } : {}), homeTeamName: home?.name || null, awayTeamName: away?.name || null }
}
async function checkRelated(store, form, matchId) {
  const competition = await store.competition(form.competitionId)
  if (!competition) fail('NOT_FOUND', '赛事不存在，请刷新后重试。')
  const date = new Date(Date.parse(form.scheduledAt) + 8 * 3600000).toISOString().slice(0, 10)
  if (date < competition.startDate || date > competition.endDate) fail('INVALID_ARGUMENT', '比赛时间须在赛事开始和结束日期内（北京时间）。')
  const teams = []
  for (const teamId of [form.homeTeamId, form.awayTeamId]) if (teamId) {
    const team = await store.team(teamId)
    if (!team || team.status === 'dissolved') fail('INVALID_ARGUMENT', '比赛球队不存在或已解散。')
    const registration = await store.registration(form.competitionId, teamId)
    if (registration?.status !== 'approved' || registration.competitionId !== form.competitionId || registration.teamId !== teamId) fail('INVALID_ARGUMENT', '只能为本赛事报名已通过的球队排赛，请先核对参赛名单。')
    teams.push(team)
  }
  for (const sourceId of [form.homeFrom, form.awayFrom].filter(Boolean)) {
    const source = sourceId !== matchId && await store.read(sourceId)
    if (!source || source.competitionId !== form.competitionId) fail('INVALID_ARGUMENT', '来源比赛必须是本赛事中另一场已保存的比赛。')
    if (STAGES.indexOf(source.stage) >= STAGES.indexOf(form.stage)) fail('INVALID_ARGUMENT', '来源比赛必须来自更早的比赛阶段。')
    if (Date.parse(source.scheduledAt) >= Date.parse(form.scheduledAt)) fail('INVALID_ARGUMENT', '来源比赛须早于当前比赛开赛。')
  }
  for (const dependent of await store.dependents(matchId, form.competitionId)) {
    if (STAGES.indexOf(dependent.stage) <= STAGES.indexOf(form.stage) || Date.parse(dependent.scheduledAt) <= Date.parse(form.scheduledAt)) fail('CONFLICT', '后续比赛已经引用本场，当前阶段或时间会使晋级顺序无效，请先调整后续比赛。')
  }
  if (store.allMatches) {
    const records = await store.allMatches(form.competitionId)
    const previous = records.find(record => record._id === matchId)
    const candidate = { ...previous, ...form, _id: matchId }
    const next = [...records.filter(record => record._id !== matchId), candidate]
    assertSchedule(next, competition.standingsRules)
    protectResults(calculateStandings(competition, records).matches, calculateStandings(competition, next).matches)
  }
  return { competition, teams }
}

// Writes validate related records inside the transaction. save(record, related)
// also touches the competition and teams to serialize edits and dissolution.
function createMatchService({ store, authorize, now = Date.now, logger = console }) {
  return async event => {
    try {
      if (!object(event) || !ACTIONS.includes(event.action)) fail('INVALID_ARGUMENT', '不支持的比赛操作。')
      const publicOnly = PUBLIC_ACTIONS.includes(event.action)
      if (!publicOnly) { const auth = await authorize(event.token); if (!auth.ok) return auth }
      const base = ['action', 'token', 'userInfo', 'tcbContext']
      if (event.action === 'matches.listPublic' || event.action === 'matches.listAdmin') {
        fields(event, [...base, 'competitionId', 'cursor', 'teamId'])
        if (!COMPETITION_ID.test(event.competitionId)) fail('INVALID_ARGUMENT', '赛事标识无效。')
        if (event.cursor != null && !ID.test(event.cursor)) fail('INVALID_ARGUMENT', '分页位置无效，请刷新赛程。')
        if (event.teamId != null && !TEAM_ID.test(event.teamId)) fail('INVALID_ARGUMENT', '球队标识无效。')
        const snapshot = store.snapshot ? await store.snapshot(event.competitionId) : null
        const competition = snapshot?.competition || await store.competition(event.competitionId)
        if (!competition || publicOnly && !competition.displayEnabled) fail('NOT_FOUND', '赛事不存在或暂未公开。')
        const resolved = snapshot ? calculateStandings(competition, snapshot.matches, snapshot.teams).matches : null
        const rows = snapshot ? snapshot.matches.filter(row => (!publicOnly || PUBLIC_STATUSES.includes(row.status)) && (!event.cursor || row._id > event.cursor)
          && (!event.teamId || [resolved.find(match => match._id === row._id)?.homeTeamId, resolved.find(match => match._id === row._id)?.awayTeamId].includes(event.teamId)))
          .sort((a, b) => a._id.localeCompare(b._id)).slice(0, 21)
          : await store.list({ publicOnly, competitionId: event.competitionId, cursor: event.cursor || null, teamId: event.teamId || null, limit: 21 })
        if (publicOnly && rows.some(row => row.competitionId !== event.competitionId)) throw new Error('Public query returned another competition')
        const viewStore = snapshot ? { team: async id => snapshot.teams.get(id) } : store
        return { ok: true, matches: await Promise.all(rows.slice(0, 20).map(row => namedView(viewStore, row, !publicOnly, resolved?.find(match => match._id === row._id) || row))), nextCursor: rows.length > 20 ? rows[19]._id : null }
      }
      if (event.action === 'matches.getPublic') {
        fields(event, [...base, 'id'])
        if (!ID.test(event.id)) fail('NOT_FOUND', '比赛不存在或暂未公开。')
        const record = await store.read(event.id)
        const snapshot = record && store.snapshot ? await store.snapshot(record.competitionId) : null
        const match = snapshot ? calculateStandings(snapshot.competition, snapshot.matches, snapshot.teams).matches.find(match => match._id === event.id) : record
        const competition = snapshot?.competition || record && await store.competition(record.competitionId)
        if (!match || !competition || !competition.displayEnabled || !PUBLIC_STATUSES.includes(match.status)) fail('NOT_FOUND', '比赛不存在或暂未公开。')
        return { ok: true, match: await namedView(snapshot ? { team: async id => snapshot.teams.get(id) } : store, match, false, match, true) }
      }
      if (event.action === 'matches.create') {
        fields(event, [...base, 'requestId', 'form'])
        if (typeof event.requestId !== 'string' || !/^[a-f0-9]{32}$/.test(event.requestId)) fail('INVALID_ARGUMENT', '创建请求标识无效，请重新打开排赛表单。')
        const form = validateForm(event.form)
        const matchId = 'm_' + event.requestId, fingerprint = createHash('sha256').update(JSON.stringify(form)).digest('hex'), createdAt = now()
        return await store.transaction(matchId, async (existing, save, relatedStore = store) => {
          if (existing) {
            if (existing.creationFingerprint !== fingerprint) fail('CONFLICT', '这次排赛请求已保存，请刷新列表确认结果。')
            return { ok: true, match: await namedView(store, existing, true), created: false }
          }
          const related = await checkRelated(relatedStore, form, matchId)
          const record = { _id: matchId, ...form, creationFingerprint: fingerprint, version: 1, createdAt, updatedAt: createdAt }
          await save(record, related)
          return { ok: true, match: await namedView(store, record, true), created: true }
        })
      }
      if (event.action === 'matches.update') {
        fields(event, [...base, 'id', 'expectedVersion', 'form'])
        if (!ID.test(event.id) || !Number.isSafeInteger(event.expectedVersion) || event.expectedVersion < 1) fail('INVALID_ARGUMENT', '比赛版本无效，请刷新后重试。')
        const form = validateForm(event.form)
        return await store.transaction(event.id, async (record, save, relatedStore = store) => {
          if (!record) fail('NOT_FOUND', '比赛不存在，请刷新列表。')
          if (record.version !== event.expectedVersion) fail('CONFLICT', '比赛已在其他页面更新，请刷新后核对最新资料。')
          if (['live', 'finished'].includes(record.status) || record.result) fail('CONFLICT', '比赛进行中或已有赛果，请先在“榜单与晋级”撤销赛果后再编辑赛程。')
          if (record.competitionId !== form.competitionId) fail('INVALID_ARGUMENT', '比赛不能改到其他赛事。')
          const related = await checkRelated(relatedStore, form, event.id)
          const updated = { ...record, ...form, version: record.version + 1, updatedAt: now() }
          await save(updated, related)
          return { ok: true, match: await namedView(store, updated, true) }
        })
      }
      fail('INVALID_ARGUMENT', '不支持的比赛操作。')
    } catch (error) {
      if (error instanceof MatchError || error instanceof StandingsError) return { ok: false, error: { code: error.code, message: error.message } }
      logger?.error?.('[matches] operation failed')
      return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '赛程服务暂不可用，请稍后重试。' } }
    }
  }
}

module.exports = { createMatchService, PUBLIC_ACTIONS, validateForm, recordView }
