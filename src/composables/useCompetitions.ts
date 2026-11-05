import { ref } from 'vue'
import type { PublicCompetition } from '@/domain/competition'
import { listPublicCompetitions } from '@/services/competitions'
const competitions = ref<PublicCompetition[]>([]), error = ref(''), loading = ref(false), cursor = ref<string | null>(null)
let pending: Promise<void> | null = null
async function load(more = false) {
  if (pending) return pending
  if (more && !cursor.value) return
  const next = more ? cursor.value! : undefined
  if (!more) { competitions.value = []; cursor.value = null }
  loading.value = true; error.value = ''
  pending = listPublicCompetitions(next).then(result => {
    competitions.value = more ? [...competitions.value, ...result.competitions] : result.competitions
    cursor.value = result.nextCursor
  }).catch(e => {
    competitions.value = []; cursor.value = null
    error.value = e instanceof Error ? e.message : '赛事加载失败，请重试。'
  }).finally(() => { loading.value = false; pending = null })
  return pending
}
export function useCompetitions() { return { competitions, error, loading, cursor, load } }
