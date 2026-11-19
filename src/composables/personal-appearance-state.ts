import { readonly, ref } from 'vue'
import { AppearanceError, appearanceStorageKey, defaultPersonalAppearance, parsePersonalAppearance } from '../domain/personal-appearance'

export function createPersonalAppearanceState(deps: {
  environment: string
  endpoint: string
  read: (key: string) => unknown
  write: (key: string, value: unknown) => void
}) {
  const form = ref(defaultPersonalAppearance()), owner = ref('guest'), scopeVersion = ref(0), readError = ref('')
  let initialized = false
  const key = () => appearanceStorageKey(deps.environment, deps.endpoint, owner.value)

  function selectAccount(userId: string | null) {
    if (userId !== null && !/^[a-f0-9]{64}$/.test(userId)) throw new AppearanceError('INVALID_IDENTITY', '请重新确认微信登录状态。')
    const nextOwner = userId || 'guest'
    if (initialized && owner.value === nextOwner) return
    initialized = true
    owner.value = nextOwner
    // Clear the former identity before reading any storage. Failed reads cannot leak it.
    form.value = defaultPersonalAppearance()
    readError.value = ''
    try {
      const cached = deps.read(key())
      if (cached !== undefined && cached !== null && cached !== '') {
        const record = cached as { version?: unknown; owner?: unknown; form?: unknown }
        if (!record || typeof record !== 'object' || Array.isArray(record) || record.version !== 1 || record.owner !== nextOwner) throw new Error('Invalid cache')
        form.value = parsePersonalAppearance(record.form)
      }
    } catch {
      readError.value = '本机外观设置暂时无法读取，当前跟随平台。可重新选择并保存。'
    }
    // Increment after the complete switch so editors only read the new identity's form.
    scopeVersion.value++
  }

  function save(value: unknown, expectedScope: number) {
    if (!initialized || expectedScope !== scopeVersion.value) throw new AppearanceError('IDENTITY_CHANGED', '登录身份已变化，请重新选择外观后保存。')
    const next = parsePersonalAppearance(value)
    try { deps.write(key(), { version: 1, owner: owner.value, form: next }) }
    catch { throw new AppearanceError('STORAGE_UNAVAILABLE', '本机保存失败，当前外观未改变。请检查存储空间后重试。') }
    form.value = next
    readError.value = ''
  }

  return { form: readonly(form), owner: readonly(owner), scopeVersion: readonly(scopeVersion), readError: readonly(readError), selectAccount, save }
}
