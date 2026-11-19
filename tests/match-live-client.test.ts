import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { buildSync } from 'esbuild'
import { createLiveFeedState } from '../src/composables/match-live-state'
import { ContentClientError } from '../src/domain/content'
import type { LiveEntry, LivePage } from '../src/domain/match-live'
const MID = 'm_' + '1'.repeat(32), OTHER = 'm_' + '2'.repeat(32)
const entry = (n: number, matchId = MID): LiveEntry => ({ id: 'l_' + n.toString(16).padStart(32, '0'), matchId, text: String(n), images: [], minute: null, createdAt: '2026-11-18T08:00:00Z', updatedAt: '2026-11-18T08:00:00Z', corrected: false })
test('feed refresh replaces edited/deleted content and pagination deduplicates overlapping records', async () => {
  const pages: LivePage[] = [{ entries: [entry(3), entry(2)], nextCursor: 'cursor' }, { entries: [entry(2), entry(1)], nextCursor: null }, { entries: [{ ...entry(3), text: '更正' }], nextCursor: null }]
  const s = createLiveFeedState(async () => pages.shift()!); s.reset(MID)
  await s.load(); await s.load(true); assert.deepEqual(s.entries.value.map(e => e.id), [entry(3).id, entry(2).id, entry(1).id]); assert.equal(s.historyMode.value, true)
  await s.load(); assert.equal(s.entries.value.length, 1); assert.equal(s.entries.value[0].text, '更正'); assert.equal(s.historyMode.value, false)
})
test('network failure keeps confirmed content and cursor, then a successful retry clears the notice', async () => {
  let failure = false
  const s = createLiveFeedState(async () => { if (failure) throw new Error('网络中断'); return { entries: [entry(1)], nextCursor: 'cursor' } }); s.reset(MID)
  await s.load(); failure = true; await s.load(); assert.equal(s.entries.value.length, 1); assert.equal(s.nextCursor.value, 'cursor'); assert.equal(s.error.value, '网络中断'); assert.equal(s.ready.value, true)
  failure = false; await s.load(); assert.equal(s.error.value, '')
})
test('hidden/deleted match clears stale feed rather than retaining private content', async () => {
  let hidden = false
  const s = createLiveFeedState(async () => { if (hidden) throw new ContentClientError('NOT_FOUND', '比赛暂未公开'); return { entries: [entry(1)], nextCursor: null } }); s.reset(MID)
  await s.load(); hidden = true; await s.load(); assert.deepEqual(s.entries.value, []); assert.equal(s.unavailable.value, true); assert.equal(s.ready.value, false)
})
test('changing match discards stale asynchronous success and failure, without clearing new loading state', async () => {
  let resolve!: (v: LivePage) => void, reject!: (e: Error) => void
  const s = createLiveFeedState(id => new Promise((yes, no) => { if (id === MID) { resolve = yes; reject = no } else yes({ entries: [entry(2, OTHER)], nextCursor: null }) }))
  s.reset(MID); const old = s.load(); s.reset(OTHER); await s.load(); resolve({ entries: [entry(1)], nextCursor: null }); await old
  assert.equal(s.entries.value[0].matchId, OTHER)
  s.reset(MID); const failed = s.load(); s.reset(OTHER); await s.load(); reject(new Error('旧请求失败')); await failed; assert.equal(s.error.value, ''); assert.equal(s.entries.value[0].matchId, OTHER)
})
test('duplicate refreshes share the loading guard and dispose prevents late writes', async () => {
  let calls = 0, finish!: (v: LivePage) => void
  const s = createLiveFeedState(() => { calls++; return new Promise(resolve => { finish = resolve }) }); s.reset(MID)
  const pending = s.load(); await s.load(); assert.equal(calls, 1); assert.equal(s.loading.value, true)
  s.reset(''); finish({ entries: [entry(1)], nextCursor: null }); await pending; assert.deepEqual(s.entries.value, []); assert.equal(s.loading.value, false)
})
test('native live image responses accept signed HTTPS URLs without a browser URL global', () => {
  const compiled = buildSync({ entryPoints: ['src/domain/match-live.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text
  const module = { exports: {} as typeof import('../src/domain/match-live') }
  vm.runInNewContext(compiled, { module, exports: module.exports })
  const url = 'https://bucket.example.test/match-live/files/photo.png?sign=abc%2F123&expires=1795150000'
  const page = { ok: true, entries: [{ ...entry(1), images: [{ url, caption: '赛场图片' }] }], nextCursor: null }
  assert.equal(module.exports.parseLivePage(page, false, MID).entries[0].images[0].url, url)
  const image = { id: 'li_' + '3'.repeat(32), entryId: entry(1).id, name: 'photo.png', size: 1024, mime: 'image/png', width: 160, height: 100, url }
  assert.equal(module.exports.parseLiveUploadedImage(image).url, url)
  for (const unsafe of ['http://example.test/a', 'https://user:secret@example.test/a', 'https://example.test/a#fragment', 'https://example.test:99999/a', 'https://example.test\\@other.test/a', 'https://-host.test/a']) {
    assert.throws(() => module.exports.parseLivePage({ ...page, entries: [{ ...page.entries[0], images: [{ url: unsafe, caption: '' }] }] }, false, MID))
    assert.throws(() => module.exports.parseLiveUploadedImage({ ...image, url: unsafe }))
  }
})
