import { callWechatCloudFunction } from './wechat-cloud'
import { MatchClientError, parseMatch, parseMatchPage, type MatchSchedulePage } from '@/domain/match'

export async function requestMatchData(data: Record<string, unknown>): Promise<any> {
  let result: any
  try {
    // #ifdef MP-WEIXIN
    result = await callWechatCloudFunction<unknown>('adminAuth', data)
    // #endif
    // #ifndef MP-WEIXIN
    const endpoint = import.meta.env.VITE_COMPETITION_API_URL?.trim()
    if (!endpoint) throw new MatchClientError('NOT_CONFIGURED', '赛程服务尚未配置，请稍后再试。')
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new MatchClientError('NOT_CONFIGURED', '赛程服务地址配置无效。')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(url.href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal })
      try { result = await response.json() } catch { throw new MatchClientError('INVALID_RESPONSE', '赛程服务返回异常，请重试。') }
      if (!response.ok && result?.ok !== false) throw new MatchClientError('SERVICE_UNAVAILABLE', '暂时无法获取赛程，请稍后重试。')
    } finally { clearTimeout(timer) }
    // #endif
  } catch (error) {
    if (error instanceof MatchClientError) throw error
    throw new MatchClientError('SERVICE_UNAVAILABLE', '暂时无法获取赛程，请检查网络后重试。')
  }
  if (result?.ok !== true) throw new MatchClientError(result?.error?.code || 'INVALID_RESPONSE', result?.error?.message || '赛程服务返回异常，请重试。')
  return result
}

export async function listPublicMatches(competitionId: string, options: { cursor?: string; teamId?: string } = {}): Promise<MatchSchedulePage> {
  return parseMatchPage(await requestMatchData({ action: 'matches.listPublic', competitionId, ...(options.cursor ? { cursor: options.cursor } : {}), ...(options.teamId ? { teamId: options.teamId } : {}) }))
}

export async function getPublicMatch(id: string) {
  const result = await requestMatchData({ action: 'matches.getPublic', id })
  return parseMatch(result.match)
}
