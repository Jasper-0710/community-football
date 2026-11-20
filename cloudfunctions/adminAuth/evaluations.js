'use strict'

const { createHash } = require('node:crypto')
const { registrationId } = require('./registration-model')
const CID = /^c_[a-f0-9]{32}$/, MID = /^m_[a-f0-9]{32}$/, PID = /^p_[a-f0-9]{32}$/, TID = /^t_[a-f0-9]{64}$/, REQUEST = /^[a-f0-9]{32}$/
const PUBLIC_ACTIONS = ['evaluation.getPublic']
class EvaluationError extends Error { constructor(code, message) { super(message); this.code = code } }
const fail = (code, message) => { throw new EvaluationError(code, message) }
const object = value => !!value && typeof value === 'object' && !Array.isArray(value)
const only = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key))
const text = (value, max) => typeof value === 'string' && !!value.trim() && Array.from(value).length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max
const userId = (appId, openId) => createHash('sha256').update(`${appId}:${openId}`).digest('hex')
const stableId = (prefix, value) => `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 32)}`
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const recentRequests = (current, requestId, hash) => [...(current?.requests || []).slice(-19), { id: requestId, hash }]
function retried(current, requestId, hash) {
  const previous = current?.requests?.find(row => row.id === requestId)
  if (!previous) return false
  if (previous.hash !== hash) fail('CONFLICT', '同一提交标识不能用于不同内容，请重新读取后操作。')
  return true
}
function defaultConfig(competitionId) { return { competitionId, enabled: false, commentsEnabled: false, scoreMin: 1, scoreMax: 10, openedAt: null, closedAt: null, version: 0, updatedAt: '1970-01-01T00:00:00.000Z' } }
function configInput(value) {
  if (!only(value, ['enabled', 'commentsEnabled', 'scoreMin', 'scoreMax', 'openedAt', 'closedAt']) || typeof value.enabled !== 'boolean' || typeof value.commentsEnabled !== 'boolean' || !integer(value.scoreMin, 1, 9) || !integer(value.scoreMax, value.scoreMin + 1, 10) || (value.openedAt !== null && !iso(value.openedAt)) || (value.closedAt !== null && !iso(value.closedAt)) || value.openedAt && value.closedAt && Date.parse(value.openedAt) >= Date.parse(value.closedAt)) fail('INVALID_ARGUMENT', '评分窗口配置无效。')
  return { enabled: value.enabled, commentsEnabled: value.commentsEnabled, scoreMin: value.scoreMin, scoreMax: value.scoreMax, openedAt: value.openedAt, closedAt: value.closedAt }
}
const publicConfig = c => ({ competitionId: c.competitionId, enabled: c.enabled, commentsEnabled: c.commentsEnabled, scoreMin: c.scoreMin, scoreMax: c.scoreMax, openedAt: c.openedAt, closedAt: c.closedAt, version: c.version, updatedAt: c.updatedAt })
function createEvaluationService({ store, authorize, context, expectedAppId, now = Date.now, logger = console }) {
  async function readMatch(matchId, read = store.read, visible = false) {
    const match = await read('matches', matchId)
    if (!match || !MID.test(matchId) || !CID.test(match.competitionId)) fail('NOT_FOUND', '比赛不存在。')
    const competition = await read('competitions', match.competitionId)
    if (!competition || visible && competition.displayEnabled !== true) fail('NOT_FOUND', '比赛不存在或暂未公开。')
    return { match, competition }
  }
  async function playersFor(match, read = store.read) {
    const players = []
    // Knockout fixtures can keep null team IDs; results contain resolved teams.
    const teamIds = [match.result?.homeTeamId || match.homeTeamId, match.result?.awayTeamId || match.awayTeamId]
    for (const teamId of new Set(teamIds.filter(Boolean))) {
      if (!TID.test(teamId)) continue
      const team = await read('teams', teamId)
      const registration = await read('registrations', registrationId(match.competitionId, teamId))
      if (!team || team.status === 'dissolved' || registration?.status !== 'approved' || registration.competitionId !== match.competitionId || registration.teamId !== teamId) continue
      for (const row of team.roster || team.players || []) {
        if (row && PID.test(row.id) && integer(row.number, 1, 99) && text(row.name, 80) && !players.some(player => player.playerId === row.id)) players.push({ playerId: row.id, playerName: row.name, number: row.number, teamId, teamName: team.name })
      }
    }
    return players
  }
  function identity() {
    const wx = typeof context === 'function' ? context() : null
    if (!wx || typeof wx.OPENID !== 'string' || !wx.OPENID || !expectedAppId || wx.APPID !== expectedAppId) fail('AUTH_REQUIRED', '请在微信小程序中登录后评价。')
    return userId(wx.APPID, wx.OPENID)
  }
  function windowReason(config, match) {
    if (match.status !== 'finished') return '比赛结束后才开放评价。'
    if (!config.enabled) return '赛事方尚未开放评分。'
    if (config.openedAt && now() < Date.parse(config.openedAt)) return '评分窗口尚未开始。'
    if (config.closedAt && now() >= Date.parse(config.closedAt)) return '评分窗口已关闭。'
    return ''
  }
  async function publicData(matchId, viewerId = null, admin = false) {
    const { match } = await readMatch(matchId, store.read, !admin)
    const config = await store.read('evaluationConfigs', match.competitionId) || defaultConfig(match.competitionId)
    const players = await playersFor(match), ids = new Set(players.map(row => row.playerId))
    const rowsFor = collection => store.evaluationRows ? store.evaluationRows(collection, matchId) : store.scan(collection)
    const [ratings, comments, awardDoc] = await Promise.all([rowsFor('playerRatings'), rowsFor('playerComments'), store.read('playerAwards', matchId)])
    const scopedRatings = ratings.filter(row => row.matchId === matchId && ids.has(row.playerId))
    const scopedComments = comments.filter(row => row.matchId === matchId && ids.has(row.playerId))
    const commentView = scopedComments.map(row => {
      const player = players.find(item => item.playerId === row.playerId)
      return { id: row._id, playerId: row.playerId, playerName: player.playerName, teamId: player.teamId, teamName: player.teamName, content: row.content, createdAt: row.createdAt, updatedAt: row.updatedAt, hidden: row.hidden === true }
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    const visibleComments = commentView.filter(row => !row.hidden).map(({ hidden, ...row }) => row)
    const awards = awardDoc?.published === true && match.status === 'finished' ? (awardDoc.awards || []).filter(row => ids.has(row.playerId)).map(row => ({ type: row.type, playerId: row.playerId, playerName: row.playerName, number: row.number, teamId: row.teamId, teamName: row.teamName, position: row.position, rank: row.rank })) : []
    if (!admin) await readMatch(matchId, store.read, true)
    const reason = windowReason(config, match)
    const base = { ok: true, matchId, competitionId: match.competitionId, matchStatus: match.status, config: publicConfig(config), canRate: !reason, canComment: !reason && config.commentsEnabled, closedReason: reason, players: players.map(player => {
      const rows = scopedRatings.filter(row => row.playerId === player.playerId)
      return { ...player, ratingCount: rows.length, ratingAverage: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length * 100) / 100 : null, viewerScore: viewerId ? rows.find(row => row.voterId === viewerId)?.score ?? null : null, commentCount: commentView.filter(row => !row.hidden && row.playerId === player.playerId).length }
    }), comments: visibleComments, awards, awardsVersion: awardDoc?.version || 0 }
    return admin ? { ...base, ratings: scopedRatings.map(row => ({ id: row._id, playerId: row.playerId, score: row.score, createdAt: row.createdAt, updatedAt: row.updatedAt })), hiddenComments: commentView.filter(row => row.hidden), commentVersions: Object.fromEntries(scopedComments.map(row => [row._id, row.version || 1])) } : base
  }
  return async event => {
    try {
      if (!object(event) || typeof event.action !== 'string') fail('INVALID_ARGUMENT', '评分请求格式不正确。')
      const base = ['action', 'userInfo', 'tcbContext']
      if (event.action === 'evaluation.getPublic') {
        if (!only(event, [...base, 'matchId']) || !MID.test(event.matchId)) fail('INVALID_ARGUMENT', '比赛标识无效。')
        let viewer = null
        try { viewer = identity() } catch {}
        return await publicData(event.matchId, viewer)
      }
      if (['evaluation.rate', 'evaluation.comment'].includes(event.action)) {
        const rating = event.action === 'evaluation.rate'
        if (!only(event, [...base, 'matchId', 'playerId', rating ? 'score' : 'content', 'requestId']) || !MID.test(event.matchId) || !PID.test(event.playerId) || !REQUEST.test(event.requestId)) fail('INVALID_ARGUMENT', '评价请求参数无效。')
        const owner = identity(), content = rating ? event.score : event.content
        if (!rating && !text(content, 300)) fail('INVALID_ARGUMENT', '评论须为1至300字，且不能包含控制字符。')
        const collection = rating ? 'playerRatings' : 'playerComments', recordId = stableId(rating ? 'er' : 'ec', `${event.matchId}:${event.playerId}:${owner}`)
        const hash = fingerprint({ action: event.action, matchId: event.matchId, playerId: event.playerId, value: rating ? content : content.trim() })
        return await store.atomic(async tx => {
          const current = await tx.get(collection, recordId)
          const { match } = await readMatch(event.matchId, tx.get, true)
          if (retried(current, event.requestId, hash)) return { ok: true, applied: false, ...(rating ? { score: current.score } : { commentId: recordId }) }
          const config = await tx.get('evaluationConfigs', match.competitionId) || defaultConfig(match.competitionId)
          const reason = windowReason(config, match)
          if (reason) fail('EVALUATION_CLOSED', reason)
          if (rating && !integer(event.score, config.scoreMin, config.scoreMax)) fail('INVALID_ARGUMENT', `评分必须为${config.scoreMin}至${config.scoreMax}分。`)
          if (!rating && !config.commentsEnabled) fail('EVALUATION_CLOSED', '评论功能暂未开启。')
          const players = await playersFor(match, tx.get)
          if (!players.some(row => row.playerId === event.playerId)) fail('INVALID_ARGUMENT', '只能评价本场已通过报名球队的球员。')
          const timestamp = new Date(now()).toISOString()
          const record = { _id: recordId, matchId: event.matchId, competitionId: match.competitionId, playerId: event.playerId, version: (current?.version || 0) + 1, createdAt: current?.createdAt || timestamp, updatedAt: timestamp, requests: recentRequests(current, event.requestId, hash), ...(rating ? { voterId: owner, score: event.score } : { authorId: owner, content: content.trim(), hidden: true }) }
          await tx.set(collection, recordId, record)
          return { ok: true, applied: true, ...(rating ? { score: record.score } : { commentId: recordId }) }
        })
      }
      const auth = await authorize(event.token)
      if (!auth.ok) return auth
      const adminBase = [...base, 'token']
      if (event.action === 'evaluation.getAdmin') {
        if (!only(event, [...adminBase, 'matchId']) || !MID.test(event.matchId)) fail('INVALID_ARGUMENT', '比赛标识无效。')
        return await publicData(event.matchId, null, true)
      }
      if (event.action === 'evaluation.configure') {
        if (!only(event, [...adminBase, 'competitionId', 'expectedVersion', 'requestId', 'config']) || !CID.test(event.competitionId) || !integer(event.expectedVersion) || !REQUEST.test(event.requestId)) fail('INVALID_ARGUMENT', '评分配置参数无效。')
        const input = configInput(event.config), hash = fingerprint({ input, expectedVersion: event.expectedVersion })
        return await store.atomic(async tx => {
          if (!await tx.get('competitions', event.competitionId)) fail('NOT_FOUND', '赛事不存在。')
          const current = await tx.get('evaluationConfigs', event.competitionId), version = current?.version || 0
          if (retried(current, event.requestId, hash)) return { ok: true, config: publicConfig(current) }
          if (version !== event.expectedVersion) fail('CONFLICT', '评分配置已更新，请重新读取。')
          const next = { _id: event.competitionId, competitionId: event.competitionId, ...input, version: version + 1, updatedAt: new Date(now()).toISOString(), updatedBy: auth.admin?.username || '', requests: recentRequests(current, event.requestId, hash) }
          await tx.set('evaluationConfigs', event.competitionId, next)
          return { ok: true, config: publicConfig(next) }
        })
      }
      if (event.action === 'evaluation.publishAwards') {
        if (!only(event, [...adminBase, 'matchId', 'expectedVersion', 'requestId', 'awards']) || !MID.test(event.matchId) || !integer(event.expectedVersion) || !REQUEST.test(event.requestId) || !Array.isArray(event.awards) || event.awards.length > 32) fail('INVALID_ARGUMENT', '评选结果参数无效。')
        const hash = fingerprint({ awards: event.awards, expectedVersion: event.expectedVersion })
        return await store.atomic(async tx => {
          const current = await tx.get('playerAwards', event.matchId), version = current?.version || 0
          const { match } = await readMatch(event.matchId, tx.get)
          if (retried(current, event.requestId, hash)) return { ok: true, version, awards: current.awards }
          if (match.status !== 'finished') fail('EVALUATION_CLOSED', '比赛结束后才能发布评选。')
          if (version !== event.expectedVersion) fail('CONFLICT', '评选结果已更新，请重新读取。')
          const candidates = await playersFor(match, tx.get), byId = new Map(candidates.map(row => [row.playerId, row]))
          const awards = event.awards.map(award => {
            if (!only(award, ['type', 'playerId', 'position', 'rank']) || !['mvp', 'lineup'].includes(award.type) || !PID.test(award.playerId) || !integer(award.rank, 1, 32) || award.position !== null && !text(award.position, 40)) fail('INVALID_ARGUMENT', '评选结果参数无效。')
            const player = byId.get(award.playerId)
            if (!player) fail('INVALID_ARGUMENT', '评选球员必须属于本场已通过报名的球队。')
            return { type: award.type, ...player, position: award.position || null, rank: award.rank }
          })
          for (const type of ['mvp', 'lineup']) {
            const rows = awards.filter(row => row.type === type)
            if (type === 'mvp' && (rows.length > 1 || rows.some(row => row.rank !== 1)) || new Set(rows.map(row => row.playerId)).size !== rows.length || new Set(rows.map(row => row.rank)).size !== rows.length) fail('INVALID_ARGUMENT', 'MVP最多一人，最佳阵容球员和顺序不能重复。')
          }
          const next = { _id: event.matchId, matchId: event.matchId, competitionId: match.competitionId, published: true, version: version + 1, awards, updatedAt: new Date(now()).toISOString(), updatedBy: auth.admin?.username || '', requests: recentRequests(current, event.requestId, hash) }
          await tx.set('playerAwards', event.matchId, next)
          return { ok: true, version: next.version, awards }
        })
      }
      if (event.action === 'evaluation.moderateComment') {
        if (!only(event, [...adminBase, 'id', 'hidden', 'expectedVersion']) || !/^ec_[a-f0-9]{32}$/.test(event.id) || typeof event.hidden !== 'boolean' || !integer(event.expectedVersion, 1)) fail('INVALID_ARGUMENT', '评论审核参数无效。')
        return await store.atomic(async tx => {
          const current = await tx.get('playerComments', event.id)
          if (!current) fail('NOT_FOUND', '评论不存在。')
          if ((current.version || 1) !== event.expectedVersion) fail('CONFLICT', '评论已更新，请重新读取后审核。')
          const next = { ...current, hidden: event.hidden, version: event.expectedVersion + 1, updatedAt: new Date(now()).toISOString() }
          await tx.set('playerComments', event.id, next)
          return { ok: true, hidden: next.hidden, version: next.version }
        })
      }
      fail('INVALID_ARGUMENT', '不支持的评分操作。')
    } catch (error) {
      if (error instanceof EvaluationError) return { ok: false, error: { code: error.code, message: error.message } }
      logger?.error?.('[evaluations] operation failed')
      return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '评分服务暂不可用，请稍后重试。' } }
    }
  }
}
module.exports = { createEvaluationService, userId, PUBLIC_ACTIONS }
