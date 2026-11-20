import { requestPublicData } from './public-data'
import { CompetitionClientError, parseCompetition, parseCompetitionPage } from '@/domain/competition'

async function request(data: Record<string, unknown>): Promise<any> {
  try { return await requestPublicData(data) }
  catch (error: any) { throw new CompetitionClientError(error?.code || 'SERVICE_UNAVAILABLE', error instanceof Error ? error.message : '公开服务暂不可用，请重新读取。') }
}

export async function listPublicCompetitions(cursor?: string) {
  return parseCompetitionPage(await request({ action: 'competitions.listPublic', ...(cursor ? { cursor } : {}) }))
}
export async function getPublicCompetition(id: string) {
  const result = await request({ action: 'competitions.getPublic', id }) as { competition?: unknown }
  return parseCompetition(result.competition)
}
