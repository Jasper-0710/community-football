export type EvaluationAwardType = 'mvp' | 'lineup'

export interface EvaluationConfig {
  competitionId: string
  enabled: boolean
  commentsEnabled: boolean
  scoreMin: number
  scoreMax: number
  openedAt: string | null
  closedAt: string | null
  version: number
  updatedAt: string
}

export interface EvaluationPlayerSummary {
  playerId: string
  playerName: string
  number: number
  teamId: string
  teamName: string
  ratingCount: number
  ratingAverage: number | null
  viewerScore: number | null
  commentCount: number
}

export interface EvaluationComment {
  id: string
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface EvaluationAward {
  type: EvaluationAwardType
  playerId: string
  playerName: string
  number: number
  teamId: string
  teamName: string
  position: string | null
  rank: number
}

export interface EvaluationPublic {
  matchId: string
  competitionId: string
  matchStatus: 'scheduled' | 'postponed' | 'live' | 'finished'
  config: EvaluationConfig
  canRate: boolean
  canComment: boolean
  closedReason: string
  players: EvaluationPlayerSummary[]
  comments: EvaluationComment[]
  awards: EvaluationAward[]
  awardsVersion: number
}

export interface EvaluationAdmin extends EvaluationPublic {
  ratings: { id: string; playerId: string; score: number; createdAt: string; updatedAt: string }[]
  hiddenComments: (EvaluationComment & { hidden: boolean })[]
  commentVersions: Record<string, number>
}

export class EvaluationClientError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'EvaluationClientError' }
}

const invalid = (): never => { throw new EvaluationClientError('INVALID_RESPONSE', '评分服务返回异常，请重新加载。') }
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const id = (value: unknown, prefix: string, length = 32) => typeof value === 'string' && new RegExp(`^${prefix}_[a-f0-9]{${length}}$`).test(value)
const text = (value: unknown, max: number, required = true): value is string => typeof value === 'string' && (!required || !!value.trim()) && Array.from(value).length <= max
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max

export function parseEvaluationConfig(value: unknown): EvaluationConfig {
  const v = value as any
  if (!object(v) || !id(v.competitionId, 'c') || typeof v.enabled !== 'boolean' || typeof v.commentsEnabled !== 'boolean'
    || !integer(v.scoreMin, 1, 10) || !integer(v.scoreMax, v.scoreMin + 1, 10)
    || (v.openedAt !== null && !iso(v.openedAt)) || (v.closedAt !== null && !iso(v.closedAt))
    || v.openedAt && v.closedAt && Date.parse(v.openedAt) >= Date.parse(v.closedAt)
    || !integer(v.version, 0) || !iso(v.updatedAt)) return invalid()
  return { competitionId: v.competitionId, enabled: v.enabled, commentsEnabled: v.commentsEnabled, scoreMin: v.scoreMin, scoreMax: v.scoreMax, openedAt: v.openedAt, closedAt: v.closedAt, version: v.version, updatedAt: v.updatedAt }
}

function parsePlayer(value: any): EvaluationPlayerSummary {
  if (!object(value) || !id(value.playerId, 'p') || !text(value.playerName, 80) || !integer(value.number, 1, 99)
    || !id(value.teamId, 't', 64) || !text(value.teamName, 80) || !integer(value.ratingCount)
    || (value.ratingAverage !== null && (typeof value.ratingAverage !== 'number' || !Number.isFinite(value.ratingAverage) || value.ratingAverage < 1 || value.ratingAverage > 10))
    || !integer(value.commentCount) || (value.viewerScore !== null && !integer(value.viewerScore, 1, 10))) return invalid()
  return { playerId: value.playerId, playerName: value.playerName, number: value.number, teamId: value.teamId, teamName: value.teamName, ratingCount: value.ratingCount, ratingAverage: value.ratingAverage, viewerScore: value.viewerScore, commentCount: value.commentCount }
}

function parseComment(value: any): EvaluationComment {
  if (!object(value) || !id(value.id, 'ec') || !id(value.playerId, 'p') || !text(value.playerName, 80)
    || !id(value.teamId, 't', 64) || !text(value.teamName, 80) || !text(value.content, 300) || !iso(value.createdAt) || !iso(value.updatedAt)) return invalid()
  return { id: value.id, playerId: value.playerId, playerName: value.playerName, teamId: value.teamId, teamName: value.teamName, content: value.content, createdAt: value.createdAt, updatedAt: value.updatedAt }
}

