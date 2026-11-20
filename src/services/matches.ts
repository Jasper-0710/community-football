import { requestPublicData } from './public-data'
import { MatchClientError, parseMatch, parseMatchPage, type MatchSchedulePage } from '@/domain/match'

export async function requestMatchData(data: Record<string, unknown>): Promise<any> {
  try { return await requestPublicData(data) }
  catch (error: any) { throw new MatchClientError(error?.code || 'SERVICE_UNAVAILABLE', error instanceof Error ? error.message : '公开服务暂不可用，请重新读取。') }
}

export async function listPublicMatches(competitionId: string, options: { cursor?: string; teamId?: string } = {}): Promise<MatchSchedulePage> {
  return parseMatchPage(await requestMatchData({ action: 'matches.listPublic', competitionId, ...(options.cursor ? { cursor: options.cursor } : {}), ...(options.teamId ? { teamId: options.teamId } : {}) }))
}

export async function getPublicMatch(id: string) {
  const result = await requestMatchData({ action: 'matches.getPublic', id })
  return parseMatch(result.match)
}
