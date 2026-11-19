import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash, randomBytes } from 'node:crypto'
import { parseLivePage, parseLiveEntry, parseLiveImageUpload, parseLiveUploadedImage } from '../src/domain/match-live'
const require = createRequire(import.meta.url)
const { createLiveService, PUBLIC_ACTIONS } = require('../cloudfunctions/adminAuth/match-live')
const { createLiveImageService, model } = require('../cloudfunctions/adminAuth/match-live-images')
const { createHttpHandler } = require('../cloudfunctions/adminAuth/http')
const { createContentMemoryStore } = require('./helpers/content-store.cjs')
const { createNewsImageStorage } = require('./helpers/news-image-storage.cjs')
const { PNG } = createRequire(require.resolve('../cloudfunctions/adminAuth/package.json'))('pngjs')
const MID = `m_${'1'.repeat(32)}`, OTHER = `m_${'2'.repeat(32)}`, CID = `c_${'1'.repeat(32)}`, TOKEN = 'a'.repeat(64)
const requestId = () => randomBytes(16).toString('hex')
const empty = { text: '精彩开场', minute: null, images: [] }
function fixture() {
  const memory = createContentMemoryStore(), storage = createNewsImageStorage(), clock = { value: Date.parse('2026-11-18T08:00:00Z') }
  memory.collections.competitions.set(CID, { _id: CID, displayEnabled: true })
  for (const id of [MID, OTHER]) memory.collections.matches.set(id, { _id: id, competitionId: CID, status: 'scheduled', homeScore: null, awayScore: null })
  const options = { store: memory.store, storage: storage.storage, authorize: async (token: string) => token === TOKEN ? { ok: true } : { ok: false, error: { code: 'UNAUTHORIZED', message: '请先登录' } }, now: () => clock.value, logger: { error() {} } }
  const live = createLiveService(options), images = createLiveImageService({ ...options, enabled: true })
  const call = (action: string, fields: any = {}) => live({ action: `live.${action}`, token: TOKEN, matchId: MID, ...fields })
  const publish = (form = empty, id = requestId(), extra = {}) => call('publish', { requestId: id, form, ...extra })
  const image = (action: string, fields = {}) => images({ action: `live.images.${action}`, token: TOKEN, ...fields })
  async function upload(entryId: string) {
    const bytes = PNG.sync.write({ width: 3, height: 2, data: Buffer.alloc(24, 180) })
    const start = await image('start', { entryId, requestId: requestId(), name: '赛场.png', size: bytes.length, mime: 'image/png', sha256: createHash('sha256').update(bytes).digest('hex') })
    assert.equal(start.ok, true); parseLiveImageUpload(start)
    assert.equal((await image('chunk', { id: start.id, index: 0, data: bytes.toString('base64') })).ok, true)
    const result = await image('finish', { id: start.id }); assert.equal(result.ok, true); return parseLiveUploadedImage(result.image)
  }
  return { ...memory, ...storage, clock, live, images, call, publish, image, upload }
}
test('only an authenticated administrator can publish, correct, delete or upload; public feed is anonymous', async () => {
  const f = fixture()
  for (const action of ['listAdmin', 'publish', 'correct', 'delete']) assert.equal((await f.call(action, { token: null })).error.code, 'UNAUTHORIZED')
  for (const action of ['config', 'start', 'chunk', 'finish', 'get', 'cleanup']) assert.equal((await f.image(action, { token: null })).error.code, 'UNAUTHORIZED')
  const r = await f.call('listPublic', { token: null }); assert.equal(r.ok, true); assert.deepEqual(r.entries, [])
})
test('publish has a stable idempotency key, strict fields and no score side effects', async () => {
  const f = fixture(), key = requestId(), before = structuredClone(f.collections.matches.get(MID))
  const a = await f.publish(empty, key), b = await f.publish(empty, key)
  assert.equal(a.ok, true); assert.deepEqual(a, b); assert.equal(f.collections.matchLiveEntries.size, 1)
  assert.equal((await f.publish({ ...empty, text: '改用同一请求' }, key)).error.code, 'CONFLICT')
  assert.equal((await f.publish(empty, key, { matchId: OTHER })).error.code, 'CONFLICT')
  assert.equal((await f.publish(empty, requestId(), { role: 'admin' })).error.code, 'INVALID_ARGUMENT')
  assert.deepEqual(f.collections.matches.get(MID), before)
})
test('text, minute, image count, image URLs and payload fields are strictly validated', async () => {
  const f = fixture()
  for (const form of [{ ...empty, text: '' }, { ...empty, text: '字'.repeat(1001) }, { ...empty, minute: -1 }, { ...empty, minute: 151 }, { ...empty, minute: 1.5 }, { ...empty, text: 'a\u0000' }, { ...empty, images: Array(5).fill({ url: 'https://example.test/a.png', caption: '' }) }, { ...empty, images: [{ url: 'javascript:alert(1)', caption: '' }] }, { ...empty, images: [{ url: 'https://user:pass@example.test/a', caption: '' }] }, { ...empty, images: [{ imageId: 'ni_' + requestId(), url: '', caption: '' }] }, { ...empty, unknown: true }]) assert.equal((await f.publish(form as any)).error.code, 'INVALID_ARGUMENT')
  assert.equal(f.collections.matchLiveEntries.size, 0)
  assert.equal((await f.publish({ ...empty, text: '', minute: 0, images: [{ url: 'https://example.test/a.png', caption: '开场' }] } as any)).ok, true)
})
test('hidden competitions and nonpublic/deleted matches deny all public feed reads', async () => {
  const f = fixture(); await f.publish()
  f.collections.competitions.get(CID).displayEnabled = false
  assert.equal((await f.call('listPublic')).error.code, 'NOT_FOUND'); assert.equal((await f.call('listAdmin')).entries.length, 1)
  f.collections.competitions.get(CID).displayEnabled = 'false'
  assert.equal((await f.call('listPublic')).error.code, 'NOT_FOUND')
  f.collections.competitions.get(CID).displayEnabled = true; f.collections.matches.get(MID).status = 'draft'
  assert.equal((await f.call('listPublic')).error.code, 'NOT_FOUND')
  f.collections.matches.delete(MID)
  assert.equal((await f.call('listPublic')).error.code, 'NOT_FOUND'); assert.equal((await f.publish()).error.code, 'NOT_FOUND')
})
test('public projection excludes versions, ownership, upload IDs, fileIDs and mutation history', async () => {
  const f = fixture(), key = requestId(), entryId = `l_${key}`, image = await f.upload(entryId)
  await f.publish({ ...empty, images: [{ imageId: image.id, url: image.url, caption: '现场' }] } as any, key)
  const r = await f.call('listPublic'), parsed = parseLivePage(r, false, MID)
  assert.equal(parsed.entries[0].images.length, 1)
  for (const secret of ['imageId', 'entryId', 'fileID', 'version', 'mutations', 'creationFingerprint', 'token']) assert.equal(JSON.stringify(r).includes(`"${secret}"`), false)
  const stored = f.collections.matchLiveEntries.get(entryId); assert.equal(stored.images[0].url, ''); assert.equal(f.collections.matchLiveImages.get(image.id).referenced, true)
})
test('corrections and deletions require matching match/version and are safe to retry after a lost response', async () => {
  const f = fixture(), first = (await f.publish()).entry, rid = requestId(), form = { ...empty, text: '官方更正', minute: 35 }
  const change = { id: first.id, expectedVersion: 1, requestId: rid, form }
  const a = await f.call('correct', change), b = await f.call('correct', change)
  assert.equal(a.entry.version, 2); assert.equal(a.entry.corrected, true); assert.deepEqual(a, b)
  assert.equal((await f.call('correct', { ...change, form: empty })).error.code, 'CONFLICT')
  assert.equal((await f.call('correct', { ...change, requestId: requestId() })).error.code, 'CONFLICT')
  assert.equal((await f.call('correct', { ...change, matchId: OTHER })).error.code, 'NOT_FOUND')
  const deletion = { id: first.id, expectedVersion: 2, requestId: requestId() }
  assert.equal((await f.call('delete', deletion)).ok, true); assert.equal((await f.call('delete', deletion)).ok, true)
  assert.deepEqual((await f.call('listPublic')).entries, []); assert.deepEqual((await f.call('listAdmin')).entries, [])
  assert.equal((await f.call('correct', { ...change, expectedVersion: 3, requestId: requestId() })).error.code, 'NOT_FOUND')
})
test('stable time/id pagination handles ties, new posts, corrections and deletions without cross-match cursors', async () => {
  const f = fixture()
  for (let n = 1; n <= 25; n++) await f.publish({ ...empty, text: String(n) }, n.toString(16).padStart(32, '0'))
  const first = await f.call('listPublic'); assert.equal(first.entries.length, 20); parseLivePage(first)
  const edit = first.entries[0]; await f.call('correct', { id: edit.id, expectedVersion: 1, requestId: requestId(), form: { ...empty, text: '更正不重排' } })
  f.clock.value++; await f.publish({ ...empty, text: '新动态' })
  const second = await f.call('listPublic', { cursor: first.nextCursor }); assert.equal(second.entries.length, 5); assert.equal(second.nextCursor, null)
  assert.equal(new Set([...first.entries, ...second.entries].map((e: any) => e.id)).size, 25)
  assert.equal((await f.call('listPublic', { cursor: first.nextCursor, matchId: OTHER })).error.code, 'INVALID_ARGUMENT')
  assert.equal((await f.call('listPublic', { cursor: 'garbage' })).error.code, 'INVALID_ARGUMENT')
  assert.equal((await f.call('listPublic')).entries[0].text, '新动态')
})
test('live uploads use separate scopes and cannot bind a news or another live entry image', async () => {
  const f = fixture(), key = requestId(), image = await f.upload(`l_${key}`)
  assert.ok([...f.objects.keys()].every(id => id.includes('/match-live/')))
  assert.equal(f.collections.newsImages.size, 0)
  assert.equal((await f.publish({ ...empty, images: [{ imageId: image.id, url: '', caption: '' }] } as any)).error.code, 'INVALID_ARGUMENT')
  assert.equal((await f.image('get', { id: image.id, entryId: `l_${requestId()}` })).error.code, 'NOT_FOUND')
  assert.equal((await f.image('start', { entryId: 'n_' + requestId() })).error.code, 'INVALID_ARGUMENT')
  const file = f.collections.matchLiveImages.get(image.id)
  assert.equal(model.scopedObject(file, { ...file.objects[0], cloudPath: 'news-images/fake' }, f.storage), false)
})
test('failed publication rolls back image binding and content together; expired images cannot bind', async () => {
  const f = fixture(), key = requestId(), image = await f.upload(`l_${key}`), form = { ...empty, images: [{ imageId: image.id, url: '', caption: '' }] } as any
  const atomic = f.store.atomic
  f.store.atomic = (fn: any) => atomic((tx: any) => fn({ ...tx, async set(collection: string, id: string, record: any) { if (collection === 'matchLiveEntries') throw new Error('Injected content write failure'); return tx.set(collection, id, record) } }))
  assert.equal((await f.publish(form, key)).error.code, 'SERVICE_UNAVAILABLE'); assert.equal(f.collections.matchLiveImages.get(image.id).referenced, false); assert.equal(f.collections.matchLiveEntries.size, 0)
  f.store.atomic = atomic; f.clock.value += model.TTL + 1
  assert.equal((await f.publish(form, key)).error.code, 'INVALID_ARGUMENT')
})
test('image replacement and deletion protect active content and retain detached images for 24 hours', async () => {
  const f = fixture(), key = requestId(), entryId = `l_${key}`, image = await f.upload(entryId)
  await f.publish({ ...empty, images: [{ imageId: image.id, url: '', caption: '' }] } as any, key)
  f.clock.value += model.TTL * 2
  assert.equal((await f.image('cleanup', { dryRun: false })).protectedImages, 1)
  assert.equal(f.objects.has(f.collections.matchLiveImages.get(image.id).fileID), true)
  assert.equal((await f.call('correct', { id: entryId, expectedVersion: 1, requestId: requestId(), form: empty })).ok, true)
  const file = f.collections.matchLiveImages.get(image.id); assert.equal(file.referenced, false); assert.equal(file.expiresAt, f.clock.value + model.TTL)
  assert.equal((await f.image('cleanup', { dryRun: false })).removedObjects, 0)
  f.clock.value += model.TTL + 1
  assert.equal((await f.image('cleanup', { dryRun: true })).eligibleObjects, 1)
  assert.equal((await f.image('cleanup', { dryRun: false })).removedObjects, 1)
  assert.equal(f.collections.matchLiveImages.get(image.id).status, 'cleaned')
})
test('post-commit link failures explicitly require a reread; link errors never masquerade as an empty feed', async () => {
  const f = fixture(), key = requestId(), image = await f.upload(`l_${key}`)
  f.controls.linkFails = true
  assert.equal((await f.publish({ ...empty, images: [{ imageId: image.id, url: '', caption: '' }] } as any, key)).error.code, 'WRITE_COMMITTED')
  assert.equal(f.collections.matchLiveEntries.size, 1); assert.equal((await f.call('listPublic')).error.code, 'SERVICE_UNAVAILABLE')
  f.controls.linkFails = false; assert.equal((await f.call('listPublic')).entries.length, 1)
})
test('HTTP gateway exposes only the public feed and permits bounded live image chunks', async () => {
  const f = fixture(), handler = createHttpHandler(e => e.action.startsWith('live.images.') ? f.images(e) : f.live(e), [], PUBLIC_ACTIONS)
  const send = (body: any, token = false) => handler({ httpMethod: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${TOKEN}` } : {}) }, body: JSON.stringify(body) })
  assert.equal((await send({ action: 'live.listPublic', matchId: MID })).statusCode, 200)
  assert.equal((await send({ action: 'live.publish', matchId: MID })).statusCode, 401)
  assert.equal((await send({ action: 'live.publish', token: TOKEN, matchId: MID })).statusCode, 400)
  const result = await send({ action: 'live.images.chunk', id: 'li_' + requestId(), index: 0, data: Buffer.alloc(65536).toString('base64') }, true)
  assert.equal(result.statusCode, 404)
  assert.equal((await send({ action: 'live.publish', padding: 'x'.repeat(17000) }, true)).statusCode, 400)
})
test('client contracts reject reordered, cross-match, duplicate and private public feed payloads', async () => {
  const f = fixture(); await f.publish(); const r = await f.call('listPublic'), entry = r.entries[0]
  assert.throws(() => parseLivePage({ ...r, entries: [entry, entry] }))
  assert.throws(() => parseLivePage(r, false, OTHER))
  assert.throws(() => parseLiveEntry({ ...entry, images: [{ url: 'https://example.test/a', caption: '', imageId: 'li_' + requestId() }] }))
  assert.throws(() => parseLiveEntry({ ...entry, minute: 151 }))
  assert.throws(() => parseLiveImageUpload({ ok: true, id: 'ni_' + requestId(), chunkSize: 65536, uploaded: [] }))
  assert.throws(() => parseLiveUploadedImage({ id: 'li_' + requestId(), entryId: entry.id, name: 'a.png', size: 1, mime: 'image/png', width: 4097, height: 1, url: 'https://example.test/a' }))
})
