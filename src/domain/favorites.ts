export const MAX_FAVORITES = 50
export const REAL_TEAM_ID = /^t_[a-f0-9]{64}$/
export interface FavoriteTeam { id: string; available: boolean; name: string; district: string }
export interface FavoritesSnapshot { owner: string; version: number; teamIds: string[]; updatedAt: string | null; teams: FavoriteTeam[] }
export class FavoritesError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'FavoritesError' }
}
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const invalid = (): never => { throw new FavoritesError('INVALID_RESPONSE', '收藏服务返回异常，请重新同步。') }
export function parseFavoriteTeam(value: unknown): FavoriteTeam {
  if (!object(value) || typeof value.id !== 'string' || !REAL_TEAM_ID.test(value.id) || typeof value.available !== 'boolean'
    || typeof value.name !== 'string' || Array.from(value.name).length > 100 || typeof value.district !== 'string' || Array.from(value.district).length > 100
    || value.available && (!value.name.trim() || !value.district.trim()) || !value.available && (value.name !== '' || value.district !== '')) return invalid()
  return { id: value.id, available: value.available, name: value.name, district: value.district }
}
export function parseFavoriteTeams(value: unknown): FavoriteTeam[] {
  if (!Array.isArray(value) || value.length > MAX_FAVORITES) return invalid()
  const teams = value.map(parseFavoriteTeam)
  if (new Set(teams.map(t => t.id)).size !== teams.length) return invalid()
  return teams
}
export function parseFavoritesResponse(value: unknown, expectedOwner: string): FavoritesSnapshot {
  if (!object(value)) return invalid()
  if (value.ok === false) {
    const error = value.error
    throw new FavoritesError(typeof error?.code === 'string' ? error.code : 'SYNC_FAILED', typeof error?.message === 'string' ? error.message : '收藏同步失败，请重试。')
  }
  const saved = value.favorites
  if (value.ok !== true || !object(saved) || !/^[a-f0-9]{64}$/.test(expectedOwner) || saved.owner !== expectedOwner
    || !Number.isSafeInteger(saved.version) || saved.version < 0 || !Array.isArray(saved.teamIds)
    || saved.updatedAt !== null && (typeof saved.updatedAt !== 'string' || !Number.isFinite(Date.parse(saved.updatedAt)))
    || saved.version === 0 && (saved.teamIds.length !== 0 || saved.updatedAt !== null)
    || saved.version > 0 && saved.updatedAt === null) return invalid()
  const teams = parseFavoriteTeams(saved.teams)
  if (saved.teamIds.length !== teams.length || !saved.teamIds.every((id: unknown, i: number) => id === teams[i].id)) return invalid()
  return { owner: expectedOwner, version: saved.version, teamIds: teams.map(t => t.id), updatedAt: saved.updatedAt, teams }
}
export const guestFavoritesKey = (environment: string, endpoint: string) => `community-football.favorites.v1:${JSON.stringify([environment, endpoint, 'guest'])}`
export const favoriteTeam = (team: { id: string; name: string; district: string }): FavoriteTeam => parseFavoriteTeam({ id: team.id, name: team.name, district: team.district, available: true })
