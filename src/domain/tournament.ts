import type { Match, Standing, Team, Tournament } from './types'

export const stageNames = { group: '小组赛', quarter: '1/4 决赛', semi: '半决赛', final: '决赛' } as const
export const statusNames = { scheduled: '未开始', live: '进行中', finished: '已结束', postponed: '已延期' } as const
export function findTeam(data: Tournament, id: string | null | undefined): Team | undefined { return data.teams.find(t => t.id === id) }
export function winnerId(match: Match): string | null {
  if (match.status !== 'finished' || match.homeScore === null || match.awayScore === null) return null
  if (match.homeScore > match.awayScore) return match.homeId
  if (match.awayScore > match.homeScore) return match.awayId
  if (!match.penalties || match.penalties[0] === match.penalties[1]) return null
  return match.penalties[0] > match.penalties[1] ? match.homeId : match.awayId
}
// Resolve advancement from the same match records used by cards and detail pages.
export function resolvedMatches(data: Tournament): Match[] {
  const cache = new Map<string, Match>()
  function resolve(match: Match, path = new Set<string>()): Match {
    if (cache.has(match.id)) return cache.get(match.id)!
    if (path.has(match.id)) throw new Error('淘汰赛签位存在循环引用')
    const nextPath = new Set(path).add(match.id)
    const sourceWinner = (id?: string) => { const source = data.matches.find(m => m.id === id); return source ? winnerId(resolve(source, nextPath)) : null }
    const result = { ...match, homeId: match.homeFrom ? sourceWinner(match.homeFrom) : match.homeId, awayId: match.awayFrom ? sourceWinner(match.awayFrom) : match.awayId }
    cache.set(match.id, result)
    return result
  }
  return data.matches.map(m => resolve(m))
}
export function standings(data: Tournament, group?: 'A' | 'B'): Standing[] {
  const rows = new Map(data.teams.filter(t => !group || t.group === group).map(team => [team.id, { team, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, difference: 0, points: 0 }]))
  for (const m of data.matches) {
    if (m.stage !== 'group' || m.status !== 'finished' || m.homeScore === null || m.awayScore === null) continue
    for (const [id, gf, ga] of [[m.homeId, m.homeScore, m.awayScore], [m.awayId, m.awayScore, m.homeScore]] as const) {
      const row = id ? rows.get(id) : undefined
      if (!row) continue
      row.played++; row.goalsFor += gf; row.goalsAgainst += ga
      if (gf > ga) { row.won++; row.points += 3 } else if (gf === ga) { row.drawn++; row.points++ } else row.lost++
      row.difference = row.goalsFor - row.goalsAgainst
    }
  }
  // Prototype rule: points, goal difference, goals scored, then stable team ID. Production rules remain configurable.
  return [...rows.values()].sort((a, b) => b.points - a.points || b.difference - a.difference || b.goalsFor - a.goalsFor || a.team.id.localeCompare(b.team.id))
}
export function playerRanking(data: Tournament, metric: 'goals' | 'assists') {
  const totals = new Map<string, number>()
  for (const match of data.matches) {
    if (match.status !== 'finished') continue
    for (const event of match.events) {
      if (event.kind !== 'goal') continue
      const id = metric === 'goals' ? event.playerId : event.assistPlayerId
      if (id) totals.set(id, (totals.get(id) ?? 0) + 1)
    }
  }
  return data.players.map(player => ({ player, team: findTeam(data, player.teamId)!, value: totals.get(player.id) ?? 0 }))
    .filter(row => row.value > 0).sort((a, b) => b.value - a.value || a.player.id.localeCompare(b.player.id))
}
export function filterMatches(matches: Match[], options: { date?: string; status?: string; teamId?: string }) {
  return matches.filter(m => (!options.date || m.date === options.date) && (!options.status || options.status === 'all' || m.status === options.status) && (!options.teamId || m.homeId === options.teamId || m.awayId === options.teamId))
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
}
export function dateLabel(date: string, withYear = false): string {
  const [year, month, day] = date.split('-').map(Number)
  return `${withYear ? `${year} 年 ` : ''}${month} 月 ${day} 日`
}
export function weekday(date: string): string { return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${date}T12:00:00+08:00`).getUTCDay()] }
export function participantLabel(match: Match, side: 'home' | 'away', data: Tournament): string {
  const team = findTeam(data, side === 'home' ? match.homeId : match.awayId)
  if (team) return team.name
  const from = side === 'home' ? match.homeFrom : match.awayFrom
  return from ? `${from.toUpperCase()} 胜者 · 待定` : '待定'
}
