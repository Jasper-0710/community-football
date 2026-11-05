import { callWechatCloudFunction } from './wechat-cloud'
import { CompetitionClientError, parseCompetition, parseCompetitionPage } from '@/domain/competition'

async function request(data: Record<string, unknown>): Promise<unknown> {
  let result: any
  try {
    // #ifdef MP-WEIXIN
    result = await callWechatCloudFunction<unknown>('adminAuth', data)
    // #endif
    // #ifndef MP-WEIXIN
    const endpoint = import.meta.env.VITE_COMPETITION_API_URL?.trim()
    if (!endpoint) throw new CompetitionClientError('NOT_CONFIGURED', '赛事服务尚未配置，请稍后再试。')
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new CompetitionClientError('NOT_CONFIGURED', '赛事服务地址配置无效。')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(url.href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal })
      result = await response.json()
      if (!response.ok && result?.ok !== false) throw new Error('Invalid response')
    } finally { clearTimeout(timer) }
    // #endif
  } catch (error) {
    if (error instanceof CompetitionClientError) throw error
    throw new CompetitionClientError('SERVICE_UNAVAILABLE', '暂时无法获取赛事，请检查网络后重试。')
  }
  if (result?.ok !== true) throw new CompetitionClientError(result?.error?.code || 'INVALID_RESPONSE', result?.error?.message || '赛事服务返回异常，请重试。')
  return result
}
export async function listPublicCompetitions(cursor?: string) {
  return parseCompetitionPage(await request({ action: 'competitions.listPublic', ...(cursor ? { cursor } : {}) }))
}
export async function getPublicCompetition(id: string) {
  const result = await request({ action: 'competitions.getPublic', id }) as { competition?: unknown }
  return parseCompetition(result.competition)
}
