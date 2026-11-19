import { computed, readonly, ref } from 'vue'
import { FavoritesError, MAX_FAVORITES, guestFavoritesKey, parseFavoriteTeam, parseFavoriteTeams, type FavoriteTeam, type FavoritesSnapshot } from '../domain/favorites'

export function createFavoritesState(deps: {
  environment: string; endpoint: string
  read: (key: string) => unknown; write: (key: string, value: unknown) => void
  load: (owner: string) => Promise<FavoritesSnapshot>
  set: (owner: string, version: number, id: string, favorite: boolean) => Promise<FavoritesSnapshot>
  merge: (owner: string, version: number, ids: string[]) => Promise<FavoritesSnapshot>
  publicTeam: (id: string) => Promise<FavoriteTeam>
}) {
  const owner = ref<string | null>(null), teams = ref<FavoriteTeam[]>([]), guestTeams = ref<FavoriteTeam[]>([])
  const loading = ref(false), saving = ref(false), ready = ref(false), error = ref(''), notice = ref(''), storageError = ref('')
  const favoriteIds = computed(() => teams.value.map(t => t.id)), busy = computed(() => loading.value || saving.value)
  const key = guestFavoritesKey(deps.environment, deps.endpoint)
  let initialized = false, generation = 0, version = 0, pending: Promise<boolean> | null = null
  function readGuest() {
    guestTeams.value = []; storageError.value = ''
    try {
      const value = deps.read(key)
      if (value === undefined || value === null || value === '') return
      const record = value as { version?: unknown; owner?: unknown; teams?: unknown }
      if (!record || record.version !== 1 || record.owner !== 'guest') throw new Error('Invalid cache')
      guestTeams.value = parseFavoriteTeams(record.teams)
    } catch { storageError.value = '本机游客收藏暂时无法读取，请检查存储后重试。' }
  }
  function writeGuest(next: FavoriteTeam[]) {
    try { deps.write(key, { version: 1, owner: 'guest', teams: next }) }
    catch { throw new FavoritesError('STORAGE_UNAVAILABLE', '本机收藏保存失败，请检查存储空间后重试。') }
    guestTeams.value = next
    storageError.value = ''
    if (!owner.value) teams.value = next.map(t => ({ ...t }))
  }
  function message(failure: unknown) { return failure instanceof Error ? failure.message : '收藏同步失败，请重新同步后重试。' }
  function apply(saved: FavoritesSnapshot, account: string) {
    if (saved.owner !== account) throw new FavoritesError('IDENTITY_CHANGED', '微信身份已变化，请重新登录后同步收藏。')
    version = saved.version; teams.value = saved.teams; ready.value = true
  }
  function selectAccount(id: string | null) {
    if (id !== null && !/^[a-f0-9]{64}$/.test(id)) throw new FavoritesError('INVALID_IDENTITY', '请重新确认微信登录状态。')
    if (initialized && owner.value === id) return
    initialized = true; ++generation; pending = null; owner.value = id
    teams.value = []; version = 0; loading.value = false; saving.value = false; ready.value = false; error.value = ''; notice.value = ''
    readGuest()
    if (!id) { teams.value = guestTeams.value.map(t => ({ ...t })); ready.value = true }
    else void refresh()
  }
  function refresh(): Promise<boolean> {
    if (saving.value) return Promise.resolve(false)
    if (pending) return pending
    const serial = generation, account = owner.value
    loading.value = true; error.value = ''; notice.value = ''
    if (account) ready.value = false
    pending = (async () => {
      try {
        if (account) {
          const saved = await deps.load(account)
          if (serial !== generation) return false
          apply(saved, account)
        } else {
          readGuest()
          const next = await Promise.all(guestTeams.value.map(async team => {
            try { return await deps.publicTeam(team.id) }
            catch (failure) {
              if ((failure as { code?: string })?.code === 'NOT_FOUND') return { id: team.id, available: false, name: '', district: '' }
              throw failure
            }
          }))
          if (serial !== generation) return false
          if (next.length) writeGuest(next)
          else teams.value = []
        }
        return true
      } catch (failure) {
        if (serial === generation) error.value = message(failure)
        return false
      } finally { if (serial === generation) { loading.value = false; pending = null } }
    })()
    return pending
  }
  async function setFavorite(input: FavoriteTeam, favorite: boolean): Promise<boolean> {
    if (busy.value) return false
    const serial = generation, account = owner.value
    error.value = ''; notice.value = ''
    try {
      const team = parseFavoriteTeam(input)
      if (!account) {
        const next = favorite ? [...teams.value.filter(t => t.id !== team.id), team] : teams.value.filter(t => t.id !== team.id)
        if (next.length > MAX_FAVORITES) throw new FavoritesError('FAVORITES_LIMIT', `最多关注 ${MAX_FAVORITES} 支球队。`)
        writeGuest(next); notice.value = favorite ? '已保存在本机游客收藏。' : '已取消关注。'
        return true
      }
      if (!ready.value) throw new FavoritesError('SYNC_REQUIRED', '请先重新同步收藏，确认云端结果后再操作。')
      saving.value = true
      const saved = await deps.set(account, version, team.id, favorite)
      if (serial !== generation) return false
      apply(saved, account); notice.value = favorite ? '已关注，收藏已保存到云端。' : '已取消关注，云端已同步。'
      return true
    } catch (failure) {
      if (serial === generation) { error.value = message(failure); if (account) ready.value = false }
      return false
    } finally { if (serial === generation) saving.value = false }
  }
  function toggle(team: FavoriteTeam) { return setFavorite(team, !favoriteIds.value.includes(team.id)) }
  async function mergeGuest(): Promise<boolean> {
    if (!owner.value || busy.value || !ready.value || !guestTeams.value.length) return false
    const account = owner.value, serial = generation, ids = guestTeams.value.map(t => t.id)
    saving.value = true; error.value = ''; notice.value = ''
    try {
      const saved = await deps.merge(account, version, ids)
      if (serial !== generation) return false
      apply(saved, account)
      // Clear guest data only after the cloud acknowledges the complete merge.
      try { writeGuest([]) }
      catch { storageError.value = '云端合并已完成，但本机游客记录未清除；再次合并不会重复收藏。' }
      notice.value = '游客收藏已合并到当前账号。'
      return true
    } catch (failure) {
      if (serial === generation) { error.value = message(failure); ready.value = false }
      return false
    } finally { if (serial === generation) saving.value = false }
  }
  function removeGuest(id: string) {
    if (busy.value) return
    try { writeGuest(guestTeams.value.filter(t => t.id !== id)) }
    catch (failure) { storageError.value = message(failure) }
  }
  return {
    owner: readonly(owner), teams: readonly(teams), guestTeams: readonly(guestTeams), favoriteIds, busy,
    loading: readonly(loading), saving: readonly(saving), ready: readonly(ready), error: readonly(error), notice: readonly(notice), storageError: readonly(storageError),
    selectAccount, refresh, setFavorite, toggle, mergeGuest, removeGuest,
  }
}
