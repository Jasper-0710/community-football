import assert from 'node:assert/strict'

// Only public reads and rejected requests are used. No administrator session is needed.
export async function verifyPublicFallbackGateway({ primaryEndpoint, fallbackEndpoint, origin = 'http://127.0.0.1:5173', fetchImpl = fetch, now = Date.now }) {
  const endpoints = [primaryEndpoint, fallbackEndpoint].map(endpoint => {
    const url = new URL(endpoint)
    assert.ok(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, '主备接口须使用不含凭据、参数或片段的HTTPS地址。')
    return url.href
  })
  assert.notEqual(endpoints[0], endpoints[1], '备用公开接口必须与主服务分开配置。')
  const requestOrigin = new URL(origin)
  assert.equal(requestOrigin.origin, origin, '来源必须是完整origin，不能包含路径。')
  assert.ok(requestOrigin.protocol === 'https:' || requestOrigin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(requestOrigin.hostname), '来源须为HTTPS或本机开发地址。')
  const checks = []
  async function request(endpoint, data, headers = {}, method = 'POST') {
    const response = await fetchImpl(endpoint, { method, headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, ...(method === 'POST' ? { body: JSON.stringify(data) } : {}), credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000) })
    const body = response.status === 204 ? null : await response.json()
    return { response, body }
  }
  function cors(response, { content = true } = {}) {
    assert.equal(response.headers.get('access-control-allow-origin'), origin, '接口没有允许本次H5来源。')
    assert.match(response.headers.get('vary') || '', /(?:^|,\s*)Origin(?:,|$)/i, '跨域响应须区分Origin。')
    if (content) assert.match(response.headers.get('cache-control') || '', /no-store/i, '公开接口不能被中间HTTP缓存。')
  }

  const query = { action: 'settings.getPublic' }
  const primary = await request(endpoints[0], query)
  assert.equal(primary.response.status, 200, '主服务公开设置读取失败。')
  cors(primary.response)
  assert.equal(primary.body?.ok, true, '主服务未返回成功的公开设置。')
  assert.ok(primary.body.settings && typeof primary.body.settings === 'object', '主服务公开设置缺失。')
  checks.push('primary-public-read')

  const preflight = await request(endpoints[1], null, { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }, 'OPTIONS')
  assert.equal(preflight.response.status, 204, '备用接口的H5预检失败。')
  // The gateway may answer an empty preflight itself. It contains no snapshot
  // payload, so only actual content responses require Cache-Control: no-store.
  cors(preflight.response, { content: false })
  assert.match(preflight.response.headers.get('access-control-allow-methods') || '', /\bPOST\b/i)
  assert.match(preflight.response.headers.get('access-control-allow-headers') || '', /\bContent-Type\b/i)
  checks.push('fallback-preflight')

  const fallback = await request(endpoints[1], query)
  assert.equal(fallback.response.status, 200, '备用接口没有可用的公开快照。')
  cors(fallback.response)
  const { recovery, ...result } = fallback.body || {}
  assert.equal(recovery?.source, 'fallback', '该地址未返回publicRead备用来源，请核对关联云函数。')
  const checkedAt = now()
  assert.ok(Number.isFinite(recovery.savedAt) && Number.isFinite(recovery.expiresAt) && recovery.savedAt <= checkedAt + 60_000 && recovery.expiresAt > checkedAt && recovery.expiresAt - recovery.savedAt === 120_000, '备用快照的时间无效或已过期。')
  assert.deepEqual(result, primary.body, '主备公开内容不一致，配置未保存；如刚修改设置，请重新验证。')
  checks.push('fallback-fresh-public-read-matches-primary')

  const denied = await request(endpoints[1], query, { Origin: 'https://d13-origin-denied.invalid' })
  assert.equal(denied.response.status, 403, '备用接口没有拒绝未授权来源。')
  assert.equal(denied.body?.error?.code, 'ORIGIN_DENIED')
  assert.equal(denied.response.headers.get('access-control-allow-origin'), null)
  checks.push('unlisted-origin-rejected')

  // These read-only private actions must remain unavailable even with a bearer-shaped value.
  for (const action of ['backup.capabilities', 'session']) {
    const anonymous = await request(endpoints[1], { action })
    assert.equal(anonymous.response.status, 401, '备用接口允许了匿名非公开操作。')
    assert.equal(anonymous.body?.error?.code, 'UNAUTHORIZED')
    cors(anonymous.response)
    const privateResult = await request(endpoints[1], { action }, { Authorization: `Bearer ${'0'.repeat(64)}` })
    assert.equal(privateResult.response.status, 400, '备用接口没有拒绝非公开操作。')
    assert.equal(privateResult.body?.error?.code, 'INVALID_ARGUMENT')
    cors(privateResult.response)
  }
  checks.push('private-actions-rejected-anonymous-and-bearer')

  const login = await request(endpoints[1], { action: 'login' })
  assert.equal(login.response.status, 400, '备用接口不能提供后台登录。')
  assert.equal(login.body?.error?.code, 'INVALID_ARGUMENT')
  cors(login.response)
  checks.push('login-not-supported')

  const get = await request(endpoints[1], null, {}, 'GET')
  assert.equal(get.response.status, 405)
  assert.equal(get.body?.error?.code, 'METHOD_NOT_ALLOWED')
  cors(get.response)
  checks.push('get-rejected')

  return { checkedAt: new Date(checkedAt).toISOString(), origin, checks, snapshotSavedAt: new Date(recovery.savedAt).toISOString(), snapshotExpiresAt: new Date(recovery.expiresAt).toISOString(), businessWrites: 0, administratorLogin: false }
}
