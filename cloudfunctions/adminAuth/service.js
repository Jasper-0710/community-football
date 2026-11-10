'use strict'

const { randomBytes, pbkdf2, timingSafeEqual, createHash } = require('node:crypto')
const { promisify } = require('node:util')
const derive = promisify(pbkdf2)
const ITERATIONS = 600_000
const SESSION_MS = 8 * 60 * 60 * 1000
const LOCK_MS = 15 * 60 * 1000
const MAX_FAILURES = 5
const MAX_SESSIONS = 5
const MAX_ATTEMPTS_PER_MINUTE = 20
const tokenPattern = /^[a-f0-9]{64}$/

class AuthError extends Error {
  constructor(code, message) { super(message); this.code = code }
}
function fail(code, message) { throw new AuthError(code, message) }
function isObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v) }
function digest(token) { return createHash('sha256').update(token).digest('hex') }
function normalizeUsername(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z][a-zA-Z0-9._-]{2,31}$/.test(value.trim())) {
    fail('INVALID_ARGUMENT', '账号须为3–32位字母、数字、点、短横线或下划线，并以字母开头。')
  }
  return value.trim().toLowerCase()
}
function checkPassword(password, creating = false) {
  if (typeof password !== 'string' || Array.from(password).length < (creating ? 8 : 1)
    || Array.from(password).length > 128 || Buffer.byteLength(password, 'utf8') > 512) {
    fail('INVALID_ARGUMENT', creating ? '管理员密码须为8–128个字符。' : '请输入有效的账号和密码。')
  }
}
async function passwordRecord(password) {
  checkPassword(password, true)
  const salt = randomBytes(32).toString('hex')
  const hash = (await derive(password, Buffer.from(salt, 'hex'), ITERATIONS, 32, 'sha256')).toString('hex')
  return { algorithm: 'pbkdf2-sha256', iterations: ITERATIONS, salt, hash }
}
async function verifyPassword(password, record) {
  const hash = await derive(password, Buffer.from(record.salt, 'hex'), ITERATIONS, 32, 'sha256')
  return timingSafeEqual(hash, Buffer.from(record.hash, 'hex'))
}
async function createAccount(username, password, now = Date.now()) {
  return {
    schemaVersion: 1, username: normalizeUsername(username), displayName: '赛事管理员',
    password: await passwordRecord(password), credentialVersion: randomBytes(16).toString('hex'),
    status: 'active', sessions: [], failedAttempts: 0, failureWindowAt: 0, lockedUntil: 0,
    attemptWindowAt: 0, attemptCount: 0, createdAt: now, updatedAt: now,
  }
}
function assertAccount(account) {
  if (!account) fail('NOT_CONFIGURED', '管理员账号尚未开通，请联系平台负责人。')
  const p = account.password
  if (account.schemaVersion !== 1 || typeof account.username !== 'string'
    || typeof account.displayName !== 'string' || !/^[a-f0-9]{32}$/.test(account.credentialVersion)
    || !isObject(p) || p.algorithm !== 'pbkdf2-sha256' || p.iterations !== ITERATIONS
    || !tokenPattern.test(p.salt) || !tokenPattern.test(p.hash) || !Array.isArray(account.sessions)
    || account.sessions.length > MAX_SESSIONS || account.sessions.some(s => !isObject(s)
      || !tokenPattern.test(s.digest) || !Number.isSafeInteger(s.createdAt) || !Number.isSafeInteger(s.expiresAt))
    || ['failedAttempts', 'failureWindowAt', 'lockedUntil', 'attemptWindowAt', 'attemptCount'].some(k => !Number.isSafeInteger(account[k]) || account[k] < 0)
    || !['active', 'disabled'].includes(account.status)) {
    fail('SERVICE_UNAVAILABLE', '管理服务暂不可用，请稍后重试。')
  }
  if (account.status !== 'active') fail('UNAUTHORIZED', '账号不可用或登录已失效，请重新登录。')
}
function publicSession(account, session) {
  return { admin: { username: account.username, displayName: account.displayName, role: 'admin' }, expiresAt: new Date(session.expiresAt).toISOString() }
}
function parseEvent(event) {
  if (!isObject(event)) fail('INVALID_ARGUMENT', '请求格式不正确。')
  const { action } = event
  const allowed = action === 'login' ? ['action', 'username', 'password'] : ['action', 'token']
  // Platform metadata never confers administrator privileges.
  if (Object.keys(event).some(k => !allowed.includes(k) && !['userInfo', 'tcbContext'].includes(k))) fail('INVALID_ARGUMENT', '请求包含不支持的字段。')
  if (!['login', 'session', 'logout', 'overview'].includes(action)) fail('INVALID_ARGUMENT', '不支持的操作。')
  if (action === 'login') {
    checkPassword(event.password)
    return { action, username: normalizeUsername(event.username), password: event.password }
  }
  if (typeof event.token !== 'string' || !tokenPattern.test(event.token)) fail('UNAUTHORIZED', '登录已失效，请重新登录。')
  return { action, token: event.token }
}

