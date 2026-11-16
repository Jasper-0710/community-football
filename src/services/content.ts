import { callWechatCloudFunction } from './wechat-cloud'
import { ContentClientError, parseNewsArticle, parseNewsPage, parseSearchPage, parsePublicTeam, parsePlayerProfile, type ContentCategory, type SearchKind } from '@/domain/content'

async function request(data: Record<string, unknown>): Promise<any> {
  let result: any
  try {
    // #ifdef MP-WEIXIN
    result = await callWechatCloudFunction<unknown>('adminAuth', data)
    // #endif
    // #ifndef MP-WEIXIN
    const endpoint = import.meta.env.VITE_COMPETITION_API_URL?.trim()
    if (!endpoint) throw new ContentClientError('NOT_CONFIGURED', '内容服务尚未配置，请稍后再试。')
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new ContentClientError('NOT_CONFIGURED', '内容服务地址配置无效。')
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(url.href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal })
      result = await response.json()
      if (!response.ok && result?.ok !== false) throw new Error('Invalid response')
    } finally { clearTimeout(timer) }
    // #endif
  } catch (error) {
    if (error instanceof ContentClientError) throw error
    throw new ContentClientError('SERVICE_UNAVAILABLE', '暂时无法获取内容，请检查网络后重试。')
  }
  if (result?.ok !== true) throw new ContentClientError(result?.error?.code || 'INVALID_RESPONSE', result?.error?.message || '内容服务返回异常，请重试。')
  return result
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
