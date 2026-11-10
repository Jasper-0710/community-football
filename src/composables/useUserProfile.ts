import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { AvatarUpload, UserProfile } from '@/domain/user'
import {
  getOrCreateUserProfile, profileErrorMessage, supportsWechatProfile, updateUserProfile,
} from '@/services/user-profile'

const LOGIN_INTENT_KEY = 'community-football:wechat-login-intent'
let sessionIntent: boolean | undefined

/** Local storage records intent only; identity and profile always come from the cloud. */
export function useUserProfile() {
  const profile = ref<UserProfile | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const refreshingAvatar = ref(false)
  let avatarRequestGeneration = 0

  function cancelAvatarRefresh(): void {
    ++avatarRequestGeneration
    refreshingAvatar.value = false
  }
  const error = ref('')
  const supported = supportsWechatProfile()
  let requestGeneration = 0

  function rememberIntent(value: boolean): void {
    sessionIntent = value
    try { uni.setStorageSync(LOGIN_INTENT_KEY, value) } catch { /* This session remains usable without storage. */ }
  }

  async function login(): Promise<void> {
    if (loading.value || saving.value) return
    cancelAvatarRefresh()
    const request = ++requestGeneration
    loading.value = true
    error.value = ''
    profile.value = null
    try {
      const result = await getOrCreateUserProfile()
      if (request !== requestGeneration) return
      profile.value = result
      rememberIntent(true)
    } catch (failure) {
      if (request === requestGeneration) error.value = profileErrorMessage(failure)
    } finally {
      if (request === requestGeneration) loading.value = false
    }
  }

  async function save(nickname: string, avatar?: AvatarUpload): Promise<boolean> {
    if (!profile.value || loading.value || saving.value) return false
    cancelAvatarRefresh()
    const request = ++requestGeneration
    saving.value = true
    error.value = ''
    try {
      const result = await updateUserProfile(nickname, profile.value.avatarUploadEnabled ? avatar : undefined)
      if (request !== requestGeneration) return false
      profile.value = result
      return true
    } catch (failure) {
      if (request === requestGeneration) error.value = profileErrorMessage(failure)
      return false
    } finally {
      if (request === requestGeneration) saving.value = false
    }
  }

  /** Renew only the saved avatar; an unsaved nickname or avatar draft stays intact. */
  async function refreshAvatar(): Promise<boolean> {
    if (!profile.value || loading.value || saving.value || refreshingAvatar.value) return false
    const id = profile.value.id
    const request = ++avatarRequestGeneration
    refreshingAvatar.value = true
    try {
      const result = await getOrCreateUserProfile()
      if (request !== avatarRequestGeneration || profile.value?.id !== id || result.id !== id) return false
      profile.value.avatarFileId = result.avatarFileId
      profile.value.avatarUrl = result.avatarUrl
      profile.value.avatarUploadEnabled = result.avatarUploadEnabled
      return Boolean(result.avatarUrl)
    } catch {
      return false
    } finally {
      if (request === avatarRequestGeneration) refreshingAvatar.value = false
    }
  }

  function logout(): void {
    cancelAvatarRefresh()
    ++requestGeneration
    profile.value = null
    loading.value = false
    saving.value = false
    error.value = ''
    rememberIntent(false)
  }

  onMounted(() => {
    let shouldRestore = false
    try { shouldRestore = sessionIntent ?? uni.getStorageSync(LOGIN_INTENT_KEY) === true } catch { /* Stay a guest. */ }
    if (supported && shouldRestore) void login()
  })
  onBeforeUnmount(() => { ++requestGeneration; cancelAvatarRefresh() })

  return { profile, loading, saving, refreshingAvatar, refreshAvatar, error, supported, busy: computed(() => loading.value || saving.value), login, save, logout }
}
