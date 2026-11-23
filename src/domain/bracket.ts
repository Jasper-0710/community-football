import { matchStageLabels, type MatchSchedule } from './match'
import type { StandingsSnapshot } from './standings'

const stages = ['quarter', 'semi', 'final'] as const
type KnockoutStage = typeof stages[number]
export type BracketSide = 'home' | 'away'
export const bracketGeometry = { cardWidth: 264, cardHeight: 288, columnGap: 72, rowGap: 32, padding: 16, heading: 64, homeAnchor: 74, awayAnchor: 138 }
export interface BracketParticipant { side: BracketSide; name: string; source: string; pending: boolean; score: number | null; winner: boolean }
export interface BracketNode { match: MatchSchedule; x: number; y: number; participants: BracketParticipant[]; winnerId: string | null }
export interface BracketLine { x: number; y: number; width: number; height: number }
export interface BracketEdge { id: string; from: string; to: string; side: BracketSide | 'champion'; confirmed: boolean; segments: BracketLine[] }
export interface BracketGraph {
  width: number; height: number; nodes: BracketNode[]; edges: BracketEdge[];
  columns: { stage: KnockoutStage; label: string; x: number; count: number }[];
  champion: { x: number; y: number; name: string | null } | null;
}

// The public snapshot is already resolved by the server. A live lead is not a winner.
export function knockoutWinner(match: MatchSchedule): string | null {
  if (match.stage === 'group' || match.status !== 'finished' || !match.homeTeamId || !match.awayTeamId || match.homeTeamId === match.awayTeamId || match.homeScore === null || match.awayScore === null) return null
  if (match.homeScore !== match.awayScore) return match.homeScore > match.awayScore ? match.homeTeamId : match.awayTeamId
  const penalties = match.penalties
  return penalties && penalties[0] !== penalties[1] ? penalties[0] > penalties[1] ? match.homeTeamId : match.awayTeamId : null
}
export function bracketSource(match: MatchSchedule, side: BracketSide, byId: ReadonlyMap<string, MatchSchedule>): string {
  const q = match[`${side}Qualification`], from = match[`${side}From`]
  if (q) return `${q.groupId} 第${q.rank}名`
  const previous = from ? byId.get(from) : null
  return previous ? `${matchStageLabels[previous.stage]} 第${previous.slot ?? previous.round}${previous.slot === null ? '轮' : '场'}胜者` : from ? '前序比赛胜者（来源未公开）' : ''
}
const compare = (a: MatchSchedule, b: MatchSchedule) => (a.slot ?? a.round) - (b.slot ?? b.round) || a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id)

export function buildBracket(snapshot: StandingsSnapshot): BracketGraph {
  const g = bracketGeometry, byId = new Map(snapshot.matches.map(m => [m.id, m]))
  const matches = snapshot.matches.filter(m => stages.includes(m.stage as KnockoutStage))
  const byStage = stages.map(stage => ({ stage, matches: matches.filter(m => m.stage === stage).sort(compare) })).filter(c => c.matches.length)
  const ordered = new Map<KnockoutStage, MatchSchedule[]>(stages.map(stage => [stage, []]))
  const visited = new Set<string>(), leafRows = new Map<string, number>()
  let leaf = 0
  // Actual home/away sources determine order. Slot numbers never invent pairings.
  const sources = (match: MatchSchedule) => (['home', 'away'] as const).flatMap(side => {
    if (match[`${side}Qualification`]) return []
    const from = match[`${side}From`], source = from ? byId.get(from) : null
    return source && stages.includes(source.stage as KnockoutStage) && stages.indexOf(source.stage as KnockoutStage) < stages.indexOf(match.stage as KnockoutStage) ? [{ side, match: source }] : []
  })
  function visit(match: MatchSchedule) {
    if (visited.has(match.id)) return
    visited.add(match.id)
    const parents = sources(match)
    parents.forEach(parent => visit(parent.match))
    if (!parents.length) leafRows.set(match.id, leaf++)
    ordered.get(match.stage as KnockoutStage)!.push(match)
  }
  for (const column of [...byStage].reverse()) column.matches.forEach(visit)
  const columns = byStage.map((c, index) => ({ stage: c.stage, label: matchStageLabels[c.stage], x: g.padding + index * (g.cardWidth + g.columnGap), count: c.matches.length }))
  const positioned = new Map<string, BracketNode>(), nodes: BracketNode[] = []
  for (const column of columns) {
    let bottom = -g.rowGap
    for (const match of ordered.get(column.stage)!) {
      const parents = sources(match).map(parent => positioned.get(parent.match.id)!).filter(Boolean)
      const ideal = parents.length ? parents.reduce((sum, parent) => sum + parent.y, 0) / parents.length : (leafRows.get(match.id) || 0) * (g.cardHeight + g.rowGap)
      const y = Math.max(ideal, bottom + g.rowGap), winnerId = knockoutWinner(match)
      const participants = (['home', 'away'] as const).map(side => {
        const id = match[`${side}TeamId`], source = bracketSource(match, side, byId)
        return { side, name: id ? match[`${side}TeamName`] || '参赛球队' : '待定', source, pending: !id,
          score: id && ['live', 'finished'].includes(match.status) ? match[`${side}Score`] : null, winner: !!id && id === winnerId }
      })
      const node = { match, x: column.x, y, participants, winnerId }
      nodes.push(node); positioned.set(match.id, node); bottom = y + g.cardHeight
    }
  }
  const edges: BracketEdge[] = []
  function connect(from: BracketNode, to: string, side: BracketSide | 'champion', x: number, y: number, confirmed: boolean) {
    const startX = from.x + g.cardWidth, startY = from.y + g.cardHeight / 2 + g.heading, endY = y + g.heading
    const bend = x - g.columnGap / (side === 'away' ? 3 : 2)
    edges.push({ id: `${from.match.id}:${to}:${side}`, from: from.match.id, to, side, confirmed, segments: [
      { x: startX, y: startY, width: bend - startX, height: 2 },
      { x: bend, y: Math.min(startY, endY), width: 2, height: Math.max(2, Math.abs(endY - startY) + 2) },
      { x: bend, y: endY, width: x - bend, height: 2 },
    ] })
  }
  for (const node of nodes) for (const parent of sources(node.match)) {
    const from = positioned.get(parent.match.id)!, team = node.match[`${parent.side}TeamId`]
    connect(from, node.match.id, parent.side, node.x, node.y + (parent.side === 'home' ? g.homeAnchor : g.awayAnchor), !!from.winnerId && from.winnerId === team)
  }
  const finals = nodes.filter(node => node.match.stage === 'final')
  let champion: BracketGraph['champion'] = null
  if (finals.length === 1) {
    const final = finals[0], winner = final.participants.find(p => p.winner)
    const name = winner && final.winnerId === snapshot.championTeamId ? winner.name : null
    champion = { x: final.x + g.cardWidth + g.columnGap, y: final.y, name }
    connect(final, 'champion', 'champion', champion.x, champion.y + g.cardHeight / 2, !!name)
  }
  const count = columns.length + (champion ? 1 : 0)
  return { nodes, edges, columns, champion, width: count ? g.padding * 2 + count * g.cardWidth + (count - 1) * g.columnGap : 0,
    height: nodes.length ? Math.max(...nodes.map(node => node.y)) + g.cardHeight + g.heading + g.padding : 0 }
}