function parseAward(value: any): EvaluationAward {
  if (!object(value) || !['mvp', 'lineup'].includes(value.type) || !id(value.playerId, 'p') || !text(value.playerName, 80)
    || !integer(value.number, 1, 99) || !id(value.teamId, 't', 64) || !text(value.teamName, 80)
    || (value.position !== null && !text(value.position, 40)) || !integer(value.rank, 1, 32)) return invalid()
  return { type: value.type, playerId: value.playerId, playerName: value.playerName, number: value.number, teamId: value.teamId, teamName: value.teamName, position: value.position, rank: value.rank }
}

export function parseEvaluationPublic(value: unknown): EvaluationPublic {
  const v = value as any
  if (!object(v) || v.ok !== true || !id(v.matchId, 'm') || !id(v.competitionId, 'c') || !['scheduled', 'postponed', 'live', 'finished'].includes(v.matchStatus)
    || typeof v.canRate !== 'boolean' || typeof v.canComment !== 'boolean' || !text(v.closedReason, 160, false)
    || !Array.isArray(v.players) || !Array.isArray(v.comments) || !Array.isArray(v.awards) || !integer(v.awardsVersion, 0)) return invalid()
  const players = v.players.map(parsePlayer), comments = v.comments.map(parseComment), awards = v.awards.map(parseAward)
  if (new Set(players.map(row => row.playerId)).size !== players.length || new Set(comments.map(row => row.id)).size !== comments.length) return invalid()
  const config = parseEvaluationConfig(v.config), playerIds = new Set(players.map(row => row.playerId))
  if (config.competitionId !== v.competitionId || comments.some(row => !playerIds.has(row.playerId)) || awards.some(row => !playerIds.has(row.playerId))
    || v.canComment && !v.canRate || v.canRate && (!config.enabled || v.matchStatus !== 'finished' || v.closedReason) || v.canComment && !config.commentsEnabled
    || awards.filter(row => row.type === 'mvp').length > 1) return invalid()
  for (const kind of ['mvp', 'lineup']) { const rows = awards.filter(row => row.type === kind); if (new Set(rows.map(row => row.playerId)).size !== rows.length || new Set(rows.map(row => row.rank)).size !== rows.length) return invalid() }
  return { matchId: v.matchId, competitionId: v.competitionId, matchStatus: v.matchStatus, config, canRate: v.canRate, canComment: v.canComment, closedReason: v.closedReason, players, comments, awards, awardsVersion: v.awardsVersion }
}

export function parseEvaluationAdmin(value: unknown): EvaluationAdmin {
  const base = parseEvaluationPublic(value), v = value as any
  if (!Array.isArray(v.ratings) || !Array.isArray(v.hiddenComments) || !object(v.commentVersions)) return invalid()
  const ratings = v.ratings.map((row: any) => {
    if (!object(row) || !id(row.id, 'er') || !id(row.playerId, 'p') || !integer(row.score, 1, 10) || !iso(row.createdAt) || !iso(row.updatedAt)) return invalid()
    return { id: row.id, playerId: row.playerId, score: row.score, createdAt: row.createdAt, updatedAt: row.updatedAt }
  })
  const hiddenComments = v.hiddenComments.map((row: any) => { if (row.hidden !== true) return invalid(); return { ...parseComment(row), hidden: true } })
  const commentVersions: Record<string, number> = {}
  for (const row of [...base.comments, ...hiddenComments]) { if (!integer(v.commentVersions[row.id], 1)) return invalid(); commentVersions[row.id] = v.commentVersions[row.id] }
  return { ...base, ratings, hiddenComments, commentVersions }
}

export function evaluationBeijingTime(value: string | null): string { return value ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16) : '' }
export function evaluationUtcTime(value: string): string | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}:00+08:00`))) throw new EvaluationClientError('INVALID_ARGUMENT', '请选择有效的北京时间。')
  const result = new Date(`${value}:00+08:00`).toISOString()
  if (evaluationBeijingTime(result) !== value) throw new EvaluationClientError('INVALID_ARGUMENT', '请选择有效的北京时间。')
  return result
}

export function evaluationRequestId() { return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('') }
