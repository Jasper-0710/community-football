'use strict'

function createHttpHandler(service, allowedOrigins = []) {
  const origins = new Set(allowedOrigins.filter(value => {
    try { const u = new URL(value); return u.origin === value && (u.protocol === 'https:' || u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) } catch { return false }
  }))
  return async event => {
    const requestHeaders = Object.create(null)
    for (const [key, value] of Object.entries(event.headers || {})) {
      const lower = key.toLowerCase()
      if (typeof value !== 'string' || requestHeaders[lower] !== undefined) return { statusCode: 400, headers: { 'Cache-Control': 'no-store' }, body: '{"ok":false}' }
      requestHeaders[lower] = value
    }
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' }
    const response = (statusCode, body) => ({ statusCode, headers, body: body ? JSON.stringify(body) : '' })
    const error = (status, code, message) => response(status, { ok: false, error: { code, message } })
    const origin = requestHeaders.origin
    if (origin && !origins.has(origin)) return error(403, 'ORIGIN_DENIED', '当前访问地址尚未开通，请联系平台管理员。')
    if (origin) headers['Access-Control-Allow-Origin'] = origin
    if (event.httpMethod === 'OPTIONS') {
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
      headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
      headers['Access-Control-Max-Age'] = '600'
      return response(204)
    }
    if (event.httpMethod !== 'POST') return error(405, 'METHOD_NOT_ALLOWED', '请求方式不支持。')
    if (!/^application\/json(?:\s*;|$)/i.test(requestHeaders['content-type'] || '')) return error(415, 'INVALID_ARGUMENT', '请求格式不正确。')
    let input
    try {
      if (typeof event.body !== 'string' || Buffer.byteLength(event.body) > 8192) throw new Error()
      const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
      if (Buffer.byteLength(raw) > 4096) throw new Error()
      input = JSON.parse(raw)
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.hasOwn(input, 'token')) throw new Error()
    } catch { return error(400, 'INVALID_ARGUMENT', '请求格式不正确。') }
    if (input.action !== 'login') {
      const authorization = /^Bearer ([a-f0-9]{64})$/.exec(requestHeaders.authorization || '')
      if (!authorization) return error(401, 'UNAUTHORIZED', '请先登录管理后台。')
      input.token = authorization[1]
    }
    const result = await service(input)
    const status = result.ok ? 200 : ({ INVALID_ARGUMENT: 400, INVALID_CREDENTIALS: 401, UNAUTHORIZED: 401, RATE_LIMITED: 429, NOT_CONFIGURED: 503, SERVICE_UNAVAILABLE: 503 }[result.error.code] || 500)
    return response(status, result)
  }
}

module.exports = { createHttpHandler }
