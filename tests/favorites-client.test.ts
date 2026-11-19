import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import * as vue from 'vue'
import { createFavoritesState } from '../src/composables/favorites-state'
import { FavoritesError, guestFavoritesKey, parseFavoritesResponse, type FavoriteTeam, type FavoritesSnapshot } from '../src/domain/favorites'
const alice = 'a'.repeat(64), bob = 'b'.repeat(64)
const team = (n = 1): FavoriteTeam => ({ id: 't_' + String(n).repeat(64), available: true, name: `球队${n}`, district: '浦东新区' })
const snapshot = (owner = alice, teams: FavoriteTeam[] = [], version = 0): FavoritesSnapshot => ({ owner, version, teams, teamIds: teams.map(t => t.id), updatedAt: version ? '2026-11-18T01:00:00Z' : null })
const settle = () => new Promise<void>(r => setImmediate(r))
function deferred<T>() { let resolve!: (value: T) => void, reject!: (failure: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function fixture(overrides: Partial<Parameters<typeof createFavoritesState>[0]> = {}, storage = new Map<string, unknown>()) {
  let loaded = snapshot(), writes = 0, merges = 0
  const state = createFavoritesState({
    environment: 'customer', endpoint: 'https://example.test/api', read: key => storage.get(key), write: (key, value) => storage.set(key, structuredClone(value)),
    load: async account => ({ ...structuredClone(loaded), owner: account }),
    set: async (account, version, id, favorite) => { writes++; return snapshot(account, favorite ? [team(id === team(2).id ? 2 : 1)] : [], version + 1) },
    merge: async (account, version, ids) => { merges++; return snapshot(account, ids.map(id => team(id === team(2).id ? 2 : 1)), version + 1) },
    publicTeam: async id => team(id === team(2).id ? 2 : 1), ...overrides,
  })
  state.selectAccount(null)
  return { state, storage, setCloud: (next: FavoritesSnapshot) => { loaded = next }, writes: () => writes, merges: () => merges }
}
test('favorites response: owner, version, counts, duplicate IDs and unavailable fields are validated', () => {
  const valid = { ok: true, favorites: snapshot(alice, [team()], 1) }
  assert.deepEqual(parseFavoritesResponse(valid, alice), valid.favorites)
  for (const favorites of [snapshot(bob), { ...valid.favorites, version: -1 }, { ...valid.favorites, teamIds: [] }, { ...valid.favorites, teams: [team(), team()], teamIds: [team().id, team().id] }, { ...valid.favorites, teams: [{ ...team(), available: false }] }, { ...valid.favorites, updatedAt: null }, { ...snapshot(), version: 0, teams: [team()], teamIds: [team().id] }]) {
    assert.throws(() => parseFavoritesResponse({ ok: true, favorites }, alice), (e: any) => e.code === 'INVALID_RESPONSE')
  }
  assert.throws(() => parseFavoritesResponse({ ok: false, error: { code: 'CONFLICT', message: '需要重新同步' } }, alice), (e: any) => e.code === 'CONFLICT')
})
test('guest favorites survive restart and remain separate from cloud identity and demonstration IDs', async () => {
  const f = fixture(); assert.equal(await f.state.toggle(team()), true)
  const restarted = fixture({}, f.storage)
  assert.deepEqual(restarted.state.favoriteIds.value, [team().id])
  assert.equal(await f.state.toggle({ ...team(), id: 'jiangwan' }), false)
  assert.equal(f.writes(), 0)
  f.state.selectAccount(alice); await settle()
  assert.deepEqual(f.state.teams.value, []); assert.equal(f.state.guestTeams.value.length, 1); assert.equal(f.merges(), 0)
  f.state.selectAccount(null); assert.deepEqual(f.state.favoriteIds.value, [team().id])
})
test('guest storage failure preserves visible data and supports retry without false success', async () => {
  let denied = false
  const storage = new Map<string, unknown>(), f = fixture({ write(key, value) { if (denied) throw new Error('quota'); storage.set(key, structuredClone(value)) } }, storage)
  await f.state.toggle(team()); denied = true
  assert.equal(await f.state.toggle(team()), false); assert.equal(f.state.favoriteIds.value.length, 1); assert.match(f.state.error.value, /保存失败/)
  denied = false; assert.equal(await f.state.toggle(team()), true); assert.deepEqual(f.state.teams.value, [])
})
test('guest caches reject foreign owners and corrupt IDs, and do not cross environment or endpoint boundaries', async () => {
  const key = guestFavoritesKey('customer', 'https://example.test/api')
  for (const record of [{ version: 1, owner: alice, teams: [team()] }, { version: 1, owner: 'guest', teams: [{ ...team(), id: 'demo' }] }, { version: 2, owner: 'guest', teams: [team()] }]) {
    const f = fixture({}, new Map([[key, record]])); assert.deepEqual(f.state.teams.value, []); assert.ok(f.state.storageError.value)
  }
  const f = fixture(); await f.state.toggle(team())
  const other = fixture({ environment: 'other' }, f.storage); assert.deepEqual(other.state.teams.value, [])
  assert.notEqual(guestFavoritesKey('a:b', 'c'), guestFavoritesKey('a', 'b:c'))
})
test('login, logout and account changes clear the previous private list before any network response', async () => {
  const a = deferred<FavoritesSnapshot>(), b = deferred<FavoritesSnapshot>()
  const f = fixture({ load: account => account === alice ? a.promise : b.promise })
  f.state.selectAccount(alice); assert.equal(f.state.loading.value, true)
  f.state.selectAccount(bob); assert.deepEqual(f.state.teams.value, [])
  a.resolve(snapshot(alice, [team()], 1)); await settle()
  assert.equal(f.state.loading.value, true); assert.deepEqual(f.state.teams.value, [])
  b.resolve(snapshot(bob, [team(2)], 1)); await settle()
  assert.deepEqual(f.state.favoriteIds.value, [team(2).id])
  f.state.selectAccount(null); assert.deepEqual(f.state.teams.value, []); assert.equal(f.state.loading.value, false)
})
test('same-account profile edits do not reload favorites; returning to the foreground restores other-device changes', async () => {
  let reads = 0
  const f = fixture({ load: async () => { reads++; return reads === 1 ? snapshot() : snapshot(alice, [team(2)], 2) } })
  f.state.selectAccount(alice); await settle(); f.state.selectAccount(alice); assert.equal(reads, 1)
  await f.state.refresh(); assert.deepEqual(f.state.favoriteIds.value, [team(2).id]); assert.equal(reads, 2)
})
test('failed and ambiguous cloud writes retain the last confirmed list and require refresh before another mutation', async () => {
  let writes = 0
  const f = fixture({ set: async () => { writes++; throw new FavoritesError('SYNC_FAILED', '请重新同步确认结果') } })
  f.state.selectAccount(alice); await settle()
  assert.equal(await f.state.toggle(team()), false); assert.equal(f.state.ready.value, false); assert.deepEqual(f.state.teams.value, [])
  assert.equal(await f.state.toggle(team()), false); assert.equal(writes, 1)
  f.setCloud(snapshot(alice, [team()], 1)); await f.state.refresh()
  assert.equal(f.state.ready.value, true); assert.deepEqual(f.state.favoriteIds.value, [team().id])
})
test('pending writes join no duplicate clicks and cannot replace a later account or clear its loading state', async () => {
  const save = deferred<FavoritesSnapshot>(), read = deferred<FavoritesSnapshot>()
  const f = fixture({ set: () => save.promise, load: async account => account === alice ? snapshot() : read.promise })
  f.state.selectAccount(alice); await settle()
  const older = f.state.toggle(team()); assert.equal(f.state.saving.value, true)
  assert.equal(await f.state.toggle(team()), false)
  assert.equal(await f.state.refresh(), false)
  f.state.selectAccount(bob); save.resolve(snapshot(alice, [team()], 1)); assert.equal(await older, false)
  assert.equal(f.state.loading.value, true); assert.deepEqual(f.state.teams.value, [])
  read.resolve(snapshot(bob)); await settle(); assert.equal(f.state.ready.value, true)
})
test('explicit guest merge clears guest data only after cloud acknowledgement', async () => {
  const pending = deferred<FavoritesSnapshot>(), f = fixture({ merge: () => pending.promise })
  await f.state.toggle(team()); f.state.selectAccount(alice); await settle()
  const merge = f.state.mergeGuest(); assert.equal(f.state.guestTeams.value.length, 1)
  pending.resolve(snapshot(alice, [team()], 1)); assert.equal(await merge, true)
  assert.equal(f.state.guestTeams.value.length, 0); assert.deepEqual(f.state.favoriteIds.value, [team().id])
  f.state.selectAccount(null); assert.deepEqual(f.state.teams.value, [])
})
test('failed or stale guest merge never deletes local records or leaks an old account result', async () => {
  const pending = deferred<FavoritesSnapshot>(), f = fixture({ merge: () => pending.promise })
  await f.state.toggle(team()); f.state.selectAccount(alice); await settle()
  const merge = f.state.mergeGuest(); f.state.selectAccount(bob); await settle()
  pending.resolve(snapshot(alice, [team()], 1)); assert.equal(await merge, false)
  assert.equal(f.state.guestTeams.value.length, 1); assert.deepEqual(f.state.teams.value, [])
  const failed = fixture({ merge: async () => { throw new Error('部分球队暂未公开') } }, f.storage)
  failed.state.selectAccount(alice); await settle(); assert.equal(await failed.state.mergeGuest(), false)
  assert.equal(failed.state.guestTeams.value.length, 1); assert.equal(failed.state.ready.value, false)
  failed.state.removeGuest(team().id); assert.equal(failed.state.guestTeams.value.length, 0)
})
test('cloud merge success with local cleanup failure stays confirmed and preserves retryable guest records', async () => {
  let denied = false
  const f = fixture({ write(key, value) { if (denied) throw new Error('quota'); f.storage.set(key, structuredClone(value)) } })
  await f.state.toggle(team()); f.state.selectAccount(alice); await settle(); denied = true
  assert.equal(await f.state.mergeGuest(), true); assert.equal(f.state.ready.value, true)
  assert.match(f.state.storageError.value, /云端合并已完成/); assert.equal(f.state.guestTeams.value.length, 1)
})
test('guest refresh distinguishes a missing team from a transient network failure', async () => {
  let unavailable = false, offline = false
  const f = fixture({ publicTeam: async () => { if (unavailable) throw new FavoritesError('NOT_FOUND', '下架'); if (offline) throw new Error('网络失败'); return team() } })
  await f.state.toggle(team()); offline = true
  assert.equal(await f.state.refresh(), false); assert.equal(f.state.teams.value[0].available, true)
  offline = false; unavailable = true; assert.equal(await f.state.refresh(), true)
  assert.deepEqual(f.state.teams.value[0], { id: team().id, available: false, name: '', district: '' })
  await f.state.toggle({ ...f.state.teams.value[0] }); assert.deepEqual(f.state.teams.value, [])
})
test('the singleton identity watcher survives page disposal and rejects delayed old-account reads', async () => {
  const identity = vue.ref<string | null>(null), storage = new Map<string, unknown>(), module = { exports: {} as any }
  const code = transformSync(readFileSync(new URL('../src/composables/useFavorites.ts', import.meta.url), 'utf8').replaceAll('import.meta.env.', 'runtimeEnv.'), { loader: 'ts', format: 'cjs', target: 'es2020' }).code
  vm.runInNewContext(code, {
    module, exports: module.exports, runtimeEnv: {}, uni: { getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, structuredClone(value)) },
    require(name: string) {
      if (name === 'vue') return vue
      if (name === './useUserProfile') return { currentUserId: identity }
      if (name === './favorites-state') return { createFavoritesState }
      if (name === '@/services/favorites') return { getCloudFavorites: async (owner: string) => snapshot(owner), setCloudFavorite: async () => snapshot(), mergeCloudFavorites: async () => snapshot() }
      if (name === '@/services/content') return { getPublicTeam: async () => team() }
      if (name === '@/domain/favorites') return { favoriteTeam: (t: FavoriteTeam) => t }
      throw new Error(name)
    },
  })
  const scope = vue.effectScope(); let state: any
  scope.run(() => { state = module.exports.useFavorites() }); await state.toggle(team()); scope.stop()
  identity.value = alice; await settle(); assert.deepEqual([...state.favoriteIds.value], [])
  identity.value = null; assert.deepEqual([...state.favoriteIds.value], [team().id])
})
test('demonstration favorites migrate only into the guest scope and never accept real IDs', () => {
  const identity = vue.ref<string | null>(null), storage = new Map<string, unknown>([['community-football:favorites', ['jiangwan', team().id]]]), module = { exports: {} as any }
  const code = transformSync(readFileSync(new URL('../src/composables/useDemoFavorites.ts', import.meta.url), 'utf8').replaceAll('import.meta.env.', 'runtimeEnv.'), { loader: 'ts', format: 'cjs', target: 'es2020' }).code
  vm.runInNewContext(code, { module, exports: module.exports, runtimeEnv: {}, uni: { getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, value), showToast() {} }, require: (name: string) => name === 'vue' ? vue : { currentUserId: identity } })
  const state = module.exports.useDemoFavorites()
  assert.deepEqual([...state.favoriteIds.value], ['jiangwan'])
  identity.value = alice; assert.deepEqual([...state.favoriteIds.value], []); state.toggle('xuhui')
  identity.value = bob; assert.deepEqual([...state.favoriteIds.value], [])
  identity.value = null; assert.deepEqual([...state.favoriteIds.value], ['jiangwan']); state.toggle(team().id); assert.deepEqual([...state.favoriteIds.value], ['jiangwan'])
})
