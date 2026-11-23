import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { verifyPublicFallbackGateway } from '../scripts/public-fallback-gateway.mjs'

const require = createRequire(import.meta.url)
const { createHttpHandler } = require('../cloudfunctions/publicRead/http.js')
const { createPublicReadService, PUBLIC_ACTIONS } = require('../cloudfunctions/publicRead/service.js')
const primaryEndpoint = 'https://primary.example.test/api', fallbackEndpoint = 'https://fallback.example.test/api'
const origin = 'http://127.0.0.1:5173', timestamp = 1_800_000_000_000
const settings = { version: 1, updatedAt: '2026-11-22T00:00:00.000Z', form: { title: '隔离测试平台' } }

function fixture(change: (saved: any) => void = () => {}, mutateResponse?: (response: any, url: string, options: any) => void) {
  const calls: { url: string; method: string; action?: string }[] = []
  const saved = { schemaVersion: 1, environment: 'isolated', query: { action: 'settings.getPublic' }, savedAt: timestamp, expiresAt: timestamp + 120_000, result: { ok: true, settings } }
  change(saved)
  const fallback = createPublicReadService({ environment: 'isolated', now: () => timestamp, storage: { async download() { return Buffer.from(JSON.stringify(saved)) } }, logger: { error() {} } })
  const primaryHttp = createHttpHandler(async () => ({ ok: true, settings }), [origin], PUBLIC_ACTIONS)
  const fallbackHttp = createHttpHandler(fallback, [origin], PUBLIC_ACTIONS)
  const fetchImpl = async (url: string, options: any) => {
    assert.ok([primaryEndpoint, fallbackEndpoint].includes(url), 'No request may reach a live service')
    calls.push({ url, method: options.method, action: options.body ? JSON.parse(options.body).action : undefined })
    const handler = url === primaryEndpoint ? primaryHttp : fallbackHttp
    const response = await handler({ httpMethod: options.method, headers: options.headers, body: options.body })
    mutateResponse?.(response, url, options)
    return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode, headers: response.headers })
  }
  return { calls, run: () => verifyPublicFallbackGateway({ primaryEndpoint, fallbackEndpoint, origin, fetchImpl, now: () => timestamp }) }
}

test('注册前验证真实HTTP处理器的公开快照、预检、非公开拒绝及来源限制', async () => {
  const { run, calls } = fixture()
  const result = await run()
  assert.equal(result.checks.length, 7)
  assert.equal(result.businessWrites, 0)
  assert.equal(result.administratorLogin, false)
  assert.deepEqual([...new Set(calls.map(call => call.action).filter(Boolean))], ['settings.getPublic', 'backup.capabilities', 'session', 'login'])
})

test('错误绑定主业务函数时不能通过备用来源检查', async () => {
  const { run } = fixture(() => {}, (response, url, options) => {
    if (url === fallbackEndpoint && options.method === 'POST' && JSON.parse(options.body).action === 'settings.getPublic') response.body = JSON.stringify({ ok: true, settings })
  })
  await assert.rejects(run(), /未返回publicRead备用来源/)
})

test('过期快照和主备内容不一致均不能登记', async () => {
  await assert.rejects(fixture(saved => { saved.savedAt -= 120_000; saved.expiresAt -= 120_000 }).run(), /没有可用的公开快照/)
  await assert.rejects(fixture(saved => { saved.result.settings = { ...settings, version: 2 } }).run(), /主备公开内容不一致/)
})

test('缺少H5跨域许可时拒绝登记', async () => {
  const { run } = fixture(() => {}, (response, url, options) => {
    if (url === fallbackEndpoint && options.method === 'OPTIONS') delete response.headers['Access-Control-Allow-Origin']
  })
  await assert.rejects(run(), /没有允许本次H5来源/)
})

test('网关无正文预检可不含缓存头，实际公开响应仍须禁止缓存', async () => {
  const gatewayPreflight = fixture(() => {}, (response, url, options) => {
    if (url === fallbackEndpoint && options.method === 'OPTIONS') {
      delete response.headers['Cache-Control']
      response.headers['Access-Control-Allow-Methods'] = 'POST'
    }
  })
  assert.equal((await gatewayPreflight.run()).checks.length, 7)

  const cacheableContent = fixture(() => {}, (response, url, options) => {
    if (url === fallbackEndpoint && options.method === 'POST') delete response.headers['Cache-Control']
  })
  await assert.rejects(cacheableContent.run(), /不能被中间HTTP缓存/)
})

test('备用入口放行未授权来源或非公开动作时拒绝登记', async () => {
  const deniedOrigin = fixture(() => {}, (response, url, options) => {
    if (options.headers.Origin === 'https://d13-origin-denied.invalid') { response.statusCode = 200; response.body = '{"ok":true}' }
  })
  await assert.rejects(deniedOrigin.run(), /没有拒绝未授权来源/)
  const privateAction = fixture(() => {}, (response, url, options) => {
    if (options.headers.Authorization) { response.statusCode = 200; response.body = '{"ok":true}' }
  })
  await assert.rejects(privateAction.run(), /没有拒绝非公开操作/)
})
