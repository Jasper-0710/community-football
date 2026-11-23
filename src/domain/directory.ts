import { parsePublicTeam, parsePlayerProfile, safeContentImage, type PublicTeam, type PlayerProfile } from './content'
import { parseMatch, matchDate, type MatchSchedule } from './match'

export interface DirectoryCompetition { id: string; name: string }
export interface DirectoryMatch { competitionName: string; match: MatchSchedule }
export type PlayerEventKind = 'goal' | 'assist' | 'yellow' | 'red' | 'subIn' | 'subOut'
export interface PlayerMatch extends DirectoryMatch { events: { kind: PlayerEventKind; minute: number }[] }
export interface TeamRecordSummary { played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; difference: number }
export interface PlayerRecordSummary { goals: number; assists: number; yellow: number; red: number; eventMatches: number }
export interface ProfileRecord<S = TeamRecordSummary | PlayerRecordSummary> {
  competitionId: string | null
  competitions: DirectoryCompetition[]
  summary: S
  matches: (DirectoryMatch | PlayerMatch)[]
  total: number
  nextCursor: string | null
}
export interface TeamProfileData { team: PublicTeam; record: ProfileRecord<TeamRecordSummary> }
export interface PlayerProfileData { player: PlayerProfile; record: ProfileRecord<PlayerRecordSummary> }
export interface HomeTeam { id: string; name: string; district: string; playerCount: number; hasBadge: boolean; badgeUrl: string }
export interface PublicHome {
  today: string
  counts: { competitions: number; teams: number; matches: number; finished: number }
  matchday: { date: string | null; total: number; live: number; matches: DirectoryMatch[] }
  teams: HomeTeam[]
}
export class DirectoryClientError extends Error { readonly code = 'INVALID_RESPONSE'; constructor() { super('公开档案返回异常，请刷新后重试。') } }
const invalid = (): never => { throw new DirectoryClientError() }
const object = (v: any): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && Array.from(v).length <= max
const competitionId = (v: unknown): v is string => typeof v === 'string' && /^c_[a-f0-9]{32}$/.test(v)
const teamId = (v: unknown): v is string => typeof v === 'string' && /^t_[a-f0-9]{64}$/.test(v)
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
const unique = <T>(rows: T[], key: (row: T) => string) => new Set(rows.map(key)).size === rows.length
function parseDirectoryMatch(v: any): DirectoryMatch {
  if (!object(v) || !text(v.competitionName, 80)) return invalid()
  return { competitionName: v.competitionName, match: parseMatch(v.match) }
}
export const playerEventLabels: Record<PlayerEventKind, string> = { goal: '进球', assist: '助攻', yellow: '黄牌', red: '红牌', subIn: '换上', subOut: '换下' }
function parseRecord(v: any, team: string, selected: string | undefined, player: boolean): ProfileRecord {
  if (!object(v) || v.competitionId !== (selected || null) || !Array.isArray(v.competitions) || v.competitions.length > 2000 || !object(v.summary)
    || !Array.isArray(v.matches) || v.matches.length > 20 || !integer(v.total) || v.total < v.matches.length
    || v.nextCursor !== null && (typeof v.nextCursor !== 'string' || !/^[a-f0-9]{32}:\d{1,6}$/.test(v.nextCursor))) return invalid()
  const competitions = v.competitions.map((c: any): DirectoryCompetition => {
    if (!object(c) || !competitionId(c.id) || !text(c.name, 80)) return invalid()
    return { id: c.id, name: c.name }
  })
  if (!unique(competitions, c => c.id) || selected && !competitions.some(c => c.id === selected)) return invalid()
  const s = v.summary
  let summary: TeamRecordSummary | PlayerRecordSummary
  if (player) {
    if (!['goals', 'assists', 'yellow', 'red', 'eventMatches'].every(k => integer(s[k])) || s.eventMatches !== v.total) return invalid()
    summary = { goals: s.goals, assists: s.assists, yellow: s.yellow, red: s.red, eventMatches: s.eventMatches }
  } else {
    if (!['played', 'won', 'drawn', 'lost', 'goalsFor', 'goalsAgainst'].every(k => integer(s[k])) || s.played !== s.won + s.drawn + s.lost
      || s.played > v.total || s.difference !== s.goalsFor - s.goalsAgainst) return invalid()
    summary = { played: s.played, won: s.won, drawn: s.drawn, lost: s.lost, goalsFor: s.goalsFor, goalsAgainst: s.goalsAgainst, difference: s.difference }
  }
  const matches = v.matches.map((row: any): DirectoryMatch | PlayerMatch => {
    const entry = parseDirectoryMatch(row), m = entry.match
    if (![m.homeTeamId, m.awayTeamId].includes(team) || selected && m.competitionId !== selected || !competitions.some(c => c.id === m.competitionId && c.name === entry.competitionName)) return invalid()
    if (!player) return entry
    if (m.status !== 'finished' || !Array.isArray(row.events) || !row.events.length) return invalid()
    const events = row.events.map((e: any) => {
      if (!object(e) || !Object.prototype.hasOwnProperty.call(playerEventLabels, e.kind) || !integer(e.minute) || e.minute > 150) return invalid()
      return { kind: e.kind as PlayerEventKind, minute: e.minute as number }
    })
    return { ...entry, events }
  })
  if (!unique(matches, e => e.match.id)) return invalid()
  return { competitionId: v.competitionId, competitions, summary, matches, total: v.total, nextCursor: v.nextCursor }
}
export function parseTeamProfile(v: any, id: string, selected?: string): TeamProfileData {
  if (!object(v) || v.ok !== true) return invalid()
  const team = parsePublicTeam(v.team)
  if (team.id !== id) return invalid()
  return { team, record: parseRecord(v.record, id, selected, false) as ProfileRecord<TeamRecordSummary> }
}
export function parseFullPlayerProfile(v: any, id: string, teamId: string, selected?: string): PlayerProfileData {
  if (!object(v) || v.ok !== true) return invalid()
  const player = parsePlayerProfile(v.player)
  if (player.id !== id || player.teamId !== teamId) return invalid()
  return { player, record: parseRecord(v.record, teamId, selected, true) as ProfileRecord<PlayerRecordSummary> }
}
export function parsePublicHome(v: any): PublicHome {
  if (!object(v) || !date(v.today) || !object(v.counts) || !['competitions', 'teams', 'matches', 'finished'].every(k => integer(v.counts[k])) || v.counts.finished > v.counts.matches
    || !object(v.matchday) || v.matchday.date !== null && !date(v.matchday.date) || !integer(v.matchday.total) || !integer(v.matchday.live)
    || v.matchday.total > v.counts.matches || v.matchday.live > v.matchday.total || !Array.isArray(v.matchday.matches) || v.matchday.matches.length > 6
    || v.matchday.matches.length !== Math.min(v.matchday.total, 6) || (v.matchday.date === null) !== (v.matchday.total === 0)
    || !Array.isArray(v.teams) || v.teams.length !== Math.min(v.counts.teams, 6)) return invalid()
  const matches = v.matchday.matches.map(parseDirectoryMatch)
  if (!unique(matches, e => e.match.id) || matches.some(e => matchDate(e.match.scheduledAt) !== v.matchday.date)) return invalid()
  const teams = v.teams.map((t: any): HomeTeam => {
    if (!object(t) || !teamId(t.id) || !text(t.name, 80) || !text(t.district, 40) || !integer(t.playerCount) || t.playerCount > 99 || typeof t.hasBadge !== 'boolean'
      || t.badgeUrl !== '' && !safeContentImage(t.badgeUrl) || t.badgeUrl && !t.hasBadge) return invalid()
    return { id: t.id, name: t.name, district: t.district, playerCount: t.playerCount, hasBadge: t.hasBadge, badgeUrl: t.badgeUrl }
  })
  if (!unique(teams, t => t.id)) return invalid()
  return { today: v.today, counts: { competitions: v.counts.competitions, teams: v.counts.teams, matches: v.counts.matches, finished: v.counts.finished },
    matchday: { date: v.matchday.date, total: v.matchday.total, live: v.matchday.live, matches }, teams }
}
