import { callWechatCloudFunction } from './wechat-cloud'
import { FavoritesError, parseFavoritesResponse, type FavoritesSnapshot } from '@/domain/favorites'
import { supportsWechatProfile } from './user-profile'

async function request(owner: string, data: Record<string, unknown>): Promise<FavoritesSnapshot> {
  if (!supportsWechatProfile()) throw new FavoritesError('UNSUPPORTED_PLATFORM', '请在微信小程序中登录后同步收藏，网页预览仅使用本机游客收藏。')
  let value: unknown
  try { value = await callWechatCloudFunction('userProfile', { ...data, expectedOwner: owner }) }
  catch { throw new FavoritesError('SYNC_FAILED', '收藏同步失败，请检查网络并重新同步确认结果。') }
  return parseFavoritesResponse(value, owner)
}
export const getCloudFavorites = (owner: string) => request(owner, { action: 'favorites.get' })
export const setCloudFavorite = (owner: string, expectedVersion: number, teamId: string, favorite: boolean) => request(owner, { action: 'favorites.set', expectedVersion, teamId, favorite })
export const mergeCloudFavorites = (owner: string, expectedVersion: number, teamIds: string[]) => request(owner, { action: 'favorites.merge', expectedVersion, teamIds })