/** store.read()/store.transaction(fn) always address the private primary account. */
function createAdminService({ store, now = Date.now, token = () => randomBytes(32).toString('hex'), logger = console }) {
  return async function handle(event) {
    try {
      const input = parseEvent(event)
      if (input.action === 'login') {
        // Reserve a rate-limit slot atomically before expensive password hashing.
        const observed = await store.transaction(async (account, save) => {
          assertAccount(account)
          const time = now()
          if (account.lockedUntil > time) fail('RATE_LIMITED', '密码错误次数较多，请15分钟后重试。')
          if (time >= account.attemptWindowAt + 60_000) { account.attemptWindowAt = time; account.attemptCount = 0 }
          if (account.attemptCount >= MAX_ATTEMPTS_PER_MINUTE) fail('RATE_LIMITED', '登录请求过于频繁，请稍后重试。')
          account.attemptCount++
          await save(account)
          return account
        })
        const matches = await verifyPassword(input.password, observed.password)
        const rawToken = token()
        if (!tokenPattern.test(rawToken)) throw new Error('Invalid token generator')
        // Return failed outcomes so failure counters commit; throwing would roll them back.
        return await store.transaction(async (account, save) => {
          assertAccount(account)
          const time = now()
          if (account.credentialVersion !== observed.credentialVersion) fail('UNAUTHORIZED', '账号信息已变更，请重新登录。')
          if (account.lockedUntil > time) fail('RATE_LIMITED', '密码错误次数较多，请15分钟后重试。')
          if (!matches || input.username !== account.username) {
            if (input.username === account.username) {
              if (time >= account.failureWindowAt + LOCK_MS) { account.failureWindowAt = time; account.failedAttempts = 0 }
              account.failedAttempts++
              if (account.failedAttempts >= MAX_FAILURES) account.lockedUntil = time + LOCK_MS
              account.updatedAt = time
              await save(account)
            }
            return { ok: false, error: { code: 'INVALID_CREDENTIALS', message: '账号或密码不正确。' } }
          }
          account.failedAttempts = 0; account.failureWindowAt = time; account.lockedUntil = 0
          const session = { digest: digest(rawToken), createdAt: time, expiresAt: time + SESSION_MS }
          account.sessions = account.sessions.filter(s => s.expiresAt > time).slice(-(MAX_SESSIONS - 1))
          account.sessions.push(session); account.updatedAt = time
          await save(account)
          return { ok: true, token: rawToken, ...publicSession(account, session) }
        })
      }
      const tokenDigest = digest(input.token)
      if (input.action === 'logout') {
        await store.transaction(async (account, save) => {
          if (!account) return
          // Logout is idempotent, including already expired or disabled accounts.
          if (!Array.isArray(account.sessions)) throw new Error('Invalid session storage')
          if (!account.sessions.some(s => s.digest === tokenDigest)) return
          account.sessions = account.sessions.filter(s => s.digest !== tokenDigest)
          await save(account)
        })
        return { ok: true }
      }
      const account = await store.read()
      assertAccount(account)
      const session = account.sessions.find(s => s.digest === tokenDigest && s.expiresAt > now())
      if (!session) fail('UNAUTHORIZED', '登录已失效，请重新登录。')
      if (input.action === 'overview') {
        return { ok: true, ...publicSession(account, session), availableModules: ['account'], serverTime: new Date(now()).toISOString() }
      }
      return { ok: true, ...publicSession(account, session) }
    } catch (error) {
      if (error instanceof AuthError) return { ok: false, error: { code: error.code, message: error.message } }
      // Credentials, tokens, account data, and underlying SDK errors never enter logs.
      logger?.error?.('[adminAuth] operation failed')
      return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '管理服务暂不可用，请稍后重试。' } }
    }
  }
}

module.exports = { createAdminService, createAccount, normalizeUsername, digest, SESSION_MS, LOCK_MS, MAX_FAILURES, MAX_SESSIONS }
