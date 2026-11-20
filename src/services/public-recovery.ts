import { computed, ref } from 'vue'
export class PublicReadError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = 'PublicReadError' } }
export type ReadSource = 'primary' | 'fallback' | 'snapshot'
export interface RecoveryNotice { key: string; source: Exclude<ReadSource, 'primary'>; savedAt: number }
interface Snapshot { key: string; savedAt: number; value: unknown }
const TTL = 30 * 60_000, MAX_ENTRIES = 40, MAX_CACHE_CHARS = 1_000_000
const transient = (error: unknown) => ['NETWORK_ERROR','TIMEOUT','CALL_FAILED','SERVICE_UNAVAILABLE','SERVICE_MAINTENANCE'].includes((error as any)?.code)
export function createPublicRecovery(deps: {
  primary: (data: Record<string, unknown>) => Promise<unknown>
  fallback?: (data: Record<string, unknown>) => Promise<unknown>
  sanitize: (data: Record<string, unknown>, result: any) => any
  cacheable: (action: string) => boolean
  readCache: () => unknown; writeCache: (value: unknown) => void; now?: () => number
}) {
  const online = ref(true), primaryAvailable = ref(true), notices = ref<RecoveryNotice[]>([]), retrying = ref(false), reconnecting = ref(false)
  const cache = new Map<string, Snapshot>(), generations = new Map<string, number>(), handlers = new Set<() => unknown>()
  const now = deps.now || Date.now
  let initialized = false, retryKeys: Set<string> | null = null
  function persist() {
    try {
      let rows = [...cache.values()].sort((a,b) => b.savedAt-a.savedAt).slice(0,MAX_ENTRIES)
      while (rows.length && JSON.stringify(rows).length > MAX_CACHE_CHARS) rows.pop()
      cache.clear(); rows.forEach(row => cache.set(row.key,row)); deps.writeCache({ version: 1, rows })
    } catch { /* A full/disabled device store must not fail an online request. */ }
  }
  function initialize() {
    if (initialized) return; initialized = true
    try {
      const stored = deps.readCache() as any
      if (stored?.version !== 1 || !Array.isArray(stored.rows) || stored.rows.length > MAX_ENTRIES || JSON.stringify(stored).length > MAX_CACHE_CHARS + 100) return
      for (const row of stored.rows) if (typeof row?.key === 'string' && Number.isFinite(row.savedAt) && row.savedAt <= now() && now()-row.savedAt <= TTL) cache.set(row.key,row)
    } catch { /* Malformed snapshots are discarded. */ }
  }
  const mark = (key: string, source: ReadSource, savedAt = now()) => { notices.value = notices.value.filter(item => item.key !== key); if (source !== 'primary') notices.value.push({ key, source, savedAt }) }
  async function read(data: Record<string, unknown>): Promise<any> {
    initialize()
    const action = typeof data.action === 'string' ? data.action : '', key = JSON.stringify(Object.fromEntries(Object.entries(data).sort(([a],[b]) => a.localeCompare(b))))
    const cacheable = deps.cacheable(action), generation = (generations.get(key) || 0) + 1
    retryKeys?.add(key)
    generations.set(key,generation)
    const current = () => generations.get(key) === generation
    let failure: unknown
    try {
      if (!online.value) throw new PublicReadError('NETWORK_ERROR','当前网络不可用。')
      const value = deps.sanitize(data,await deps.primary(data))
      if (current()) {
        primaryAvailable.value = true; mark(key,'primary')
        if (cacheable) { cache.set(key,{key,savedAt:now(),value}); persist() }
      }
      return value
    } catch (error) {
      if (!transient(error)) {
        if (current() && ['NOT_FOUND','FORBIDDEN','UNAUTHORIZED'].includes((error as any)?.code)) { cache.clear(); notices.value = []; persist() }
        // Invalid schemas, permission failures and authoritative not-found never
        // consult a potentially older mirror or local snapshot.
        throw error
      }
      failure = error
      if (current()) primaryAvailable.value = false
    }
    if (cacheable && online.value && deps.fallback) {
      try {
        const raw=await deps.fallback(data) as any
        const value = deps.sanitize(data,raw)
        if(raw.recovery?.source!=='fallback'||!Number.isFinite(raw.recovery.savedAt)||!Number.isFinite(raw.recovery.expiresAt)||raw.recovery.savedAt>now()+60000||raw.recovery.expiresAt<=now()||raw.recovery.expiresAt-raw.recovery.savedAt>120000)throw new PublicReadError('INVALID_RESPONSE','云端备用快照的时间或来源无效。')
        // Mirror data is never persisted as a confirmed primary snapshot.
        if (current()) mark(key,'fallback',raw.recovery.savedAt)
        return value
      } catch (error) {
        if (!transient(error)) {
          if (current()) { cache.clear(); notices.value = []; persist() }
          throw error
        }
      }
    }
    const saved = cacheable ? cache.get(key) : undefined
    if (saved && saved.savedAt <= now() && now()-saved.savedAt <= TTL) {
      try {
        const value = deps.sanitize(data,saved.value)
        if (current()) mark(key,'snapshot',saved.savedAt)
        return value
      } catch { cache.delete(key); persist() }
    }
    throw failure
  }
  async function retry() {
    if (retrying.value || !online.value) return
    reconnecting.value = !primaryAvailable.value || notices.value.length > 0
    retrying.value = true
    const keys = new Set<string>(); retryKeys = keys
    try { await Promise.allSettled([...handlers].map(handler => Promise.resolve().then(handler))) }
    finally {
      retryKeys = null
      // Reconnecting reloads mounted views from their first page. Sources from
      // a closed view or a discarded pagination page must not block writes forever.
      if (online.value && primaryAvailable.value && keys.size) notices.value = notices.value.filter(item => keys.has(item.key))
      retrying.value = false; reconnecting.value = false
    }
  }
  function setOnline(value: boolean) { const reconnected = !online.value && value; online.value = value; if (!value) primaryAvailable.value = false; if (reconnected) void retry() }
  const readOnly = computed(() => !online.value || !primaryAvailable.value || notices.value.length > 0 || reconnecting.value)
  function assertWritable() { if (readOnly.value) throw new PublicReadError('OFFLINE_READ_ONLY','当前处于故障只读状态，请恢复网络并重新读取后再保存。') }
  return { read, online, primaryAvailable, notices, retrying, retry, setOnline, assertWritable, readOnly, subscribe(handler: () => unknown) { handlers.add(handler); return () => { handlers.delete(handler) } }, clearSnapshots() { cache.clear(); notices.value = []; persist() } }
}
