import { ref } from 'vue'
import { AdminApiError, type AdminApi, type AdminOverview } from './api'

export const STORAGE_KEY = 'community-football.admin.session.v1'
export function createAdminAuth(api: AdminApi, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  const status = ref<'checking' | 'guest' | 'authenticated' | 'unavailable'>('checking')
  const account = ref<AdminOverview | null>(null)
  const busy = ref(false)
  const message = ref('')
  let token = '', epoch = 0
  const remember = (value: string) => {
    try { if (value) storage?.setItem(STORAGE_KEY, value); else storage?.removeItem(STORAGE_KEY) } catch { /* Memory-only session still works when storage is unavailable. */ }
  }
  const clear = () => { token = ''; remember(''); account.value = null; status.value = 'guest' }
  const explain = (e: unknown) => e instanceof Error ? e.message : '管理服务暂不可用，请重试。'
  async function check() {
    if (busy.value) return
    if (!token) { status.value = 'guest'; return }
    const operation = ++epoch
    busy.value = true; message.value = ''
    try {
      const result = await api.overview(token)
      if (operation !== epoch) return
      account.value = result; status.value = 'authenticated'
    } catch (e) {
      if (operation !== epoch) return
      account.value = null
      if (e instanceof AdminApiError && ['UNAUTHORIZED', 'NOT_CONFIGURED'].includes(e.code)) clear()
      else status.value = 'unavailable'
      message.value = explain(e)
    } finally { if (operation === epoch) busy.value = false }
  }
  return {
    status, account, busy, message,
    async initialize() {
      try { token = storage?.getItem(STORAGE_KEY) || '' } catch { token = '' }
      if (!/^[a-f0-9]{64}$/.test(token)) clear()
      await check()
    },
    async login(username: string, password: string) {
      if (busy.value) return
      const operation = ++epoch
      busy.value = true; message.value = ''; account.value = null
      try {
        const session = await api.login(username, password)
        if (operation !== epoch) return
        token = session.token; remember(token)
        // Render the workbench only after a separately authorized server request.
        const result = await api.overview(token)
        if (operation !== epoch) return
        account.value = result; status.value = 'authenticated'
      } catch (e) {
        if (operation !== epoch) return
        if (token && !(e instanceof AdminApiError && e.code === 'UNAUTHORIZED')) status.value = 'unavailable'
        else clear()
        message.value = explain(e)
      } finally { if (operation === epoch) busy.value = false }
    },
    check,
    async logout() {
      if (busy.value) return
      const operation = ++epoch
      busy.value = true; message.value = ''
      try {
        if (token) await api.logout(token)
        if (operation !== epoch) return
        clear(); message.value = '已退出登录。'
      } catch (e) {
        if (operation !== epoch) return
        message.value = `退出尚未完成。${explain(e)}`
      } finally { if (operation === epoch) busy.value = false }
    },
    dispose() { epoch++; token = ''; account.value = null },
  }
}
