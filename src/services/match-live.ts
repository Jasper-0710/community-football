import { requestMatchData } from './matches'
import { parseLivePage } from '@/domain/match-live'
export async function listPublicLive(matchId: string, cursor?: string) {
  return parseLivePage(await requestMatchData({ action: 'live.listPublic', matchId, ...(cursor ? { cursor } : {}) }), false, matchId)
}
