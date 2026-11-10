import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createAdminService, createAccount, digest, SESSION_MS, LOCK_MS } = require('../cloudfunctions/adminAuth/service.js')
const { createHttpHandler } = require('../cloudfunctions/adminAuth/http.js')
const { createMemoryStore } = require('./helpers/admin-store.cjs')
const password = 'Test-only-Password-42'
const clockStart = Date.UTC(2026, 10, 4)
let initial: any
before(async () => { initial = await createAccount('admin', password, clockStart) })
function fixture(account = initial) {
  const memory = createMemoryStore(account)
  let clock = clockStart
  const logs: string[] = []
  const handle = createAdminService({ store: memory.store, now: () => clock, logger: { error: (v: string) => logs.push(v) } })
  return { ...memory, handle, advance: (ms: number) => { clock += ms }, logs, login: () => handle({ action: 'login', username: 'admin', password }) }
}

test('admin bootstrap validates credentials and generates a salted hash only', async () => {
  assert.equal(initial.password.algorithm, 'pbkdf2-sha256')
  assert.equal(initial.password.iterations, 600_000)
  assert.ok(!JSON.stringify(initial).includes(password))
  const second = await createAccount('Admin', password, clockStart)
  assert.equal(second.username, 'admin')
  assert.notEqual(initial.password.salt, second.password.salt)
  assert.notEqual(initial.password.hash, second.password.hash)
  await assert.rejects(createAccount('admin', 'short'))
  await assert.rejects(createAccount('../admin', password))
})
test('admin password policy accepts eight characters and rejects shorter new passwords', async () => {
  await assert.rejects(createAccount('admin', 'x'.repeat(7)), { code: 'INVALID_ARGUMENT', message: '管理员密码须为8–128个字符。' })
  const minimumPassword = 'x'.repeat(8)
  const account = await createAccount('admin', minimumPassword, clockStart)
  const f = fixture(account)
  const result = await f.handle({ action: 'login', username: 'admin', password: minimumPassword })
  assert.equal(result.ok, true)
  assert.equal((await f.handle({ action: 'session', token: result.token })).ok, true)
  assert.ok(!JSON.stringify(account).includes(minimumPassword))
})
test('login yields an opaque token and protected overview; only its digest is stored', async () => {
  const f = fixture(), result = await f.login()
  assert.equal(result.ok, true)
  assert.match(result.token, /^[a-f0-9]{64}$/)
  assert.equal(f.value().sessions[0].digest, digest(result.token))
  assert.ok(!JSON.stringify(f.value()).includes(result.token))
  assert.ok(!JSON.stringify(result).includes(initial.password.hash))
  assert.deepEqual((await f.handle({ action: 'overview', token: result.token })).availableModules, ['account'])
  assert.equal(result.expiresAt, new Date(clockStart + SESSION_MS).toISOString())
  assert.equal((await f.handle({ action: 'login', username: ' ADMIN ', password })).ok, true)
})
test('wrong account and wrong password return the same credential error', async () => {
  const f = fixture()
  const a = await f.handle({ action: 'login', username: 'other', password })
  const b = await f.handle({ action: 'login', username: 'admin', password: 'bad' })
  assert.deepEqual(a, b)
  assert.equal(a.error.code, 'INVALID_CREDENTIALS')
  assert.equal(f.value().sessions.length, 0)
})
test('missing, forged and expired sessions never authorize protected requests', async () => {
  const f = fixture()
  for (const token of [undefined, '', 'admin', 'a'.repeat(64)]) {
    assert.equal((await f.handle({ action: 'overview', token })).error.code, 'UNAUTHORIZED')
  }
  const login = await f.login()
  f.advance(SESSION_MS - 1)
  assert.equal((await f.handle({ action: 'session', token: login.token })).ok, true)
  f.advance(1)
  assert.equal((await f.handle({ action: 'session', token: login.token })).error.code, 'UNAUTHORIZED')
})
test('logout revokes the token on the server and leaves other sessions usable', async () => {
  const f = fixture(), a = await f.login(), b = await f.login()
  assert.equal((await f.handle({ action: 'logout', token: a.token })).ok, true)
  assert.equal((await f.handle({ action: 'overview', token: a.token })).error.code, 'UNAUTHORIZED')
  assert.equal((await f.handle({ action: 'overview', token: b.token })).ok, true)
  assert.equal((await f.handle({ action: 'logout', token: a.token })).ok, true)
})
test('five concurrent bad passwords commit the failure counter and lock further logins', async () => {
  const f = fixture()
  await Promise.all(Array.from({ length: 5 }, () => f.handle({ action: 'login', username: 'admin', password: 'wrong' })))
  assert.equal(f.value().failedAttempts, 5)
  assert.equal((await f.login()).error.code, 'RATE_LIMITED')
  assert.equal(f.value().sessions.length, 0)
  f.advance(LOCK_MS)
  assert.equal((await f.login()).ok, true)
  assert.equal(f.value().failedAttempts, 0)
})
test('rate-limit slots cannot be bypassed by concurrent requests or random usernames', async () => {
  const account = structuredClone(initial)
  account.attemptWindowAt = clockStart; account.attemptCount = 19
  const f = fixture(account)
  const responses = await Promise.all(Array.from({ length: 4 }, (_, i) => f.handle({ action: 'login', username: `unknown${i}`, password: 'wrong' })))
  assert.equal(responses.filter(r => r.error.code === 'RATE_LIMITED').length, 3)
  assert.equal(f.value().attemptCount, 20)
  assert.equal(f.value().failedAttempts, 0)
  f.advance(60_000)
  assert.equal((await f.login()).ok, true)
})
test('sessions are bounded and a sixth login invalidates the oldest one', async () => {
  const f = fixture(), sessions = []
  for (let i = 0; i < 6; i++) { sessions.push(await f.login()); f.advance(1) }
  assert.equal(f.value().sessions.length, 5)
  assert.equal((await f.handle({ action: 'session', token: sessions[0].token })).error.code, 'UNAUTHORIZED')
  assert.equal((await f.handle({ action: 'session', token: sessions[5].token })).ok, true)
})
test('disabled accounts and reset credentials invalidate existing sessions', async () => {
  const f = fixture(), login = await f.login()
  const account = f.value(); account.status = 'disabled'; f.replace(account)
  assert.equal((await f.handle({ action: 'session', token: login.token })).error.code, 'UNAUTHORIZED')
  assert.equal((await f.login()).error.code, 'UNAUTHORIZED')
  f.replace(initial)
  assert.equal((await f.handle({ action: 'session', token: login.token })).error.code, 'UNAUTHORIZED')
})
test('credential replacement during password verification cannot issue a session', async () => {
  const memory = createMemoryStore(initial)
  let transactions = 0
  const store = { ...memory.store, async transaction(callback: any) {
    const result = await memory.store.transaction(callback)
    if (++transactions === 1) { const changed = memory.value(); changed.credentialVersion = 'b'.repeat(32); memory.replace(changed) }
    return result
  } }
  const handle = createAdminService({ store, now: () => clockStart })
  assert.equal((await handle({ action: 'login', username: 'admin', password })).error.code, 'UNAUTHORIZED')
  assert.equal(memory.value().sessions.length, 0)
})
test('WeChat metadata and client-supplied roles never grant admin access', async () => {
  const f = fixture()
  const metadata = { userInfo: { role: 'admin', openId: 'admin' }, tcbContext: { role: 'admin' } }
  assert.equal((await f.handle({ action: 'overview', token: 'a'.repeat(64), ...metadata })).error.code, 'UNAUTHORIZED')
  assert.equal((await f.handle({ action: 'login', username: 'admin', password, role: 'admin' })).error.code, 'INVALID_ARGUMENT')
  assert.equal((await f.handle({ action: 'login', username: 'admin', password, ...metadata })).ok, true)
})
test('input bounds and unknown operations are rejected before writing credentials', async () => {
  const f = fixture()
  for (const event of [null, [], { action: 'bootstrap' }, { action: 'login', username: 'admin', password: 'x'.repeat(129) }, { action: 'login', username: '$ne', password }, { action: 'login', username: 'admin', password, env: 'other' }]) {
    assert.equal((await f.handle(event)).error.code, 'INVALID_ARGUMENT')
  }
  assert.deepEqual(f.value(), initial)
})
test('missing account, storage corruption and read/write failure fail closed', async () => {
  const empty = fixture(null)
  assert.equal((await empty.login()).error.code, 'NOT_CONFIGURED')
  const bad = structuredClone(initial); bad.password.iterations = 1
  assert.equal((await fixture(bad).login()).error.code, 'SERVICE_UNAVAILABLE')
  const f = fixture(); f.failures.write = true
  assert.equal((await f.login()).error.code, 'SERVICE_UNAVAILABLE')
  assert.equal(f.value().sessions.length, 0)
  f.failures.write = false
  const login = await f.login()
  f.failures.read = true
  assert.equal((await f.handle({ action: 'overview', token: login.token })).error.code, 'SERVICE_UNAVAILABLE')
  assert.deepEqual(f.logs, ['[adminAuth] operation failed', '[adminAuth] operation failed'])
})
test('failed logout does not report success or silently revoke a different session', async () => {
  const f = fixture(), login = await f.login()
  f.failures.write = true
  assert.equal((await f.handle({ action: 'logout', token: login.token })).error.code, 'SERVICE_UNAVAILABLE')
  f.failures.write = false
  assert.equal((await f.handle({ action: 'session', token: login.token })).ok, true)
})
test('HTTP interface enforces origins, method, body limits and bearer authentication', async () => {
  const f = fixture(), http = createHttpHandler(f.handle, ['http://127.0.0.1:5174'])
  const event = (body: any, extra: any = {}) => ({ httpMethod: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5174' }, body: JSON.stringify(body), ...extra })
  assert.equal((await http(event({}, { headers: { Origin: 'https://untrusted.example' } }))).statusCode, 403)
  assert.equal((await http(event({}, { httpMethod: 'GET' }))).statusCode, 405)
  assert.equal((await http(event({}, { headers: {} }))).statusCode, 415)
  assert.equal((await http(event({}, { body: 'x'.repeat(9000) }))).statusCode, 400)
  assert.equal((await http(event({ action: 'session' }))).statusCode, 401)
  assert.equal((await http(event({ action: 'session', token: 'a'.repeat(64) }))).statusCode, 400)
  const login = await http(event({ action: 'login', username: 'admin', password }))
  assert.equal(login.statusCode, 200)
  assert.equal(login.headers['Cache-Control'], 'no-store')
  assert.equal(login.headers['Access-Control-Allow-Origin'], 'http://127.0.0.1:5174')
  const { token } = JSON.parse(login.body)
  const session = await http(event({ action: 'session' }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }))
  assert.equal(session.statusCode, 200)
  const preflight = await http(event(null, { httpMethod: 'OPTIONS' }))
  assert.equal(preflight.statusCode, 204)
  assert.ok(!preflight.headers['Access-Control-Allow-Credentials'])
})
test('HTTP supports base64 payloads and rejects duplicate headers or non-object JSON', async () => {
  const f = fixture(), http = createHttpHandler(f.handle)
  const event = { httpMethod: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ action: 'login', username: 'admin', password })).toString('base64'), isBase64Encoded: true }
  assert.equal((await http(event)).statusCode, 200)
  assert.equal((await http({ ...event, headers: { 'Content-Type': 'application/json', 'content-type': 'text/plain' } })).statusCode, 400)
  assert.equal((await http({ ...event, body: '[]', isBase64Encoded: false })).statusCode, 400)
})
