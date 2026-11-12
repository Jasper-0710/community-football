import { requestMatchData } from './matches'
import { parseStandings } from '@/domain/standings'
export async function getPublicStandings(competitionId: string) {
  return parseStandings(await requestMatchData({ action: 'standings.getPublic', competitionId }))
}
