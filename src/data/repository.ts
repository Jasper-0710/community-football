import type { Tournament } from '@/domain/types'
import { mockTournament } from './mock'
export interface TournamentRepository { load(): Promise<Tournament> }
// The only data-source boundary. A future HTTP adapter must map its payload to Tournament.
export const tournamentRepository: TournamentRepository = {
  async load() { return JSON.parse(JSON.stringify(mockTournament)) as Tournament },
}
