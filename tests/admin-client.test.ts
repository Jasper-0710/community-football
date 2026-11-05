import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdminApi, AdminApiError } from '../admin/src/api'
import { createAdminAuth, STORAGE_KEY } from '../admin/src/auth'
const token = 'a'.repeat(64)
const session = { admin: { username: 'admin', displayName: '赛事管理员', role: 'admin' as const }, expiresAt: '2026-11-05T00:00:00Z' }
const overview = { ...session, availableModules: ['account'], serverTime: '2026-11-04T00:00:00Z' }
function storage() {
  const rows = new Map<string, string>()
  return { rows, getItem: (key: string) => rows.get(key) || null, setItem: (key: string, value: string) => { rows.set(key, value) }, removeItem: (key: string) => { rows.delete(key) } }
}
function api(overrides = {}) { return { login: async () => ({ ...session, token }), overview: async () => overview, session: async () => session, logout: async () => {}, ...overrides } }
test('admin API rejects unconfigured, insecure, credential-bearing, or query-string endpoints', async () => {
  for (const url of ['', 'http://example.com/admin', 'https://user:pass@example.com', 'https://example.com?token=secret', 'https://example.com/#hash']) {
    const client = createAdminApi(url, async () => { throw new Error('must not fetch') })
    await assert.rejects(client.login('admin', 'password'), (e: any) => e.code === 'NOT_CONFIGURED')
  }
})
test('admin API sends tokens in headers, omits cookies and requires valid server responses', async () => {
  const calls: any[] = []
  const client = createAdminApi('https://example.test/admin', async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ ok: true, ...overview })) })
  await client.overview(token)
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${token}`)
  assert.equal(calls[0].init.credentials, 'omit')
  assert.ok(!calls[0].init.body.includes(token))
  assert.equal(calls[0].init.redirect, 'error')
  const bad = createAdminApi('https://example.test/admin', async () => new Response(JSON.stringify({ ok: true, token, admin: { role: 'user' } })))
  await assert.rejects(bad.login('admin', 'password'), (e: any) => e.code === 'INVALID_RESPONSE')
})
test('network failure and timeout never return a successful session', async () => {
  const broken = createAdminApi('https://example.test/admin', async () => { throw new Error('network') })
  await assert.rejects(broken.session(token), (e: any) => e.code === 'NETWORK_ERROR')
  const timed = createAdminApi('https://example.test/admin', async (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))) }), 5)
  await assert.rejects(timed.session(token), (e: any) => e.code === 'TIMEOUT')
})
test('login stores only a token and must authorize the workbench separately', async () => {
  const s = storage(), auth = createAdminAuth(api(), s)
  await auth.initialize(); assert.equal(auth.status.value, 'guest')
  await auth.login('admin', 'password')
  assert.equal(auth.status.value, 'authenticated')
  assert.deepEqual([...s.rows], [[STORAGE_KEY, token]])
  const denied = createAdminAuth(api({ overview: async () => { throw new AdminApiError('UNAUTHORIZED', 'expired') } }), storage())
  await denied.initialize(); await denied.login('admin', 'password')
  assert.equal(denied.status.value, 'guest'); assert.equal(denied.account.value, null)
})
test('stored tokens are revalidated; expired tokens and forged cache are cleared', async () => {
  const s = storage(); s.setItem(STORAGE_KEY, token)
  const auth = createAdminAuth(api(), s)
  assert.equal(auth.account.value, null)
  await auth.initialize(); assert.equal(auth.status.value, 'authenticated')
  const expired = createAdminAuth(api({ overview: async () => { throw new AdminApiError('UNAUTHORIZED', 'expired') } }), s)
  await expired.initialize(); assert.equal(expired.status.value, 'guest'); assert.equal(s.getItem(STORAGE_KEY), null)
  s.setItem(STORAGE_KEY, '{"role":"admin"}')
  await createAdminAuth(api({ overview: async () => { throw new Error('must not call') } }), s).initialize()
  assert.equal(s.getItem(STORAGE_KEY), null)
})
test('unavailable server hides account data and preserves a token for explicit retry', async () => {
  const s = storage(); s.setItem(STORAGE_KEY, token)
  let failed = true
  const auth = createAdminAuth(api({ overview: async () => { if (failed) throw new AdminApiError('NETWORK_ERROR', 'offline'); return overview } }), s)
  await auth.initialize(); assert.equal(auth.status.value, 'unavailable'); assert.equal(auth.account.value, null)
  assert.equal(s.getItem(STORAGE_KEY), token)
  failed = false; await auth.check(); assert.equal(auth.status.value, 'authenticated')
})
test('failed logout is visible and does not pretend the server has revoked the session', async () => {
  const s = storage(); let failed = true
  const auth = createAdminAuth(api({ logout: async () => { if (failed) throw new Error('offline') } }), s)
  await auth.initialize(); await auth.login('admin', 'password'); await auth.logout()
  assert.equal(auth.status.value, 'authenticated'); assert.equal(s.getItem(STORAGE_KEY), token)
  assert.match(auth.message.value, /退出尚未完成/)
  failed = false; await auth.logout()
  assert.equal(auth.status.value, 'guest'); assert.equal(auth.account.value, null); assert.equal(s.getItem(STORAGE_KEY), null)
})
test('disposal prevents late login responses from restoring the UI or persistent token', async () => {
  let done!: (value: any) => void
  const s = storage(), auth = createAdminAuth(api({ login: () => new Promise(resolve => { done = resolve }) }), s)
  await auth.initialize()
  const pending = auth.login('admin', 'password'); auth.dispose(); done({ ...session, token }); await pending
  assert.equal(auth.account.value, null); assert.equal(s.getItem(STORAGE_KEY), null)
})
test('business operations clear an expired session and reject replies after logout', async () => {
  const s = storage(), auth = createAdminAuth(api(), s)
  await auth.initialize(); await auth.login('admin', 'password')
  await assert.rejects(auth.authorized(async () => { throw new AdminApiError('UNAUTHORIZED', 'expired') }))
  assert.equal(auth.status.value, 'guest'); assert.equal(s.getItem(STORAGE_KEY), null)
  await auth.login('admin', 'password')
  let finish!: (value: string) => void
  const pending = auth.authorized(async () => new Promise<string>(resolve => { finish = resolve }))
  await auth.logout(); finish('late data')
  await assert.rejects(pending, (e: any) => e.code === 'UNAUTHORIZED')
})
test('routine session checks do not invalidate a concurrent authorized business request', async () => {
  const auth = createAdminAuth(api(), storage())
  await auth.initialize(); await auth.login('admin', 'password')
  let finish!: (value: string) => void
  const pending = auth.authorized(async () => new Promise<string>(resolve => { finish = resolve }))
  await auth.check(); finish('saved')
  assert.equal(await pending, 'saved'); assert.equal(auth.status.value, 'authenticated')
})
