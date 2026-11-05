export const competitionFormats = [
  { value: 'group_knockout', label: '小组赛＋淘汰赛' }, { value: 'round_robin', label: '循环赛' },
  { value: 'knockout', label: '淘汰赛' }, { value: 'other', label: '其他赛制' },
] as const
export type CompetitionFormat = typeof competitionFormats[number]['value']
export type RegistrationStatus = 'disabled' | 'upcoming' | 'open' | 'closed'
export interface RegistrationConfig { projects: string[]; teamLimit: number | null; minPlayers: number; maxPlayers: number }
export interface RegistrationStats { pending: number; approved: number; occupied: number }
export interface CompetitionForm {
  name: string; description: string; format: CompetitionFormat; formatDescription: string
  startDate: string; endDate: string; venue: string; registrationRequirements: string
  registrationStartAt: string | null; registrationEndAt: string | null
  registrationConfig?: RegistrationConfig | null
}
export interface PublicCompetition extends CompetitionForm {
  id: string; registrationEnabled: boolean; registrationStatus: RegistrationStatus; updatedAt: string
  registrationRulesVersion: number; registrationStats: RegistrationStats
}
export interface AdminCompetition extends PublicCompetition { displayEnabled: boolean; version: number; createdAt: string }
export interface CompetitionPage<T = PublicCompetition> { competitions: T[]; nextCursor: string | null }
export const registrationLabels: Record<RegistrationStatus, string> = { disabled: '报名未开放', upcoming: '报名即将开始', open: '报名开放中', closed: '报名已截止' }
export class CompetitionClientError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = 'CompetitionClientError' } }
export function parseRegistrationConfig(v: any): RegistrationConfig | null {
  if (v == null) return null
  if (!Array.isArray(v.projects) || v.projects.length < 1 || v.projects.length > 20 || v.projects.some((s: unknown) => typeof s !== 'string' || !s.trim() || Array.from(s).length > 40) || new Set(v.projects).size !== v.projects.length || v.teamLimit !== null && (!Number.isSafeInteger(v.teamLimit) || v.teamLimit < 1 || v.teamLimit > 10000) || ![v.minPlayers,v.maxPlayers].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 200) || v.maxPlayers < v.minPlayers) throw new CompetitionClientError('INVALID_RESPONSE','报名配置返回异常，请重新读取。')
  return {projects:[...v.projects],teamLimit:v.teamLimit,minPlayers:v.minPlayers,maxPlayers:v.maxPlayers}
}
export function parseRegistrationStats(v: any): RegistrationStats {
  if (!v || !['pending','approved','occupied'].every(k => Number.isSafeInteger(v[k]) && v[k] >= 0) || v.pending + v.approved !== v.occupied) throw new CompetitionClientError('INVALID_RESPONSE','报名统计返回异常，请重新读取。')
  return {pending:v.pending,approved:v.approved,occupied:v.occupied}
}
export function formatLabel(value: string) { return competitionFormats.find(f => f.value === value)?.label || '其他赛制' }
export function competitionTime(value: string | null): string {
  if (!value) return '待公布'
  const d = new Date(Date.parse(value) + 8 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
export function parseCompetition(value: unknown, admin: true): AdminCompetition
export function parseCompetition(value: unknown, admin?: false): PublicCompetition
export function parseCompetition(value: unknown, admin = false): PublicCompetition | AdminCompetition {
  const v = value as any
  const strings = ['name', 'description', 'formatDescription', 'venue', 'registrationRequirements']
  const iso = (s: unknown) => typeof s === 'string' && Number.isFinite(Date.parse(s))
  if (!v || typeof v.id !== 'string' || !/^c_[a-f0-9]{32}$/.test(v.id) || strings.some(k => typeof v[k] !== 'string' || !v[k].trim())
    || !competitionFormats.some(f => f.value === v.format) || !/^\d{4}-\d{2}-\d{2}$/.test(v.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(v.endDate)
    || typeof v.registrationEnabled !== 'boolean' || !Object.prototype.hasOwnProperty.call(registrationLabels, v.registrationStatus) || !iso(v.updatedAt)
    || [v.registrationStartAt, v.registrationEndAt].some(s => s !== null && !iso(s))
    || admin && (typeof v.displayEnabled !== 'boolean' || !Number.isSafeInteger(v.version) || v.version < 1 || !iso(v.createdAt))) {
    throw new CompetitionClientError('INVALID_RESPONSE', '赛事服务返回异常，请重试。')
  }
  const result: PublicCompetition = { id: v.id, name: v.name, description: v.description, format: v.format, formatDescription: v.formatDescription,
    startDate: v.startDate, endDate: v.endDate, venue: v.venue, registrationRequirements: v.registrationRequirements,
    registrationStartAt: v.registrationStartAt, registrationEndAt: v.registrationEndAt, registrationEnabled: v.registrationEnabled,
    registrationStatus: v.registrationStatus, updatedAt: v.updatedAt, registrationConfig:parseRegistrationConfig(v.registrationConfig),
    registrationRulesVersion: v.registrationRulesVersion ?? 1, registrationStats:parseRegistrationStats(v.registrationStats ?? {pending:0,approved:0,occupied:0}) }
  if (!Number.isSafeInteger(result.registrationRulesVersion) || result.registrationRulesVersion < 1) throw new CompetitionClientError('INVALID_RESPONSE','报名版本返回异常。')
  return admin ? { ...result, displayEnabled: v.displayEnabled, version: v.version, createdAt: v.createdAt } : result
}
export function parseCompetitionPage(value: unknown, admin: true): CompetitionPage<AdminCompetition>
export function parseCompetitionPage(value: unknown, admin?: false): CompetitionPage
export function parseCompetitionPage(value: unknown, admin = false): CompetitionPage {
  const v = value as any
  if (!v || !Array.isArray(v.competitions) || v.competitions.length > 20 || (v.nextCursor !== null && (typeof v.nextCursor !== 'string' || !/^c_[a-f0-9]{32}$/.test(v.nextCursor)))) throw new CompetitionClientError('INVALID_RESPONSE', '赛事列表返回异常，请重试。')
  return { competitions: v.competitions.map((c: unknown) => admin ? parseCompetition(c, true) : parseCompetition(c)), nextCursor: v.nextCursor }
}
