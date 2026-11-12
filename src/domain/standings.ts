import { MatchClientError, parseMatch, type MatchSchedule } from './match'
export interface StandingsRules { winPoints: number; drawPoints: number; lossPoints: number; legs: number; groups: { id: string; teamIds: string[] }[] }
export interface StandingRow { teamId: string; teamName: string; rank: number; played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; difference: number; points: number }
export interface StandingGroup { id: string; complete: boolean; expectedMatches: number; scheduledMatches: number; finishedMatches: number; rows: StandingRow[] }
export interface PlayerRank { playerId: string; playerName: string; number: number; teamId: string; teamName: string; goals: number; assists: number; value: number; rank: number }
export interface ResultPlayer { id: string; name: string; number: number }
export interface ResultGoal { teamId: string; minute: number; ownGoal: boolean; scorer: ResultPlayer | null; assist: ResultPlayer | null }
export interface SavedResult { homeScore: number; awayScore: number; penalties: [number, number] | null; goals: ResultGoal[] }
export interface ResultInput { homeScore: number; awayScore: number; penalties: [number, number] | null; goals: { teamId: string; minute: number; ownGoal: boolean; scorerId: string | null; assistId: string | null }[] }
export interface RankedMatch extends MatchSchedule { result?: SavedResult | null }
export interface StandingsSnapshot { competitionId: string; revision: number; configured: boolean; rules: StandingsRules; groups: StandingGroup[]; goals: PlayerRank[]; assists: PlayerRank[]; matches: RankedMatch[]; championTeamId: string | null }
export interface ResultHistory { revisions: { version: number; reason: string; revoked: boolean; createdAt: string; result: SavedResult | null }[]; nextVersion: number | null }
const object = (v: any): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const nonnegative = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0
const positive = (v: unknown) => nonnegative(v) && Number(v) > 0
const teamId = (v: unknown) => typeof v === 'string' && /^t_[a-f0-9]{64}$/.test(v)
const playerId = (v: unknown) => typeof v === 'string' && /^p_[a-f0-9]{32}$/.test(v)
const name = (v: unknown) => typeof v === 'string' && !!v.trim()
const invalid = (): never => { throw new MatchClientError('INVALID_RESPONSE', '榜单服务返回异常，请重新读取。') }
function parseRules(v: any): StandingsRules {
  if (!object(v) || ![v.winPoints, v.drawPoints, v.lossPoints].every(x => nonnegative(x) && x <= 10) || v.winPoints <= v.drawPoints || v.drawPoints < v.lossPoints || ![1, 2].includes(v.legs) || !Array.isArray(v.groups) || v.groups.length > 16) return invalid()
  const ids = new Set<string>(), teams = new Set<string>()
  const groups = v.groups.map((group: any) => {
    if (!object(group) || !name(group.id) || ids.has(group.id) || !Array.isArray(group.teamIds) || group.teamIds.length < 2 || group.teamIds.length > 32) return invalid()
    ids.add(group.id)
    const teamIds = group.teamIds.map((id: unknown) => { if (!teamId(id) || teams.has(id as string)) return invalid(); teams.add(id as string); return id as string })
    return { id: group.id as string, teamIds }
  })
  return { winPoints: v.winPoints, drawPoints: v.drawPoints, lossPoints: v.lossPoints, legs: v.legs, groups }
}
function parseSavedResult(v: any): SavedResult | null {
  if (v === null) return null
  if (!object(v) || ![v.homeScore, v.awayScore].every(x => nonnegative(x) && x <= 99) || !Array.isArray(v.goals) || v.goals.length !== v.homeScore + v.awayScore) return invalid()
  if (v.penalties !== null && (!Array.isArray(v.penalties) || v.penalties.length !== 2 || !v.penalties.every((x: unknown) => nonnegative(x) && Number(x) <= 99) || v.penalties[0] === v.penalties[1] || v.homeScore !== v.awayScore)) return invalid()
  const player = (p: any): ResultPlayer | null => p === null ? null : object(p) && playerId(p.id) && name(p.name) && positive(p.number) && p.number <= 99 ? { id: p.id, name: p.name, number: p.number } : invalid()
  const goals = v.goals.map((goal: any): ResultGoal => {
    if (!object(goal) || !teamId(goal.teamId) || !nonnegative(goal.minute) || goal.minute > 150 || typeof goal.ownGoal !== 'boolean') return invalid()
    const scorer = player(goal.scorer), assist = player(goal.assist)
    if (goal.ownGoal ? scorer || assist : !scorer || scorer.id === assist?.id) return invalid()
    return { teamId: goal.teamId, minute: goal.minute, ownGoal: goal.ownGoal, scorer, assist }
  })
  return { homeScore: v.homeScore, awayScore: v.awayScore, penalties: v.penalties ? [v.penalties[0], v.penalties[1]] : null, goals }
}
export function parseStandings(v: any, admin = false): StandingsSnapshot {
  if (!object(v) || v.ok !== true || typeof v.competitionId !== 'string' || !/^c_[a-f0-9]{32}$/.test(v.competitionId) || !nonnegative(v.revision) || typeof v.configured !== 'boolean' || !Array.isArray(v.groups) || !Array.isArray(v.matches) || v.matches.length > 2048 || !Array.isArray(v.goals) || !Array.isArray(v.assists) || v.championTeamId !== null && !teamId(v.championTeamId)) return invalid()
  const rules = parseRules(v.rules)
  if (v.configured !== (rules.groups.length > 0) || v.groups.length !== rules.groups.length) return invalid()
  const groups = v.groups.map((g: any, index: number): StandingGroup => {
    const rule = rules.groups[index]
    if (!object(g) || g.id !== rule.id || typeof g.complete !== 'boolean' || ![g.expectedMatches, g.scheduledMatches, g.finishedMatches].every(nonnegative) || g.finishedMatches > g.scheduledMatches || !Array.isArray(g.rows) || g.rows.length !== rule.teamIds.length) return invalid()
    const seen = new Set<string>()
    const rows = g.rows.map((r: any): StandingRow => {
      if (!object(r) || !rule.teamIds.includes(r.teamId) || seen.has(r.teamId) || !name(r.teamName) || !positive(r.rank) || ![r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst, r.points].every(nonnegative) || !Number.isSafeInteger(r.difference) || r.difference !== r.goalsFor - r.goalsAgainst || r.played !== r.won + r.drawn + r.lost) return invalid()
      seen.add(r.teamId)
      return { teamId: r.teamId, teamName: r.teamName, rank: r.rank, played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst, difference: r.difference, points: r.points }
    })
    return { id: g.id, complete: g.complete, expectedMatches: g.expectedMatches, scheduledMatches: g.scheduledMatches, finishedMatches: g.finishedMatches, rows }
  })
  const ranks = (rows: any[]): PlayerRank[] => {
    const seen = new Set<string>()
    return rows.map(r => {
      const key = `${r?.teamId}:${r?.playerId}`
      if (!object(r) || !playerId(r.playerId) || !teamId(r.teamId) || seen.has(key) || !name(r.playerName) || !name(r.teamName) || !positive(r.rank) || !positive(r.number) || r.number > 99 || ![r.goals, r.assists].every(nonnegative) || !positive(r.value)) return invalid()
      seen.add(key)
      return { playerId: r.playerId, playerName: r.playerName, number: r.number, teamId: r.teamId, teamName: r.teamName, goals: r.goals, assists: r.assists, rank: r.rank, value: r.value }
    })
  }
  const matches = v.matches.map((match: any): RankedMatch => ({ ...parseMatch(match, admin), ...(admin ? { result: parseSavedResult(match.result) } : {}) }))
  if (new Set(matches.map((m: RankedMatch) => m.id)).size !== matches.length || matches.some((m: RankedMatch) => m.competitionId !== v.competitionId)) return invalid()
  return { competitionId: v.competitionId, revision: v.revision, configured: v.configured, rules, groups, goals: ranks(v.goals), assists: ranks(v.assists), matches, championTeamId: v.championTeamId }
}
export function parseResultHistory(v: any): ResultHistory {
  if (!object(v) || v.ok !== true || !Array.isArray(v.revisions) || v.revisions.length > 20 || v.nextVersion !== null && !positive(v.nextVersion)) return invalid()
  let last = Infinity
  const revisions = v.revisions.map((r: any) => {
    if (!object(r) || !positive(r.version) || r.version >= last || typeof r.revoked !== 'boolean' || !name(r.reason) || typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt))) return invalid()
    last = r.version
    return { version: r.version as number, reason: r.reason as string, revoked: r.revoked as boolean, createdAt: r.createdAt as string, result: parseSavedResult(r.result) }
  })
  return { revisions, nextVersion: v.nextVersion }
}
