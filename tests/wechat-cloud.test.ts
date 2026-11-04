import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

// Run the actual WeChat branch with an isolated SDK and timer queue. No network,
// live identity, global timer replacement, or twenty-second sleeps are involved.
const source = fs.readFileSync(new URL('../src/services/wechat-cloud.ts', import.meta.url), 'utf8')
const compiled = transformSync(source, {
  loader: 'ts', format: 'cjs', target: 'es2020',
  define: { 'import.meta.env.VITE_WECHAT_CLOUD_ENV_ID': '"test-environment"' },
}).code

function fixture(callFunction: (request: any) => any, init: () => void = () => {}) {
  const timers = new Map<number, () => void>()
  const requests: unknown[] = []
  let nextTimer = 0
  let initCalls = 0
  const module = { exports: {} as any }
  vm.runInNewContext(compiled, {
    module, exports: module.exports, console,
    wx: { cloud: {
      init: () => { initCalls++; init() },
      callFunction: (request: any) => { requests.push(request); return callFunction(request) },
    } },
    setTimeout: (callback: () => void, milliseconds: number) => {
      assert.equal(milliseconds, 20_000)
      const id = ++nextTimer
      timers.set(id, callback)
      return id
    },
    clearTimeout: (id: number) => { timers.delete(id) },
  }, { filename: 'wechat-cloud.test-module.cjs' })
  return {
    call: module.exports.callWechatCloudFunction as (name: string, data: Record<string, unknown>) => Promise<any>,
    timers, requests, initCalls: () => initCalls,
    timeout: () => {
      for (const [id, callback] of timers) { timers.delete(id); callback() }
    },
  }
}

function hasCode(expected: string) {
  return (error: any) => error?.name === 'WechatCloudError' && error.code === expected
}

// Drain promise continuations, including finally(), without exercising a real timeout.
const drain = () => new Promise<void>(resolve => setImmediate(resolve))

test('successful cloud invocation forwards only name/data and initializes once', async () => {
  const f = fixture(async () => ({ result: { ok: true } }))
  const data = { action: 'getOrCreate' }
  assert.deepEqual(await f.call('userProfile', data), { ok: true })
  assert.deepEqual(await f.call('healthCheck', {}), { ok: true })
  assert.equal(f.initCalls(), 1)
  assert.deepEqual(JSON.parse(JSON.stringify(f.requests)), [{ name: 'userProfile', data }, { name: 'healthCheck', data: {} }])
  await drain()
  assert.equal(f.timers.size, 0)
})

test('null, undefined and missing-result SDK responses fail immediately and release their timers', async () => {
  for (const response of [null, undefined, {}, { result: null }, { result: undefined }, false]) {
    const f = fixture(async () => response)
    await assert.rejects(f.call('userProfile', {}), hasCode('INVALID_RESPONSE'))
    await drain()
    assert.equal(f.timers.size, 0)
  }
})

test('synchronous SDK throws and rejected calls become recoverable failures without leaking SDK text', async () => {
  for (const implementation of [
    () => { throw new Error('private SDK context') },
    () => Promise.reject(new Error('private SDK context')),
  ]) {
    const f = fixture(implementation)
    await assert.rejects(f.call('userProfile', {}), (error: any) => hasCode('CALL_FAILED')(error) && !error.message.includes('private'))
    await drain()
    assert.equal(f.timers.size, 0)
  }
})

test('exceptions while processing a fulfilled SDK response reject the caller instead of leaving it pending', async () => {
  const response = Object.defineProperty({}, 'result', { get() { throw new Error('broken result accessor') } })
  const f = fixture(async () => response)
  await assert.rejects(f.call('userProfile', {}), hasCode('CALL_FAILED'))
  await drain()
  assert.equal(f.timers.size, 0)
})

test('controlled timeout rejects a hanging request and a late success cannot turn it into a success', async () => {
  let complete!: (result: unknown) => void
  const f = fixture(() => new Promise(resolve => { complete = resolve }))
  const request = f.call('userProfile', { action: 'update' })
  const rejection = assert.rejects(request, hasCode('TIMEOUT'))
  await drain()
  assert.equal(f.requests.length, 1)
  f.timeout()
  await rejection
  complete({ result: { ok: true } })
  await drain()
  await assert.rejects(request, hasCode('TIMEOUT'))
  assert.equal(f.timers.size, 0)
})

test('a late SDK rejection after timeout is handled and cannot cause an unhandled promise rejection', async () => {
  let fail!: (reason: unknown) => void
  const f = fixture(() => new Promise((_resolve, reject) => { fail = reject }))
  const request = f.call('userProfile', {})
  const rejection = assert.rejects(request, hasCode('TIMEOUT'))
  await drain()
  f.timeout()
  await rejection
  fail(new Error('network failed after deadline'))
  await drain()
  assert.equal(f.timers.size, 0)
})

test('cloud initialization failure never starts a request or leaves a pending timer', async () => {
  const f = fixture(async () => ({ result: {} }), () => { throw new Error('init failed') })
  await assert.rejects(f.call('userProfile', {}), hasCode('INIT_FAILED'))
  assert.equal(f.requests.length, 0)
  assert.equal(f.timers.size, 0)
})
