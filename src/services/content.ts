import { requestPublicData } from './public-data'
import { ContentClientError, parseNewsArticle, parseNewsPage, parseSearchPage, parsePublicTeam, parsePlayerProfile, type ContentCategory, type SearchKind } from '@/domain/content'

async function request(data: Record<string, unknown>): Promise<any> {
  try { return await requestPublicData(data) }
  catch (error: any) { throw new ContentClientError(error?.code || 'SERVICE_UNAVAILABLE', error instanceof Error ? error.message : '公开服务暂不可用，请重新读取。') }
}

export async function listPublicNews(category?: ContentCategory, cursor?: string) { return parseNewsPage(await request({ action: 'news.listPublic', ...(category ? { category } : {}), ...(cursor ? { cursor } : {}) })) }
export async function getPublicNews(id: string) { return parseNewsArticle((await request({ action: 'news.getPublic', id })).article, false, true) }
export async function searchPublic(query: string, kind: 'all' | SearchKind = 'all', cursor?: string) { return parseSearchPage(await request({ action: 'search.public', query, kind, ...(cursor ? { cursor } : {}) })) }
export async function searchSuggestions(): Promise<string[]> {
  const r = await request({ action: 'search.suggestions' })
  if (!Array.isArray(r.words) || r.words.length > 8 || !r.words.every((s: unknown) => typeof s === 'string' && !!s.trim() && Array.from(s).length <= 40)) throw new ContentClientError('INVALID_RESPONSE', '推荐词返回异常，请重试。')
  return [...new Set(r.words)] as string[]
}
export async function getPublicTeam(id: string) { return parsePublicTeam((await request({ action: 'directory.teamPublic', id })).team) }
export async function getPublicPlayer(id: string, teamId: string) { return parsePlayerProfile((await request({ action: 'directory.playerPublic', id, teamId })).player) }
