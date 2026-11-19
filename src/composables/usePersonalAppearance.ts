import { computed, effectScope, watch } from 'vue'
import { currentUserId } from './useUserProfile'
import { createPersonalAppearanceState } from './personal-appearance-state'
import { usePlatformSettings } from './usePlatformSettings'
import { resolveAppearance } from '@/domain/personal-appearance'
import { themeTokens } from '@/domain/platform-settings'

const state = createPersonalAppearanceState({
  environment: import.meta.env.VITE_WECHAT_CLOUD_ENV_ID || '',
  endpoint: import.meta.env.VITE_COMPETITION_API_URL?.trim() || '',
  read: key => uni.getStorageSync(key),
  write: (key, value) => uni.setStorageSync(key, value),
})
let initialized = false

export function usePersonalAppearance() {
  if (!initialized) {
    initialized = true
    // Identity is confirmed by the existing cloud login; a cached ID cannot select a profile.
    effectScope(true).run(() => watch(currentUserId, id => state.selectAccount(id), { immediate: true, flush: 'sync' }))
  }
  const platform = usePlatformSettings()
  const effective = computed(() => resolveAppearance(platform.settings.value.form, state.form.value))
  return { ...state, effective, tokens: computed(() => themeTokens(effective.value)) }
}
