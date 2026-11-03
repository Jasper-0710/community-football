import { ref } from 'vue'
const favoriteIds = ref<string[]>([])
let initialized = false
export function useFavorites() {
  if (!initialized) {
    try { const stored = uni.getStorageSync('community-football:favorites'); favoriteIds.value = Array.isArray(stored) ? stored.filter(v => typeof v === 'string') : [] } catch { favoriteIds.value = [] }
    initialized = true
  }
  function toggle(id: string) {
    const next = favoriteIds.value.includes(id) ? favoriteIds.value.filter(v => v !== id) : [...favoriteIds.value, id]
    try { uni.setStorageSync('community-football:favorites', next); favoriteIds.value = next } catch { uni.showToast({ title: '本地保存失败，请重试', icon: 'none' }) }
  }
  return { favoriteIds, toggle }
}
