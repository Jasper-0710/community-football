import { ref, computed } from 'vue'
import { tournamentRepository } from '@/data/repository'
import { resolvedMatches } from '@/domain/tournament'
import type { Tournament } from '@/domain/types'
const data = ref<Tournament | null>(null)
const error = ref('')
const loading = ref(false)
let pending: Promise<void> | null = null
async function load() {
  if (data.value) return
  if (pending) return pending
  loading.value = true; error.value = ''
  pending = tournamentRepository.load().then(result => { data.value = result }).catch(() => { error.value = '赛事资料加载失败，请重试。' }).finally(() => { loading.value = false; pending = null })
  return pending
}
export function useTournament() {
  void load()
  return { data, error, loading, load, matches: computed(() => data.value ? resolvedMatches(data.value) : []) }
}
