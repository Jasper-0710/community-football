import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash, randomBytes, webcrypto } from 'node:crypto'
import { prepareNewsImage, uploadNewsImage } from '../admin/src/news-images'
import { parseNewsImage, parseNewsImageUpload, parseNewsImageCleanup } from '../src/domain/news-image'
import { parseNewsArticle } from '../src/domain/content'
import { createAdminApi } from '../admin/src/api'
const require = createRequire(import.meta.url), cloudRequire = createRequire(require.resolve('../cloudfunctions/adminAuth/package.json'))
const { PNG } = cloudRequire('pngjs'), jpeg = cloudRequire('jpeg-js')
const { createNewsImageService } = require('../cloudfunctions/adminAuth/news-images.js')
const { validateNewsImage } = require('../cloudfunctions/adminAuth/news-image-validation.js')
const { createContentService } = require('../cloudfunctions/adminAuth/content.js')
const { createContentMemoryStore } = require('./helpers/content-store.cjs')
const { createNewsImageStorage } = require('./helpers/news-image-storage.cjs')
const { createHttpHandler } = require('../cloudfunctions/adminAuth/http.js')
const { CHUNK, TTL, LEASE } = require('../cloudfunctions/adminAuth/news-image-model.js')
const TOKEN = 'a'.repeat(64), ARTICLE = `n_${'1'.repeat(32)}`, OTHER = `n_${'2'.repeat(32)}`
const form = { title: '图片新闻', category: '快讯', excerpt: '', author: '赛事运营', coverUrl: '', body: [{ type: 'text', text: '正文' }], status: 'draft', pinned: false, competitionId: null }
const png = (width = 3, height = 2) => PNG.sync.write({ width, height, data: Buffer.alloc(width * height * 4, 180) })
const hash = (v: Buffer) => createHash('sha256').update(v).digest('hex')
function fixture(enabled = true) {
  const memory = createContentMemoryStore(), storage = createNewsImageStorage(), clock = { value: Date.parse('2026-11-16T00:00:00Z') }
  const authorize = async (token: string) => token === TOKEN ? { ok: true } : { ok: false, error: { code: 'UNAUTHORIZED', message: '请先登录' } }
  const options = { store: memory.store, storage: storage.storage, authorize, now: () => clock.value, logger: { error() {} } }
  const images = createNewsImageService({ ...options, enabled }), content = createContentService(options)
  const call = (action: string, args: any = {}) => images({ action: `news.images.${action}`, token: TOKEN, ...args })
  const news = (action: string, args: any = {}) => content({ action: `news.${action}`, token: TOKEN, ...args })
  async function start(bytes = png(), changes: any = {}) { return call('start', { articleId: ARTICLE, requestId: randomBytes(16).toString('hex'), name: '球场.png', size: bytes.length, mime: 'image/png', sha256: hash(bytes), ...changes }) }
  async function upload(bytes = png(), changes: any = {}) {
    const s = await start(bytes, changes); assert.equal(s.ok, true)
    for (let i = 0; i < Math.ceil(bytes.length / CHUNK); i++) assert.equal((await call('chunk', { id: s.id, index: i, data: bytes.subarray(i * CHUNK, (i + 1) * CHUNK).toString('base64') })).ok, true)
    const r = await call('finish', { id: s.id }); assert.equal(r.ok, true, JSON.stringify(r)); return r.image
  }
  return { ...memory, ...storage, clock, images, content, call, news, start, upload }
}
test('image APIs require an authenticated administrator and uploads default to disabled', async () => {
  const f = fixture(false)
  for (const action of ['config', 'start', 'chunk', 'finish', 'get', 'cleanup']) assert.equal((await f.call(action, { token: null })).error.code, 'UNAUTHORIZED')
  assert.equal((await f.call('config')).enabled, false)
  assert.equal((await f.start()).error.code, 'UPLOAD_UNAVAILABLE')
  assert.equal(f.collections.newsImages.size, 0)
  assert.equal((await f.call('cleanup', { dryRun: true })).ok, true)
})
test('metadata rejects unsafe names, size/type/path mismatches and unsupported fields', async () => {
  const f = fixture()
  for (const bad of [{ name: '../x.png' }, { name: 'x.svg' }, { size: 2097153 }, { size: 0 }, { mime: 'image/svg+xml' }, { sha256: 'x' }, { articleId: 'bad' }, { cloudPath: 'foreign' }]) assert.equal((await f.start(png(), bad)).error.code, 'INVALID_ARGUMENT')
  assert.equal(f.objects.size, 0)
})
test('PNG and JPG decode checks reject truncation, CRC damage, dimensions and disguised content', () => {
  assert.deepEqual(validateNewsImage(png(), 'image/png'), { width: 3, height: 2 })
  const jpg = jpeg.encode({ width: 3, height: 2, data: Buffer.alloc(24, 180) }, 80).data
  assert.deepEqual(validateNewsImage(jpg, 'image/jpeg'), { width: 3, height: 2 })
  const crc = png(); crc[29] ^= 1
  const oversized = png(); oversized.writeUInt32BE(4097, 16)
  const pixels = png(); pixels.writeUInt32BE(3000, 16); pixels.writeUInt32BE(3000, 20)
  for (const [bytes, mime] of [[png().subarray(0, 40), 'image/png'], [crc, 'image/png'], [oversized, 'image/png'], [pixels, 'image/png'], [jpg.subarray(0, -2), 'image/jpeg'], [Buffer.from('<svg/>'), 'image/png']]) assert.throws(() => validateNewsImage(bytes, mime), (e: any) => e.code === 'INVALID_ARGUMENT')
})
test('upload start/chunks/finish are idempotent and different content cannot reuse a request', async () => {
  const f = fixture(), bytes = png(), key = '3'.repeat(32), a = await f.start(bytes, { requestId: key }), b = await f.start(bytes, { requestId: key })
  assert.deepEqual(a, b)
  assert.equal((await f.start(bytes, { requestId: key, articleId: OTHER })).error.code, 'CONFLICT')
  const chunk = { id: a.id, index: 0, data: bytes.toString('base64') }
  assert.equal((await f.call('chunk', chunk)).ok, true); assert.equal((await f.call('chunk', chunk)).ok, true)
  const changed = Buffer.from(bytes); changed[32] ^= 1
  assert.equal((await f.call('chunk', { ...chunk, data: changed.toString('base64') })).error.code, 'CONFLICT')
  const r = await f.call('finish', { id: a.id }); assert.equal(r.ok, true); assert.equal(parseNewsImage(r.image).width, 3)
  assert.equal((await f.call('finish', { id: a.id })).ok, true); assert.equal(f.objects.size, 2)
})
test('incomplete chunks, changed stored bytes and aggregate hash mismatches cannot finalize', async () => {
  const f = fixture(), s = await f.start(); assert.equal((await f.call('finish', { id: s.id })).error.code, 'CONFLICT')
  assert.equal((await f.call('chunk', { id: s.id, index: 1, data: png().toString('base64') })).error.code, 'INVALID_ARGUMENT')
  await f.call('chunk', { id: s.id, index: 0, data: png().toString('base64') })
  f.objects.set([...f.objects.keys()][0], Buffer.alloc(png().length))
  assert.equal((await f.call('finish', { id: s.id })).error.code, 'INVALID_ARGUMENT')
  const wrong = await f.start(png(), { sha256: '0'.repeat(64) }); await f.call('chunk', { id: wrong.id, index: 0, data: png().toString('base64') })
  assert.equal((await f.call('finish', { id: wrong.id })).error.code, 'INVALID_ARGUMENT')
})
test('HTTP accepts authenticated 64KiB chunks below the cloud gateway limit while keeping ordinary requests bounded', async () => {
  const f = fixture(), bytes = randomBytes(CHUNK), s = await f.start(bytes), http = createHttpHandler(f.images)
  const request = { httpMethod: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ action: 'news.images.chunk', id: s.id, index: 0, data: bytes.toString('base64') }) }
  assert.ok(Buffer.byteLength(request.body) < 100000)
  assert.equal((await http(request)).statusCode, 200)
  assert.equal((await http({ ...request, body: JSON.stringify({ action: 'news.create', padding: 'a'.repeat(17000) }) })).statusCode, 400)
  assert.equal((await http({ ...request, headers: { 'content-type': 'application/json' } })).statusCode, 401)
  assert.equal((await http({ ...request, body: 'x'.repeat(270001) })).statusCode, 400)
})
test('storage reservations survive a lost response and retry reuses the same staged object', async () => {
  const f = fixture(), s = await f.start(); f.controls.responseFails = 1
  const args = { id: s.id, index: 0, data: png().toString('base64') }
  assert.equal((await f.call('chunk', args)).error.code, 'SERVICE_UNAVAILABLE')
  assert.equal(f.collections.newsImages.get(s.id).objects.length, 1); assert.equal(f.objects.size, 1)
  assert.equal((await f.call('chunk', args)).ok, true); assert.equal(f.objects.size, 1)
  assert.equal((await f.call('finish', { id: s.id })).ok, true)
})
test('article saves bind private image IDs atomically and never persist signed URLs', async () => {
  const f = fixture(), image = await f.upload(), payload = { ...form, coverUrl: image.url, coverImageId: image.id, body: [{ type: 'image', imageId: image.id, url: image.url, caption: '球场' }] }
  const r = await f.news('create', { requestId: '1'.repeat(32), form: payload }); assert.equal(r.ok, true)
  const record = f.collections.newsArticles.get(ARTICLE), registry = f.collections.newsImages.get(image.id)
  assert.equal(record.coverUrl, ''); assert.equal(record.body[0].url, ''); assert.equal(registry.referenced, true); assert.equal(registry.expiresAt, null)
  assert.equal(parseNewsArticle(r.article, true, true).body?.[0].type, 'image')
  assert.equal((await f.news('getPublic', { id: ARTICLE })).error.code, 'NOT_FOUND')
  const other = await f.news('create', { requestId: '2'.repeat(32), form: payload }); assert.equal(other.error.code, 'INVALID_ARGUMENT'); assert.equal(f.collections.newsArticles.has(OTHER), false)
  const published = await f.news('update', { id: ARTICLE, expectedVersion: 1, form: { ...payload, status: 'published' } }); assert.equal(published.ok, true)
  const pub = await f.news('getPublic', { id: ARTICLE }); assert.equal(pub.ok, true); assert.equal('coverImageId' in pub.article, false); assert.equal('imageId' in pub.article.body[0], false)
})
test('conflicts and transaction failures preserve original image references', async () => {
  const f = fixture(), first = await f.upload(), second = await f.upload()
  await f.news('create', { requestId: '1'.repeat(32), form: { ...form, coverImageId: first.id } })
  const change = { id: ARTICLE, expectedVersion: 2, form: { ...form, coverImageId: second.id } }
  assert.equal((await f.news('update', change)).error.code, 'CONFLICT')
  assert.equal(f.collections.newsImages.get(first.id).referenced, true); assert.equal(f.collections.newsImages.get(second.id).referenced, false)
  f.failures.write = true; assert.equal((await f.news('update', { ...change, expectedVersion: 1 })).error.code, 'SERVICE_UNAVAILABLE'); f.failures.write = false
  assert.equal(f.collections.newsImages.get(first.id).referenced, true); assert.equal(f.collections.newsArticles.get(ARTICLE).coverImageId, first.id)
  const atomic = f.store.atomic.bind(f.store)
  f.store.atomic = (fn: any) => atomic((tx: any) => fn({ ...tx, async set(name: string, id: string, record: any) { if (name === 'newsArticles') throw new Error('Article write failed after image mutations'); await tx.set(name, id, record) } }))
  assert.equal((await f.news('update', { ...change, expectedVersion: 1 })).error.code, 'SERVICE_UNAVAILABLE')
  assert.equal(f.collections.newsImages.get(first.id).referenced, true); assert.equal(f.collections.newsImages.get(second.id).referenced, false)
  assert.equal(f.collections.newsArticles.get(ARTICLE).version, 1)
})
test('replacement and deletion unbind images with 24-hour retention; drafts stay protected', async () => {
  const f = fixture(), first = await f.upload(), second = await f.upload()
  await f.news('create', { requestId: '1'.repeat(32), form: { ...form, coverImageId: first.id } })
  f.clock.value += TTL * 2
  const cleanup = await f.call('cleanup', { dryRun: false }); assert.equal(cleanup.protectedImages, 1)
  assert.equal(f.objects.has(f.collections.newsImages.get(first.id).fileID), true)
  const replacement = await f.upload()
  assert.equal((await f.news('update', { id: ARTICLE, expectedVersion: 1, form: { ...form, coverImageId: replacement.id } })).ok, true)
  assert.equal(f.collections.newsImages.get(first.id).expiresAt, f.clock.value + TTL)
  await f.call('cleanup', { dryRun: false }); assert.equal(f.objects.has(f.collections.newsImages.get(first.id).fileID), true)
  assert.equal((await f.news('delete', { id: ARTICLE, expectedVersion: 2 })).ok, true)
  assert.equal(f.collections.newsImages.get(replacement.id).referenced, false)
  f.clock.value += TTL + LEASE; await f.call('cleanup', { dryRun: false }); assert.equal(f.objects.size, 0)
  assert.equal((await f.call('get', { id: second.id, articleId: ARTICLE })).error.code, 'NOT_FOUND')
})
test('cleanup dry-run has no writes, leases protect late uploads and partial deletion is retryable', async () => {
  const f = fixture(), image = await f.upload(); f.clock.value += TTL + 1
  const record = f.collections.newsImages.get(image.id); record.objects[0].leaseUntil = f.clock.value + LEASE
  const before = structuredClone(record), dry = await f.call('cleanup', { dryRun: true })
  assert.equal(dry.eligibleObjects, 1); assert.deepEqual(record, before); assert.equal(f.removed.length, 0)
  f.controls.removeLimit = 1
  await f.call('cleanup', { dryRun: false }); assert.equal(f.objects.size, 1)
  f.clock.value += LEASE + 1; f.controls.removeFails = true
  assert.equal((await f.call('cleanup', { dryRun: false })).deferredImages > 0, true); assert.equal(f.objects.size, 1)
  f.controls.removeFails = false; await f.call('cleanup', { dryRun: false }); assert.equal(f.objects.size, 0)
})
test('cleanup never deletes foreign environment/path objects and signing checks article ownership', async () => {
  const f = fixture(), image = await f.upload(), registry = f.collections.newsImages.get(image.id)
  assert.equal((await f.call('get', { id: image.id, articleId: OTHER })).error.code, 'NOT_FOUND')
  registry.objects.push({ fileID: 'cloud://foreign/news-images/files/x.png', cloudPath: 'news-images/files/x.png', leaseUntil: 0 })
  f.clock.value += TTL + LEASE; const r = await f.call('cleanup', { dryRun: false })
  assert.equal(r.removedObjects, 0); assert.equal(r.deferredImages, 1); assert.equal(f.removed.length, 0)
})
test('save racing cleanup cannot bind an expired/claimed image or delete a bound final image', async () => {
  for (const expired of [false, true]) {
    const f = fixture(), image = await f.upload(); f.clock.value += expired ? TTL + 1 : LEASE + 1
    const [save] = await Promise.all([f.news('create', { requestId: '1'.repeat(32), form: { ...form, coverImageId: image.id } }), f.call('cleanup', { dryRun: false })])
    assert.equal(save.ok, !expired)
    if (!expired) assert.equal(f.objects.has(f.collections.newsImages.get(image.id).fileID), true)
    else assert.equal(f.collections.newsArticles.size, 0)
  }
})
test('concurrent finishes choose one final object and unused final objects can be cleaned', async () => {
  const f = fixture(), s = await f.start(); await f.call('chunk', { id: s.id, index: 0, data: png().toString('base64') })
  const results = await Promise.all([f.call('finish', { id: s.id }), f.call('finish', { id: s.id })]); assert.equal(results.every(r => r.ok), true)
  await f.news('create', { requestId: '1'.repeat(32), form: { ...form, coverImageId: s.id } })
  f.clock.value += LEASE + 1; await f.call('cleanup', { dryRun: false })
  assert.equal(f.objects.size, 1); assert.equal(f.objects.has(f.collections.newsImages.get(s.id).fileID), true)
})
test('signature renewal does not invalidate news pagination and hidden content issues no public URLs', async () => {
  const f = fixture(), image = await f.upload(); await f.news('create', { requestId: '1'.repeat(32), form: { ...form, status: 'published', coverImageId: image.id } })
  for (let i = 2; i <= 25; i++) await f.news('create', { requestId: i.toString(16).padStart(32, '0'), form: { ...form, status: 'published' } })
  const first = await f.news('listPublic'), refreshed = await f.news('getPublic', { id: ARTICLE }); assert.equal(refreshed.ok, true)
  assert.equal((await f.news('listPublic', { cursor: first.nextCursor })).articles.length, 5)
  f.collections.newsArticles.get(ARTICLE).competitionId = `c_${'1'.repeat(32)}`
  f.collections.competitions.set(`c_${'1'.repeat(32)}`, { displayEnabled: false })
  const before = f.controls.version; assert.equal((await f.news('getPublic', { id: ARTICLE })).error.code, 'NOT_FOUND'); assert.equal(f.controls.version, before)
})
test('a committed save followed by signing failure reports saved state explicitly', async () => {
  const f = fixture(), image = await f.upload(); f.controls.linkFails = true
  const r = await f.news('create', { requestId: '1'.repeat(32), form: { ...form, coverImageId: image.id } })
  assert.equal(r.error.code, 'WRITE_COMMITTED'); assert.equal(f.collections.newsArticles.size, 1); assert.equal(f.collections.newsImages.get(image.id).referenced, true)
  f.controls.linkFails = false; assert.equal((await f.news('getAdmin', { id: ARTICLE })).ok, true)
})
test('cleanup pagination scans each registry once and response parsers reject malformed capabilities', async () => {
  const f = fixture(); for (let i = 1; i <= 21; i++) await f.start(png(), { requestId: i.toString(16).padStart(32, '0') })
  const first = parseNewsImageCleanup(await f.call('cleanup', { dryRun: true })); assert.equal(first.scanned, 20)
  assert.equal(parseNewsImageCleanup(await f.call('cleanup', { dryRun: true, cursor: first.nextCursor })).scanned, 1)
  assert.throws(() => parseNewsImageUpload({ ok: true, id: `ni_${'1'.repeat(32)}`, chunkSize: CHUNK, uploaded: [0, 0] }))
})
test('browser upload helper resumes successful chunks after network failure and checks cancellation', async () => {
  if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto })
  const f = fixture(), bytes = PNG.sync.write({ width: 300, height: 300, data: randomBytes(360000) }), draft = await prepareNewsImage({ name: '球场.png', size: bytes.length, type: 'image/png', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
  const gateway = createHttpHandler(async (event: any) => f.images(event)), requests: any[] = []
  let failSecond = true
  const fetcher = async (_url: any, options: any) => {
    if (Buffer.byteLength(options.body) > 100000) return new Response(JSON.stringify({ code: 'EXCEED_MAX_PAYLOAD_SIZE' }), { status: 413 })
    const body = JSON.parse(options.body); requests.push(body)
    if (body.action === 'news.images.chunk' && body.index === 1 && failSecond) { failSecond = false; throw new Error('Network disconnected') }
    const r = await gateway({ httpMethod: 'POST', headers: options.headers, body: options.body })
    return new Response(r.body, { status: r.statusCode, headers: r.headers })
  }
  const api = createAdminApi('https://api.example.test', fetcher as typeof fetch), authorized: any = (fn: any) => fn(api, TOKEN)
  await assert.rejects(uploadNewsImage(draft, ARTICLE, authorized)); const r = await uploadNewsImage(draft, ARTICLE, authorized)
  assert.equal(r.articleId, ARTICLE); assert.equal(draft.progress, 100); assert.equal(requests.filter(r => r.action === 'news.images.chunk' && r.index === 0).length, 1)
  const before = requests.length; await assert.rejects(uploadNewsImage(draft, ARTICLE, authorized, () => false)); assert.equal(requests.length, before)
  await assert.rejects(prepareNewsImage({ name: 'bad.svg', size: 6, type: 'image/svg+xml', arrayBuffer: async () => Buffer.from('<svg/>') }))
})
test('a near-2MiB image uploads through a 100KB gateway using 32 chunks and one final object', async () => {
  const f = fixture(), bytes = PNG.sync.write({ width: 720, height: 720, data: randomBytes(720 * 720 * 4) })
  assert.ok(bytes.length <= 2 * 1024 * 1024)
  const draft = await prepareNewsImage({ name: 'large.png', size: bytes.length, type: 'image/png', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
  const gateway = createHttpHandler(f.images), sizes: number[] = []
  const api = createAdminApi('https://api.example.test', (async (_url: any, options: any) => {
    sizes.push(Buffer.byteLength(options.body))
    if (sizes.at(-1)! > 100000) return new Response('{"code":"EXCEED_MAX_PAYLOAD_SIZE"}', { status: 413 })
    const r = await gateway({ httpMethod: 'POST', headers: options.headers, body: options.body })
    return new Response(r.body, { status: r.statusCode })
  }) as typeof fetch)
  const image = await uploadNewsImage(draft, ARTICLE, (fn: any) => fn(api, TOKEN))
  assert.equal(image.size, bytes.length); assert.equal(draft.progress, 100)
  assert.equal(f.collections.newsImages.get(image.id).chunks.length, 32)
  assert.equal(f.objects.size, 33); assert.ok(Math.max(...sizes) < 100000)
})
test('legacy uploads migrate only when untouched, restart partial sessions and preserve completed images', async () => {
  const f = fixture(), bytes = PNG.sync.write({ width: 200, height: 200, data: randomBytes(160000) })
  const draft = await prepareNewsImage({ name: 'legacy.png', size: bytes.length, type: 'image/png', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
  const args = { articleId: ARTICLE, requestId: draft.requestId, name: draft.name, size: draft.size, mime: draft.mime, sha256: draft.sha256 }
  const s = await f.call('start', args), old = f.collections.newsImages.get(s.id)
  delete old.chunkSize; old.chunks = [null]
  const migrated = await f.call('start', args)
  assert.equal(migrated.chunkSize, CHUNK); assert.equal(f.collections.newsImages.get(s.id).chunks.length, 3)
  await f.call('chunk', { id: s.id, index: 0, data: bytes.subarray(0, CHUNK).toString('base64') })
  const partial = f.collections.newsImages.get(s.id); delete partial.chunkSize
  const before = structuredClone(partial)
  assert.equal((await f.call('start', args)).error.code, 'UPLOAD_RESTART_REQUIRED')
  assert.deepEqual(f.collections.newsImages.get(s.id), before)
  const gateway = createHttpHandler(f.images)
  const api = createAdminApi('https://api.example.test', (async (_url: any, options: any) => {
    const r = await gateway({ httpMethod: 'POST', headers: options.headers, body: options.body })
    return new Response(r.body, { status: r.statusCode })
  }) as typeof fetch)
  const image = await uploadNewsImage(draft, ARTICLE, (fn: any) => fn(api, TOKEN))
  assert.notEqual(image.id, s.id); assert.deepEqual(f.collections.newsImages.get(s.id), before)
  const ready = f.collections.newsImages.get(image.id); delete ready.chunkSize
  assert.equal((await uploadNewsImage(draft, ARTICLE, (fn: any) => fn(api, TOKEN))).id, image.id)
})
test('cloud gateway 413 JSON and HTML responses show a specific upload error', async () => {
  for (const body of ['{"code":"EXCEED_MAX_PAYLOAD_SIZE"}', '<html>Payload Too Large</html>']) {
    const api = createAdminApi('https://api.example.test', (async () => new Response(body, { status: 413 })) as typeof fetch)
    await assert.rejects(api.newsImageChunk(TOKEN, `ni_${'1'.repeat(32)}`, 0, ''), (error: any) => error.code === 'PAYLOAD_TOO_LARGE' && error.message.includes('云网关'))
  }
})
test('image selection rejects oversized PNG and JPEG dimensions before making upload requests', async () => {
  const check = (bytes: Buffer, name = 'wallpaper.png', type = 'image/png') => prepareNewsImage({ name, size: bytes.length, type, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
  for (const [width, height] of [[4201, 2379], [3000, 3000]]) {
    const bytes = png(); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20)
    await assert.rejects(check(bytes), (error: any) => error.code === 'INVALID_ARGUMENT' && error.message.includes(`${width}×${height}`))
  }
  const jpg = Buffer.from(jpeg.encode({ width: 3, height: 2, data: Buffer.alloc(24, 180) }, 80).data)
  assert.equal((await check(jpg, 'valid.jpg', 'image/jpeg')).mime, 'image/jpeg')
  const frame = jpg.indexOf(Buffer.from([0xff, 0xc0])); assert.ok(frame >= 0)
  jpg.writeUInt16BE(4201, frame + 7)
  await assert.rejects(check(jpg, 'wide.jpg', 'image/jpeg'), (error: any) => error.message.includes('4201×2'))
  await assert.rejects(check(png().subarray(0, 20)), (error: any) => error.message.includes('尺寸无法读取'))
})
