import { requestPublicData } from './public-data'
import { parsePublicHome, parseTeamProfile, parseFullPlayerProfile } from '@/domain/directory'

export async function getPublicHome() { return parsePublicHome((await requestPublicData({ action: 'directory.homePublic' }) as any).home) }
export async function getTeamProfile(id: string, competitionId?: string, cursor?: string) {
  return parseTeamProfile(await requestPublicData({ action: 'directory.teamProfilePublic', id, ...(competitionId ? { competitionId } : {}), ...(cursor ? { cursor } : {}) }), id, competitionId)
}
export async function getPlayerProfile(id: string, teamId: string, competitionId?: string, cursor?: string) {
  return parseFullPlayerProfile(await requestPublicData({ action: 'directory.playerProfilePublic', id, teamId, ...(competitionId ? { competitionId } : {}), ...(cursor ? { cursor } : {}) }), id, teamId, competitionId)
}
