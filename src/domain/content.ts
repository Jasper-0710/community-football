export const newsCategories = ['快讯', '战报', '公告', '深度', '独家'] as const
export type ContentCategory = typeof newsCategories[number]
export type NewsBlock = { type: 'text'; text: string } | { type: 'image'; url: string; caption: string; imageId?: string | null }
export interface NewsForm { title: string; category: ContentCategory; excerpt: string; author: string; coverUrl: string; coverImageId?: string | null; body: NewsBlock[]; status: 'draft' | 'published'; pinned: boolean; competitionId: string | null }
export interface NewsArticle extends Omit<NewsForm, 'body' | 'status'> { body?: NewsBlock[]; status?: 'draft' | 'published'; id: string; publishedAt: string | null; updatedAt: string; createdAt?: string; version?: number }
export type SearchKind = 'team' | 'player' | 'match' | 'news'
export const searchKinds: { id: 'all' | SearchKind; label: string }[] = [{ id: 'all', label: '全部' }, { id: 'team', label: '球队' }, { id: 'player', label: '球员' }, { id: 'match', label: '比赛' }, { id: 'news', label: '新闻' }]
export interface SearchItem { kind: SearchKind; id: string; title: string; detail: string; rank: number; teamId?: string; competitionId?: string }
export interface SearchPage { results: SearchItem[]; counts: Record<SearchKind, number>; nextCursor: string | null; total: number }
export interface PublicPlayer { id: string; name: string; number: number; position: string }
export interface PublicTeam { id: string; name: string; district: string; description: string; players: PublicPlayer[] }
export interface PlayerProfile extends PublicPlayer { teamId: string; teamName: string; district: string }
export interface ContentOverview { counts: { teams: number; matches: number; goals: number; news: number; publishedNews: number }; recentNews: NewsArticle[]; serverTime: string }
export class ContentClientError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = 'ContentClientError' } }
const invalid = (): never => { throw new ContentClientError('INVALID_RESPONSE', '内容服务返回异常，请重新加载。') }
const object = (v: any): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const validText = (v: unknown, max: number, required = true): v is string => typeof v === 'string' && (!required || !!v.trim()) && Array.from(v).length <= max
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
const cursor = (v: unknown): v is string | null => v === null || typeof v === 'string' && /^[a-f0-9]{32}:\d{1,6}$/.test(v)
const ids = { team: /^t_[a-f0-9]{64}$/, player: /^p_[a-f0-9]{32}$/, match: /^m_[a-f0-9]{32}$/, news: /^n_[a-f0-9]{32}$/ }
export function safeContentImage(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 2000) return false
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !u.hash } catch { return false }
}
export function parseNewsArticle(v: unknown, admin = false, full = false): NewsArticle {
  if (!object(v) || typeof v.id !== 'string' || !ids.news.test(v.id) || !validText(v.title, 80) || !newsCategories.includes(v.category) || !validText(v.excerpt, 200, false) || !validText(v.author, 40) || v.coverUrl !== '' && !safeContentImage(v.coverUrl) || typeof v.pinned !== 'boolean' || v.competitionId !== null && (typeof v.competitionId !== 'string' || !/^c_[a-f0-9]{32}$/.test(v.competitionId)) || v.publishedAt !== null && !iso(v.publishedAt) || !iso(v.updatedAt) || !admin && v.publishedAt === null || admin && (!['draft', 'published'].includes(v.status) || !integer(v.version) || v.version < 1 || !iso(v.createdAt))) return invalid()
  const out: NewsArticle = { id: v.id, title: v.title, category: v.category, excerpt: v.excerpt, author: v.author, coverUrl: v.coverUrl, pinned: v.pinned, competitionId: v.competitionId, publishedAt: v.publishedAt, updatedAt: v.updatedAt }
  if (full) {
    if (!Array.isArray(v.body) || !v.body.length || v.body.length > 30) return invalid()
    out.body = v.body.map((b: any): NewsBlock => {
      if (object(b) && b.type === 'text' && validText(b.text, 2000)) return { type: 'text', text: b.text }
      if (object(b) && b.type === 'image' && safeContentImage(b.url) && validText(b.caption, 100, false)) {
        if (admin && b.imageId != null && (typeof b.imageId !== 'string' || !/^ni_[a-f0-9]{32}$/.test(b.imageId))) return invalid()
        return { type: 'image', url: b.url, caption: b.caption, ...(admin && b.imageId ? {imageId:b.imageId} : {}) }
      }
      return invalid()
    })
  }
  if (admin) {
    if (v.coverImageId != null && (typeof v.coverImageId !== 'string' || !/^ni_[a-f0-9]{32}$/.test(v.coverImageId))) return invalid()
    Object.assign(out, { status: v.status, version: v.version, createdAt: v.createdAt, coverImageId:v.coverImageId || null })
  }
  return out
}
export function parseNewsPage(v: any, admin = false) {
  if (!object(v) || v.ok !== true || !Array.isArray(v.articles) || v.articles.length > 20 || !cursor(v.nextCursor) || !integer(v.total) || v.total < v.articles.length) return invalid()
  const articles = v.articles.map(a => parseNewsArticle(a, admin))
  if (new Set(articles.map(a => a.id)).size !== articles.length) return invalid()
  return { articles, nextCursor: v.nextCursor as string | null, total: v.total as number }
}
export function parseSearchPage(v: any): SearchPage {
  if (!object(v) || v.ok !== true || !Array.isArray(v.results) || v.results.length > 20 || !cursor(v.nextCursor) || !integer(v.total) || v.total < v.results.length || !object(v.counts) || !Object.keys(ids).every(k => integer(v.counts[k]))) return invalid()
  const results = v.results.map((r: any): SearchItem => {
    if (!object(r) || !Object.prototype.hasOwnProperty.call(ids, r.kind) || typeof r.id !== 'string' || !ids[r.kind as SearchKind].test(r.id) || !validText(r.title, 200) || !validText(r.detail, 500, false) || !integer(r.rank) || r.rank > 3 || ['team', 'player'].includes(r.kind) && (typeof r.teamId !== 'string' || !ids.team.test(r.teamId)) || r.kind === 'match' && (typeof r.competitionId !== 'string' || !/^c_[a-f0-9]{32}$/.test(r.competitionId))) return invalid()
    return { kind: r.kind, id: r.id, title: r.title, detail: r.detail, rank: r.rank, ...(r.teamId ? { teamId: r.teamId } : {}), ...(r.competitionId ? { competitionId: r.competitionId } : {}) }
  })
  if (new Set(results.map(r => `${r.kind}:${r.id}`)).size !== results.length) return invalid()
  return { results, counts: { team: v.counts.team, player: v.counts.player, match: v.counts.match, news: v.counts.news }, nextCursor: v.nextCursor, total: v.total }
}
function parsePlayer(v: any): PublicPlayer {
  if (!object(v) || typeof v.id !== 'string' || !ids.player.test(v.id) || !validText(v.name, 80) || !integer(v.number) || v.number < 1 || v.number > 99 || !['goalkeeper', 'defender', 'midfielder', 'forward'].includes(v.position)) return invalid()
  return { id: v.id, name: v.name, number: v.number, position: v.position }
}
export function parsePublicTeam(v: any): PublicTeam {
  if (!object(v) || typeof v.id !== 'string' || !ids.team.test(v.id) || !validText(v.name, 80) || !validText(v.district, 40) || !validText(v.description, 1000, false) || !Array.isArray(v.players) || v.players.length > 99) return invalid()
  const players = v.players.map(parsePlayer)
  if (new Set(players.map(p => p.id)).size !== players.length) return invalid()
  return { id: v.id, name: v.name, district: v.district, description: v.description, players }
}
export function parsePlayerProfile(v: any): PlayerProfile {
  const p = parsePlayer(v)
  if (typeof v.teamId !== 'string' || !ids.team.test(v.teamId) || !validText(v.teamName, 80) || !validText(v.district, 40)) return invalid()
  return { ...p, teamId: v.teamId, teamName: v.teamName, district: v.district }
}
export function parseContentOverview(v: any): ContentOverview {
  if (!object(v) || v.ok !== true || !object(v.counts) || !['teams', 'matches', 'goals', 'news', 'publishedNews'].every(k => integer(v.counts[k])) || v.counts.publishedNews > v.counts.news || !Array.isArray(v.recentNews) || v.recentNews.length > 5 || !iso(v.serverTime)) return invalid()
  return { counts: { teams: v.counts.teams, matches: v.counts.matches, goals: v.counts.goals, news: v.counts.news, publishedNews: v.counts.publishedNews }, recentNews: v.recentNews.map(n => parseNewsArticle(n, true)), serverTime: v.serverTime }
}
export function publicSearchUrl(item: SearchItem) {
  return item.kind === 'news' ? `/pages/article/detail?id=${item.id}` : item.kind === 'player' ? `/pages/player/detail?id=${item.id}&teamId=${item.teamId}` : `/pages/${item.kind}/detail?id=${item.id}`
}
