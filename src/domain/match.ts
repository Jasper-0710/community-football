export type MatchStage = 'group' | 'quarter' | 'semi' | 'final'
export type MatchScheduleStatus = 'scheduled' | 'postponed'
export type MatchResultState = 'live' | 'finished'
export type MatchState = MatchScheduleStatus | MatchResultState
export type MatchCardKind = 'yellow' | 'red'
export interface GroupQualification { groupId: string; rank: number }
export const matchStageLabels: Record<MatchStage, string> = { group: '小组赛', quarter: '四分之一决赛', semi: '半决赛', final: '决赛' }
export const matchStatusLabels: Record<MatchState, string> = { scheduled: '已排赛', postponed: '已延期', live: '进行中', finished: '已完赛' }

export interface ResultPlayer { id: string; name: string; number: number }
export interface ResultGoal { teamId: string; minute: number; ownGoal: boolean; scorer: ResultPlayer | null; assist: ResultPlayer | null }
export interface ResultCard { teamId: string; minute: number; kind: MatchCardKind; player: ResultPlayer }
export interface ResultSubstitution { teamId: string; minute: number; playerIn: ResultPlayer; playerOut: ResultPlayer }
export interface MatchStats {
  possession: [number, number]
  shots: [number, number]
  shotsOnTarget: [number, number]
  corners: [number, number]
  fouls: [number, number]
  offsides: [number, number]
}
export interface SavedResult {
  state: MatchResultState
  minute: number | null
  homeScore: number
  awayScore: number
  penalties: [number, number] | null
  goals: ResultGoal[]
  cards: ResultCard[]
  substitutions: ResultSubstitution[]
  stats: MatchStats | null
}
export interface ResultInput {
  state?: MatchResultState
  minute?: number | null
  homeScore: number
  awayScore: number
  penalties: [number, number] | null
  goals: { teamId: string; minute: number; ownGoal: boolean; scorerId: string | null; assistId: string | null }[]
  cards?: { teamId: string; minute: number; kind: MatchCardKind; playerId: string }[]
  substitutions?: { teamId: string; minute: number; playerInId: string; playerOutId: string }[]
  stats?: MatchStats | null
}
export interface MatchScheduleForm {
  competitionId: string; stage: MatchStage; round: number; groupId: string | null; slot: number | null
  homeTeamId: string | null; awayTeamId: string | null; homeFrom: string | null; awayFrom: string | null
  scheduledAt: string; venue: string; status: MatchScheduleStatus
}
export interface MatchSchedule extends Omit<MatchScheduleForm, 'status'> {
  id: string; status: MatchState; homeScore: number | null; awayScore: number | null; updatedAt: string; version?: number; createdAt?: string
  penalties?: [number, number] | null; homeQualification?: GroupQualification | null; awayQualification?: GroupQualification | null
  homeTeamName?: string | null; awayTeamName?: string | null
  result?: SavedResult | null
}
export interface MatchSchedulePage<T = MatchSchedule> { matches: T[]; nextCursor: string | null }
export class MatchClientError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = 'MatchClientError' } }
const invalid = (): never => { throw new MatchClientError('INVALID_RESPONSE', '赛程服务返回异常，请重新读取。') }
const iso = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const score = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 99
const minute = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 150
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const resultPlayerId = (value: unknown) => typeof value === 'string' && /^p_[a-f0-9]{32}$/.test(value)
const playerName = (value: unknown) => typeof value === 'string' && !!value.trim() && value.length <= 80
const resultTeamId = (value: unknown) => typeof value === 'string' && /^t_[a-f0-9]{64}$/.test(value)
const statPair = (value: unknown, max: number) => Array.isArray(value) && value.length === 2 && value.every(item => Number.isSafeInteger(item) && item >= 0 && item <= max)
const exact = (value: unknown, allowed: string[]) => object(value) && Object.keys(value).every(key => allowed.includes(key))
function parseResultPlayer(value: any): ResultPlayer | null {
  if (value === null) return null
  if (!exact(value, ['id', 'name', 'number']) || !resultPlayerId(value.id) || !playerName(value.name) || !Number.isSafeInteger(value.number) || value.number < 1 || value.number > 99) return invalid()
  return { id: value.id, name: value.name, number: value.number }
}
export function parseSavedResult(value: unknown): SavedResult | null {
  if (value === null || typeof value === 'undefined') return null
  const v = value as any
  const state = v.state || 'finished', minuteValue = typeof v.minute === 'undefined' ? null : v.minute
  const cardsInput = typeof v.cards === 'undefined' ? [] : v.cards, substitutionsInput = typeof v.substitutions === 'undefined' ? [] : v.substitutions
  const statsInput = typeof v.stats === 'undefined' ? null : v.stats, penaltiesInput = typeof v.penalties === 'undefined' ? null : v.penalties
  if (!exact(v, ['state', 'minute', 'homeScore', 'awayScore', 'penalties', 'goals', 'cards', 'substitutions', 'stats']) || !['live', 'finished'].includes(state) || (minuteValue !== null && !minute(minuteValue))
    || !score(v.homeScore) || !score(v.awayScore) || !Array.isArray(v.goals) || v.goals.length !== v.homeScore + v.awayScore
    || !Array.isArray(cardsInput) || !Array.isArray(substitutionsInput) || statsInput !== null && !object(statsInput)) return invalid()
  if (penaltiesInput !== null && (!Array.isArray(penaltiesInput) || penaltiesInput.length !== 2 || !penaltiesInput.every(score) || penaltiesInput[0] === penaltiesInput[1] || v.homeScore !== v.awayScore)) return invalid()
  if (state === 'live' && penaltiesInput !== null) return invalid()
  const goals = v.goals.map((goal: any): ResultGoal => {
    if (!exact(goal, ['teamId', 'minute', 'ownGoal', 'scorer', 'assist']) || !resultTeamId(goal.teamId) || !minute(goal.minute) || typeof goal.ownGoal !== 'boolean') return invalid()
    const scorer = parseResultPlayer(goal.scorer), assist = parseResultPlayer(goal.assist)
    if (goal.ownGoal ? scorer || assist : !scorer || scorer.id === assist?.id) return invalid()
    return { teamId: goal.teamId, minute: goal.minute, ownGoal: goal.ownGoal, scorer, assist }
  })
  const cards = cardsInput.map((card: any): ResultCard => {
    if (!exact(card, ['teamId', 'minute', 'kind', 'player']) || !resultTeamId(card.teamId) || !minute(card.minute) || !['yellow', 'red'].includes(card.kind)) return invalid()
    const player = parseResultPlayer(card.player)
    if (!player) return invalid()
    return { teamId: card.teamId, minute: card.minute, kind: card.kind, player }
  })
  const substitutions = substitutionsInput.map((change: any): ResultSubstitution => {
    if (!exact(change, ['teamId', 'minute', 'playerIn', 'playerOut']) || !resultTeamId(change.teamId) || !minute(change.minute)) return invalid()
    const playerIn = parseResultPlayer(change.playerIn), playerOut = parseResultPlayer(change.playerOut)
    if (!playerIn || !playerOut || playerIn.id === playerOut.id) return invalid()
    return { teamId: change.teamId, minute: change.minute, playerIn, playerOut }
  })
  let stats: MatchStats | null = null
  if (statsInput !== null) {
    if (!exact(statsInput, ['possession', 'shots', 'shotsOnTarget', 'corners', 'fouls', 'offsides']) || !statPair(statsInput.possession, 100) || !statPair(statsInput.shots, 99) || !statPair(statsInput.shotsOnTarget, 99)
      || !statPair(statsInput.corners, 99) || !statPair(statsInput.fouls, 99) || !statPair(statsInput.offsides, 99)) return invalid()
    stats = { possession: [statsInput.possession[0], statsInput.possession[1]], shots: [statsInput.shots[0], statsInput.shots[1]], shotsOnTarget: [statsInput.shotsOnTarget[0], statsInput.shotsOnTarget[1]], corners: [statsInput.corners[0], statsInput.corners[1]], fouls: [statsInput.fouls[0], statsInput.fouls[1]], offsides: [statsInput.offsides[0], statsInput.offsides[1]] }
  }
  return { state, minute: minuteValue, homeScore: v.homeScore, awayScore: v.awayScore, penalties: penaltiesInput ? [penaltiesInput[0], penaltiesInput[1]] : null, goals, cards, substitutions, stats }
}
const validQualification = (value: any) => value == null || typeof value.groupId === 'string' && value.groupId.trim() && Number.isSafeInteger(value.rank) && value.rank >= 1 && value.rank <= 32
const id = (value: unknown, prefix: string) => value === null || value === '' || typeof value === 'undefined' || typeof value !== 'string' || !new RegExp(`^${prefix}_[a-f0-9]{${prefix === 'm' ? 32 : 64}}$`).test(value) ? value == null || value === '' || typeof value === 'undefined' ? null : false : value
export function parseMatch(value: unknown, admin = false): MatchSchedule {
  const v = value as any
  if (!v || typeof v.id !== 'string' || !/^m_[a-f0-9]{32}$/.test(v.id) || !/^c_[a-f0-9]{32}$/.test(v.competitionId)
    || !['group', 'quarter', 'semi', 'final'].includes(v.stage) || !Number.isSafeInteger(v.round) || v.round < 1 || v.round > 128
    || (v.groupId !== null && typeof v.groupId !== 'string') || (v.slot !== null && (!Number.isSafeInteger(v.slot) || v.slot < 1 || v.slot > 128))
    || id(v.homeTeamId, 't') === false || id(v.awayTeamId, 't') === false || id(v.homeFrom, 'm') === false || id(v.awayFrom, 'm') === false
    || !iso(v.scheduledAt) || typeof v.venue !== 'string' || !v.venue.trim() || !['scheduled', 'postponed', 'live', 'finished'].includes(v.status)
    || (['live', 'finished'].includes(v.status) ? !score(v.homeScore) || !score(v.awayScore) : v.homeScore !== null || v.awayScore !== null) || !iso(v.updatedAt)
    || !validQualification(v.homeQualification) || !validQualification(v.awayQualification)
    || v.penalties != null && (!Array.isArray(v.penalties) || v.penalties.length !== 2 || !v.penalties.every(score) || v.penalties[0] === v.penalties[1] || v.stage === 'group' || v.status !== 'finished' || v.homeScore !== v.awayScore)
    || v.status === 'finished' && v.stage !== 'group' && v.homeScore === v.awayScore && v.penalties == null
    || Object.prototype.hasOwnProperty.call(v, 'homeTeamName') && v.homeTeamName !== null && typeof v.homeTeamName !== 'string'
    || Object.prototype.hasOwnProperty.call(v, 'awayTeamName') && v.awayTeamName !== null && typeof v.awayTeamName !== 'string'
    || admin && (!Number.isSafeInteger(v.version) || v.version < 1 || !iso(v.createdAt))) return invalid()
  const result = Object.prototype.hasOwnProperty.call(v, 'result') ? parseSavedResult(v.result) : undefined
  if (result && (result.state !== v.status || result.homeScore !== v.homeScore || result.awayScore !== v.awayScore || result.penalties?.[0] !== v.penalties?.[0] || result.penalties?.[1] !== v.penalties?.[1])) return invalid()
  return { id: v.id, competitionId: v.competitionId, stage: v.stage, round: v.round, groupId: v.groupId, slot: v.slot,
    homeTeamId: v.homeTeamId, awayTeamId: v.awayTeamId, homeFrom: v.homeFrom, awayFrom: v.awayFrom, scheduledAt: v.scheduledAt,
    venue: v.venue, status: v.status, homeScore: v.homeScore, awayScore: v.awayScore, updatedAt: v.updatedAt,
    penalties: v.penalties ? [v.penalties[0], v.penalties[1]] : null,
    homeQualification: v.homeQualification ? { groupId: v.homeQualification.groupId, rank: v.homeQualification.rank } : null,
    awayQualification: v.awayQualification ? { groupId: v.awayQualification.groupId, rank: v.awayQualification.rank } : null,
    ...(Object.prototype.hasOwnProperty.call(v, 'homeTeamName') ? { homeTeamName: v.homeTeamName } : {}),
    ...(Object.prototype.hasOwnProperty.call(v, 'awayTeamName') ? { awayTeamName: v.awayTeamName } : {}),
    ...(Object.prototype.hasOwnProperty.call(v, 'result') ? { result } : {}),
    ...(admin ? { version: v.version, createdAt: v.createdAt } : {}) }
}
export function parseMatchPage(value: unknown, admin = false): MatchSchedulePage {
  const v = value as any
  if (!v || !Array.isArray(v.matches) || v.matches.length > 20 || v.nextCursor !== null && (typeof v.nextCursor !== 'string' || !/^m_[a-f0-9]{32}$/.test(v.nextCursor))) return invalid()
  const matches = v.matches.map((match: unknown) => parseMatch(match, admin))
  if (new Set(matches.map((match: MatchSchedule) => match.id)).size !== matches.length) return invalid()
  return { matches, nextCursor: v.nextCursor }
}
export function matchTime(value: string) {
  const date = new Date(Date.parse(value) + 8 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}
export function matchDate(value: string) { return matchTime(value).slice(0, 10) }
export function filterMatchSchedule(matches: MatchSchedule[], filters: { date?: string; teamId?: string; status?: MatchState | '' }) {
  return matches.filter(match => (!filters.date || matchDate(match.scheduledAt) === filters.date)
    && (!filters.teamId || match.homeTeamId === filters.teamId || match.awayTeamId === filters.teamId)
    && (!filters.status || match.status === filters.status))
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) || a.id.localeCompare(b.id))
}
