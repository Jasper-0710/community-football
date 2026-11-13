import { computed, onMounted, ref } from 'vue'
import type { AvatarUpload, UserProfile } from '@/domain/user'
import {
  getOrCreateUserProfile, profileErrorMessage, supportsWechatProfile, updateUserProfile,
} from '@/services/user-profile'

const LOGIN_INTENT_KEY = 'community-football:wechat-login-intent'
let sessionIntent: boolean | undefined
let restoreAttempted = false

// Share only this running app's cloud-confirmed profile. Never persist identity or
// use this presentation state to authorize a cloud operation.
const profile = ref<UserProfile | null>(null)
const loading = ref(false)
const saving = ref(false)
const refreshingAvatar = ref(false)
const error = ref('')
const busy = computed(() => loading.value || saving.value)
let requestGeneration = 0
let avatarRequestGeneration = 0
let loginRequest: Promise<void> | null = null
let avatarRequest: Promise<boolean> | null = null

function cancelAvatarRefresh(): void {
  ++avatarRequestGeneration
  avatarRequest = null
  refreshingAvatar.value = false
}

/** Local storage records intent only; every new app runtime confirms identity with WeChat. */
function rememberIntent(value: boolean): void {
  sessionIntent = value
  try { uni.setStorageSync(LOGIN_INTENT_KEY, value) } catch { /* This session remains usable without storage. */ }
}

function login(): Promise<void> {
  if (profile.value || saving.value) return Promise.resolve()
  if (loginRequest) return loginRequest
  cancelAvatarRefresh()
  const request = ++requestGeneration
  loading.value = true
  error.value = ''
  loginRequest = getOrCreateUserProfile()
    .then(result => {
      if (request !== requestGeneration) return
      profile.value = result
      rememberIntent(true)
    })
    .catch(failure => {
      if (request === requestGeneration) error.value = profileErrorMessage(failure)
    })
    .finally(() => {
      if (request === requestGeneration) {
        loading.value = false
        loginRequest = null
      }
    })
  return loginRequest
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
function refreshAvatar(): Promise<boolean> {
  if (avatarRequest) return avatarRequest
  if (!profile.value || loading.value || saving.value) return Promise.resolve(false)
  const id = profile.value.id
  const request = ++avatarRequestGeneration
  refreshingAvatar.value = true
  avatarRequest = getOrCreateUserProfile()
    .then(result => {
      if (request !== avatarRequestGeneration || profile.value?.id !== id) return false
      if (result.id !== id) {
        logout()
        error.value = '微信身份已变化，请重新登录。'
        return false
      }
      profile.value.avatarFileId = result.avatarFileId
      profile.value.avatarUrl = result.avatarUrl
      profile.value.avatarUploadEnabled = result.avatarUploadEnabled
      return Boolean(result.avatarUrl)
    })
    .catch(() => false)
    .finally(() => {
      if (request === avatarRequestGeneration) {
        refreshingAvatar.value = false
        avatarRequest = null
      }
    })
  return avatarRequest
}

function logout(): void {
  cancelAvatarRefresh()
  ++requestGeneration
  loginRequest = null
  profile.value = null
  loading.value = false
  saving.value = false
  error.value = ''
  rememberIntent(false)
}

export function useUserProfile() {
  const supported = supportsWechatProfile()
  onMounted(() => {
    if (!supported || restoreAttempted || profile.value) return
    restoreAttempted = true
    let shouldRestore = false
    try { shouldRestore = sessionIntent ?? uni.getStorageSync(LOGIN_INTENT_KEY) === true } catch { /* Stay a guest. */ }
    if (shouldRestore) void login()
  })
  // Leaving one page must not cancel another page's shared login or profile save.
  return { profile, loading, saving, refreshingAvatar, refreshAvatar, error, supported, busy, login, save, logout }
}
