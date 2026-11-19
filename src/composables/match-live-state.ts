import { ref } from 'vue'
import type { LiveEntry, LivePage } from '@/domain/match-live'
export function createLiveFeedState(read: (matchId: string, cursor?: string) => Promise<LivePage>) {
  const entries = ref<LiveEntry[]>([]), nextCursor = ref<string | null>(null), loading = ref(false), error = ref(''), ready = ref(false), updatedAt = ref(''), unavailable = ref(false), historyMode = ref(false)
  let generation = 0, matchId = ''
  function reset(id: string) { generation++; matchId = id; entries.value = []; nextCursor.value = null; loading.value = false; error.value = ''; ready.value = false; updatedAt.value = ''; unavailable.value = false; historyMode.value = false }
  async function load(more = false) {
    if (!matchId || loading.value || more && !nextCursor.value) return
    const serial = generation, id = matchId, cursor = more ? nextCursor.value! : undefined
    loading.value = true; error.value = ''
    try {
      const page = await read(id, cursor)
      if (serial !== generation) return
      entries.value = more ? [...entries.value, ...page.entries.filter(row => !entries.value.some(old => old.id === row.id))] : page.entries
      nextCursor.value = page.nextCursor; ready.value = true; unavailable.value = false; updatedAt.value = new Date().toISOString(); historyMode.value = more
    } catch (e) {
      if (serial !== generation) return
      if (e && typeof e === 'object' && 'code' in e && e.code === 'NOT_FOUND') { entries.value = []; nextCursor.value = null; ready.value = false; unavailable.value = true }
      error.value = e instanceof Error ? e.message : '直播更新失败，请重试。'
    } finally { if (serial === generation) loading.value = false }
  }
  return { entries, nextCursor, loading, error, ready, updatedAt, unavailable, historyMode, reset, load }
}
