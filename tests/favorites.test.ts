import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { parseFavoritesResponse } from '../src/domain/favorites'
const require = createRequire(import.meta.url)
const { createFavoritesHandler, MAX_FAVORITES } = require('../cloudfunctions/userProfile/favorites.js')
const { createFavoritesStore } = require('../cloudfunctions/userProfile/favorites-store.js')
const { userId, DEFAULT_APP_ID, createUserProfileHandler } = require('../cloudfunctions/userProfile/service.js')
const { createFavoritesMemoryStore } = require('./helpers/favorites-store.cjs')
const tid = (n: number) => 't_' + n.toString(16).padStart(64, '0')
const cid = 'c_' + '1'.repeat(32)
const owner = userId(DEFAULT_APP_ID, 'alice')
function fixture() {
  const memory = createFavoritesMemoryStore(), logs: string[] = []
  memory.collections.competitions.set(cid, { _id: cid, displayEnabled: true })
  for (let n = 1; n <= 55; n++) {
    const id = tid(n), rid = `registration-${n}`
    memory.collections.teams.set(id, { _id: id, name: `公开球队${n}`, district: '浦东新区', status: 'active', contactPhone: 'private-phone', leaderUserId: 'private-leader', roster: [{ identity: 'private-id' }] })
    memory.collections.registrations.set(rid, { _id: rid, teamId: id, competitionId: cid, status: 'approved' })
  }
  for (const openId of ['alice', 'bob']) {
    const id = userId(DEFAULT_APP_ID, openId)
    memory.collections.users.set(id, { _id: id, appId: DEFAULT_APP_ID, openId, nickname: '原昵称', role: 'leader', avatarFileId: '', createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T00:00:00Z', registrationUploadSlots: [{ id: 'kept' }] })
  }
  const context = { OPENID: 'alice', APPID: DEFAULT_APP_ID }
  const handler = createFavoritesHandler({ store: memory.favoritesStore, context: () => context, now: () => new Date('2026-11-18T01:00:00Z'), logger: { error: (s: string) => logs.push(s) } })
  const call = (action = 'favorites.get', data: Record<string, any> = {}) => handler({ action, expectedOwner: userId(context.APPID, context.OPENID), ...data })
  const set = (id: string, version: number, favorite = true) => call('favorites.set', { teamId: id, favorite, expectedVersion: version })
  return { ...memory, context, handler, call, set, logs }
}
test('favorites: legacy user reads an empty collection without changing the profile', async () => {
  const f = fixture(), before = structuredClone(f.collections.users.get(owner))
  const result = parseFavoritesResponse(await f.call(), owner)
  assert.equal(result.version, 0); assert.deepEqual(result.teamIds, []); assert.equal(result.updatedAt, null)
  assert.deepEqual(f.collections.users.get(owner), before)
})
test('favorites: save, fresh read and removal preserve profile, role and registration fields', async () => {
  const f = fixture(), before = structuredClone(f.collections.users.get(owner))
  assert.equal((await f.set(tid(1), 0)).favorites.version, 1)
  const saved = parseFavoritesResponse(await f.call(), owner)
  assert.deepEqual(saved.teamIds, [tid(1)]); assert.equal(saved.teams[0].name, '公开球队1')
  const { favorites, ...rest } = f.collections.users.get(owner)
  assert.deepEqual(rest, before)
  assert.equal((await f.set(tid(1), 1, false)).favorites.version, 2)
  assert.deepEqual((await f.call()).favorites.teamIds, [])
})
test('favorites: cloud-confirmed identity isolates two accounts and rejects forged owners and metadata', async () => {
  const f = fixture(); await f.set(tid(1), 0)
  f.context.OPENID = 'bob'
  assert.deepEqual((await f.call()).favorites.teamIds, [])
  assert.equal((await f.call('favorites.get', { expectedOwner: owner, userInfo: { OPENID: 'alice' }, tcbContext: { APPID: DEFAULT_APP_ID } })).error.code, 'IDENTITY_CHANGED')
  await f.set(tid(2), 0)
  f.context.OPENID = 'alice'
  assert.deepEqual((await f.call()).favorites.teamIds, [tid(1)])
  f.context.APPID = 'other-app'; assert.equal((await f.call()).error.code, 'APP_MISMATCH')
  f.context.OPENID = ''; assert.equal((await f.call()).error.code, 'AUTH_REQUIRED')
})
test('favorites: unregistered identities cannot create users through favorites', async () => {
  const f = fixture(); f.context.OPENID = 'unknown'
  assert.equal((await f.call()).error.code, 'AUTH_REQUIRED'); assert.equal(f.collections.users.size, 2)
})
test('favorites: malformed requests, demonstration IDs and arbitrary profile writes are rejected', async () => {
  const f = fixture()
  for (const data of [{ teamId: 'jiangwan', favorite: true, expectedVersion: 0 }, { teamId: tid(1), favorite: 'true', expectedVersion: 0 }, { teamId: tid(1), favorite: true, expectedVersion: -1 }, { teamId: tid(1), favorite: true, expectedVersion: 0, role: 'admin' }]) {
    assert.equal((await f.call('favorites.set', data)).error.code, 'INVALID_ARGUMENT')
  }
  for (const ids of [[], [tid(1), tid(1)], ['demo'], Array(51).fill(tid(1))]) assert.equal((await f.call('favorites.merge', { expectedVersion: 0, teamIds: ids })).error.code, 'INVALID_ARGUMENT')
  assert.equal((await f.call('favorites.get', { expectedVersion: 0 })).error.code, 'INVALID_ARGUMENT')
  assert.equal(f.collections.users.get(owner).favorites, undefined)
})
test('favorites: private, unapproved, dissolved and missing teams cannot be added', async () => {
  for (const type of ['hidden', 'unapproved', 'dissolved', 'missing']) {
    const f = fixture()
    if (type === 'hidden') f.collections.competitions.get(cid).displayEnabled = false
    if (type === 'unapproved') f.collections.registrations.get('registration-1').status = 'pending'
    if (type === 'dissolved') f.collections.teams.get(tid(1)).status = 'dissolved'
    if (type === 'missing') f.collections.teams.delete(tid(1))
    assert.equal((await f.set(tid(1), 0)).error.code, 'TEAM_UNAVAILABLE')
    assert.equal(f.collections.users.get(owner).favorites, undefined)
  }
})
test('favorites: a hidden team becomes an unavailable placeholder and remains removable without leaking metadata', async () => {
  const f = fixture(); await f.set(tid(1), 0)
  f.collections.competitions.get(cid).displayEnabled = false
  const saved = (await f.call()).favorites
  assert.deepEqual(saved.teams, [{ id: tid(1), available: false, name: '', district: '' }])
  assert.ok(!JSON.stringify(saved).includes('private'))
  assert.ok(!JSON.stringify(saved).includes('公开球队1'))
  assert.deepEqual((await f.set(tid(1), 1, false)).favorites.teamIds, [])
})
test('favorites: only safe public fields are returned and duplicate desired states do not increment versions', async () => {
  const f = fixture(), first = await f.set(tid(1), 0)
  assert.deepEqual(Object.keys(first.favorites.teams[0]).sort(), ['available', 'district', 'id', 'name'])
  assert.equal((await f.set(tid(1), 0)).favorites.version, 1, 'lost acknowledgement retry is idempotent')
  assert.equal((await f.set(tid(2), 0, false)).favorites.version, 1)
})
test('favorites: concurrent devices cannot overwrite each other and can continue after refreshing', async () => {
  const f = fixture(), results = await Promise.all([f.set(tid(1), 0), f.set(tid(2), 0)])
  assert.equal(results.filter(r => r.ok).length, 1)
  assert.equal(results.find(r => !r.ok).error.code, 'CONFLICT')
  const latest = (await f.call()).favorites
  const missing = latest.teamIds.includes(tid(1)) ? tid(2) : tid(1)
  assert.equal((await f.set(missing, latest.version)).favorites.teamIds.length, 2)
})
test('favorites: explicit merge unions the cloud list atomically and is safe to repeat', async () => {
  const f = fixture(); await f.set(tid(1), 0)
  const request = { expectedVersion: 1, teamIds: [tid(1), tid(2)] }
  assert.deepEqual((await f.call('favorites.merge', request)).favorites.teamIds, [tid(1), tid(2)])
  assert.equal((await f.call('favorites.merge', request)).favorites.version, 2)
  f.collections.teams.get(tid(4)).status = 'dissolved'
  assert.equal((await f.call('favorites.merge', { expectedVersion: 2, teamIds: [tid(3), tid(4)] })).error.code, 'TEAM_UNAVAILABLE')
  assert.deepEqual((await f.call()).favorites.teamIds, [tid(1), tid(2)], 'a failed merge must not partially write')
})
test('favorites: maximum count is enforced across devices and removal frees a slot', async () => {
  const f = fixture()
  const ids = Array.from({ length: MAX_FAVORITES }, (_, n) => tid(n + 1))
  assert.equal((await f.call('favorites.merge', { expectedVersion: 0, teamIds: ids })).favorites.teamIds.length, 50)
  assert.equal((await f.set(tid(51), 1)).error.code, 'FAVORITES_LIMIT')
  await f.set(tid(1), 1, false)
  assert.equal((await f.set(tid(51), 2)).favorites.teamIds.length, 50)
})
test('favorites: corrupt storage and database failures fail closed and log no identity', async () => {
  const f = fixture(); f.collections.users.get(owner).favorites = { version: 1, teamIds: ['fake'], updatedAt: 'invalid' }
  assert.equal((await f.call()).error.code, 'FAVORITES_UNAVAILABLE')
  delete f.collections.users.get(owner).favorites
  f.failures.write = true; assert.equal((await f.set(tid(1), 0)).error.code, 'SERVICE_UNAVAILABLE')
  assert.equal(f.collections.users.get(owner).favorites, undefined)
  assert.deepEqual(f.logs, ['[favorites] cloud operation failed'])
  f.failures.write = false; f.failures.scan = true
  assert.equal((await f.set(tid(1), 0)).error.code, 'SERVICE_UNAVAILABLE')
})
test('favorites: ordinary nickname saves keep cloud favorites intact', async () => {
  const f = fixture(); await f.set(tid(1), 0)
  const profile = createUserProfileHandler({ cloud: { getWXContext: () => f.context, database: () => f.database }, logger: { error() {} } })
  assert.equal((await profile({ action: 'update', profile: { nickname: '新昵称' } })).ok, true)
  assert.deepEqual((await f.call()).favorites.teamIds, [tid(1)])
})
test('favorites: public visibility is rechecked inside the write transaction', async () => {
  const f = fixture(), original = f.favoritesStore.atomic
  f.favoritesStore.atomic = (fn: any) => { f.collections.competitions.get(cid).displayEnabled = false; return original(fn) }
  assert.equal((await f.set(tid(1), 0)).error.code, 'TEAM_UNAVAILABLE')
})
test('favorites: SDK adapter pages the public catalog past 100 rows and updates only favorites', async () => {
  const rows = Array.from({ length: 101 }, (_, n) => ({ _id: String(n).padStart(3, '0') })), updates: unknown[] = [], queries: any[] = []
  const database = {
    command: { gt: (id: string) => ({ after: id }) },
    collection: (name: string) => ({ where: (where: any) => { queries.push({ name, where }); return { orderBy: () => ({ limit: () => ({ get: async () => ({ data: rows.filter(r => !where._id || r._id > where._id.after).slice(0, 100) }) }) }) } } }),
    runTransaction: (fn: any) => fn({ collection: (name: string) => ({ doc: (id: string) => ({ update: (input: unknown) => updates.push({ name, id, input }) }) }) }),
  }
  const store = createFavoritesStore(database)
  assert.equal((await store.scan('registrations')).length, 101); assert.equal(queries.length, 2)
  const favorites = { version: 1, teamIds: [tid(1)], updatedAt: '2026-11-18T01:00:00Z' }
  await store.atomic((tx: any) => tx.saveFavorites(owner, favorites))
  assert.deepEqual(updates, [{ name: 'users', id: owner, input: { data: { favorites } } }])
})
