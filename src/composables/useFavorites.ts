import { effectScope, watch } from 'vue'
import { currentUserId } from './useUserProfile'
import { createFavoritesState } from './favorites-state'
import { getCloudFavorites, setCloudFavorite, mergeCloudFavorites } from '@/services/favorites'
import { getPublicTeam } from '@/services/content'
import { favoriteTeam } from '@/domain/favorites'

const state = createFavoritesState({
  environment: import.meta.env.VITE_WECHAT_CLOUD_ENV_ID || '',
  endpoint: import.meta.env.VITE_COMPETITION_API_URL?.trim() || '',
  read: key => uni.getStorageSync(key), write: (key, value) => uni.setStorageSync(key, value),
  load: getCloudFavorites, set: setCloudFavorite, merge: mergeCloudFavorites,
  publicTeam: async id => favoriteTeam(await getPublicTeam(id)),
})
let initialized = false
export function useFavorites() {
  if (!initialized) {
    initialized = true
    effectScope(true).run(() => watch(currentUserId, id => state.selectAccount(id), { immediate: true, flush: 'sync' }))
  }
  return state
}
