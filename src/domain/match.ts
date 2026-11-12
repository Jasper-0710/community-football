export type MatchStage = 'group' | 'quarter' | 'semi' | 'final'
export type MatchScheduleStatus = 'scheduled' | 'postponed'
export type MatchState = MatchScheduleStatus | 'finished'
export interface GroupQualification { groupId: string; rank: number }
export const matchStageLabels: Record<MatchStage, string> = { group: '小组赛', quarter: '四分之一决赛', semi: '半决赛', final: '决赛' }
export const matchStatusLabels: Record<MatchState, string> = { scheduled: '已排赛', postponed: '已延期', finished: '已完赛' }
export interface MatchScheduleForm {
  competitionId: string; stage: MatchStage; round: number; groupId: string | null; slot: number | null
  homeTeamId: string | null; awayTeamId: string | null; homeFrom: string | null; awayFrom: string | null
  scheduledAt: string; venue: string; status: MatchScheduleStatus
}
export interface MatchSchedule extends Omit<MatchScheduleForm, 'status'> {
  id: string; status: MatchState; homeScore: number | null; awayScore: number | null; updatedAt: string; version?: number; createdAt?: string
  penalties?: [number, number] | null; homeQualification?: GroupQualification | null; awayQualification?: GroupQualification | null
  homeTeamName?: string | null; awayTeamName?: string | null
}
export interface MatchSchedulePage<T = MatchSchedule> { matches: T[]; nextCursor: string | null }
export class MatchClientError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = 'MatchClientError' } }
const invalid = (): never => { throw new MatchClientError('INVALID_RESPONSE', '赛程服务返回异常，请重新读取。') }
const iso = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const score = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 99
const validQualification = (value: any) => value == null || typeof value.groupId === 'string' && value.groupId.trim() && Number.isSafeInteger(value.rank) && value.rank >= 1 && value.rank <= 32
const id = (value: unknown, prefix: string) => value === null || value === '' || typeof value === 'undefined' || typeof value !== 'string' || !new RegExp(`^${prefix}_[a-f0-9]{${prefix === 'm' ? 32 : 64}}$`).test(value) ? value == null || value === '' || typeof value === 'undefined' ? null : false : value
export function parseMatch(value: unknown, admin = false): MatchSchedule {
  const v = value as any
  if (!v || typeof v.id !== 'string' || !/^m_[a-f0-9]{32}$/.test(v.id) || !/^c_[a-f0-9]{32}$/.test(v.competitionId)
    || !['group', 'quarter', 'semi', 'final'].includes(v.stage) || !Number.isSafeInteger(v.round) || v.round < 1 || v.round > 128
    || (v.groupId !== null && typeof v.groupId !== 'string') || (v.slot !== null && (!Number.isSafeInteger(v.slot) || v.slot < 1 || v.slot > 128))
    || id(v.homeTeamId, 't') === false || id(v.awayTeamId, 't') === false || id(v.homeFrom, 'm') === false || id(v.awayFrom, 'm') === false
    || !iso(v.scheduledAt) || typeof v.venue !== 'string' || !v.venue.trim() || !['scheduled', 'postponed', 'finished'].includes(v.status)
    || (v.status === 'finished' ? !score(v.homeScore) || !score(v.awayScore) : v.homeScore !== null || v.awayScore !== null) || !iso(v.updatedAt)
    || !validQualification(v.homeQualification) || !validQualification(v.awayQualification)
    || v.penalties != null && (!Array.isArray(v.penalties) || v.penalties.length !== 2 || !v.penalties.every(score) || v.penalties[0] === v.penalties[1] || v.stage === 'group' || v.status !== 'finished' || v.homeScore !== v.awayScore)
    || v.status === 'finished' && v.stage !== 'group' && v.homeScore === v.awayScore && v.penalties == null
    || Object.prototype.hasOwnProperty.call(v, 'homeTeamName') && v.homeTeamName !== null && typeof v.homeTeamName !== 'string'
    || Object.prototype.hasOwnProperty.call(v, 'awayTeamName') && v.awayTeamName !== null && typeof v.awayTeamName !== 'string'
    || admin && (!Number.isSafeInteger(v.version) || v.version < 1 || !iso(v.createdAt))) return invalid()
  return { id: v.id, competitionId: v.competitionId, stage: v.stage, round: v.round, groupId: v.groupId, slot: v.slot,
    homeTeamId: v.homeTeamId, awayTeamId: v.awayTeamId, homeFrom: v.homeFrom, awayFrom: v.awayFrom, scheduledAt: v.scheduledAt,
    venue: v.venue, status: v.status, homeScore: v.homeScore, awayScore: v.awayScore, updatedAt: v.updatedAt,
    penalties: v.penalties ? [v.penalties[0], v.penalties[1]] : null,
    homeQualification: v.homeQualification ? { groupId: v.homeQualification.groupId, rank: v.homeQualification.rank } : null,
    awayQualification: v.awayQualification ? { groupId: v.awayQualification.groupId, rank: v.awayQualification.rank } : null,
    ...(Object.prototype.hasOwnProperty.call(v, 'homeTeamName') ? { homeTeamName: v.homeTeamName } : {}),
    ...(Object.prototype.hasOwnProperty.call(v, 'awayTeamName') ? { awayTeamName: v.awayTeamName } : {}),
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
