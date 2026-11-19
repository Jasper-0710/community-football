import { effectScope, ref, watch } from 'vue'
import { currentUserId } from './useUserProfile'

// Demonstration IDs never enter the real-team cloud contract. Preserve old guest
// selections while isolating new demonstration choices by confirmed account.
const favoriteIds = ref<string[]>([])
let initialized = false
const prefix = `community-football.demo-favorites.v1:${JSON.stringify([import.meta.env.VITE_WECHAT_CLOUD_ENV_ID || '', import.meta.env.VITE_COMPETITION_API_URL || ''])}:`
const key = () => prefix + (currentUserId.value || 'guest')
export function useDemoFavorites() {
  if (!initialized) {
    initialized = true
    effectScope(true).run(() => watch(currentUserId, id => {
      favoriteIds.value = []
      try {
        let stored = uni.getStorageSync(key())
        if (!id && (stored === '' || stored == null)) stored = uni.getStorageSync('community-football:favorites')
        favoriteIds.value = Array.isArray(stored) ? [...new Set(stored.filter((v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9-]{0,40}$/.test(v)))].slice(0, 50) : []
      } catch { /* Remain empty in this account. */ }
    }, { immediate: true, flush: 'sync' }))
  }
  function toggle(id: string) {
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(id)) return
    const next = favoriteIds.value.includes(id) ? favoriteIds.value.filter(v => v !== id) : [...favoriteIds.value, id].slice(0, 50)
    try { uni.setStorageSync(key(), next); favoriteIds.value = next }
    catch { uni.showToast({ title: '本地保存失败，请重试', icon: 'none' }) }
  }
  return { favoriteIds, toggle }
}
