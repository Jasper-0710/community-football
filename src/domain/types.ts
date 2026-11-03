export type Tab = 'home' | 'tournament' | 'news' | 'stats' | 'profile'
export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'postponed'
export type Stage = 'group' | 'quarter' | 'semi' | 'final'
export type NewsCategory = '公告' | '战报' | '故事' | '快讯'
export interface Team { id: string; name: string; shortName: string; district: string; group: 'A' | 'B'; color: string; badge: string; founded: number; description: string }
export interface Player { id: string; teamId: string; name: string; number: number; position: string }
export interface MatchEvent { id: string; minute: number; kind: 'goal' | 'yellow' | 'substitution'; teamId: string; playerId?: string; assistPlayerId?: string; label?: string }
export interface Match {
  id: string; stage: Stage; date: string; time: string; venue: string; status: MatchStatus;
  homeId: string | null; awayId: string | null; homeFrom?: string; awayFrom?: string;
  homeScore: number | null; awayScore: number | null; minute?: number;
  penalties?: [number, number]; events: MatchEvent[];
  stats?: { possession: [number, number]; shots: [number, number]; shotsOnTarget: [number, number]; corners: [number, number] }
}
export interface Article { id: string; category: NewsCategory; title: string; excerpt: string; date: string; image?: string; author: string; paragraphs: string[]; featured?: boolean }
export interface Tournament {
  id: string; name: string; season: string; demoDate: string; updatedAt: string;
  teams: Team[]; players: Player[]; matches: Match[]; articles: Article[]
}
export interface Standing { team: Team; played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; difference: number; points: number }
