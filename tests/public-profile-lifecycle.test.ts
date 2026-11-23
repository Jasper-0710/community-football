import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import * as vue from 'vue'

const script = readFileSync(new URL('../src/pages/player/detail.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
const source = transformSync(script + '\nglobalThis.state={profile,busy,error,selected,load,choose}', { loader: 'ts', format: 'cjs', target: 'es2020' }).code
const settle = () => new Promise<void>(resolve => setImmediate(resolve))
function fixture(read: (...args: any[]) => Promise<any>) {
  const hooks: Record<string, any> = {}, scope = vue.effectScope()
  const context: any = { Error, Promise, uni: {}, require(name: string) {
    if (name === 'vue') return { ...vue, onUnmounted: (fn: () => void) => { hooks.unmount = fn } }
    if (name === '@dcloudio/uni-app') return { onLoad: (fn: Function) => { hooks.load = fn }, onShow: (fn: Function) => { hooks.show = fn } }
    if (name === '@/services/public-data') return { useRecoveryRefresh: (fn: Function) => { hooks.recover = fn } }
    if (name === '@/services/directory') return { getPlayerProfile: read }
    if (name === '@/domain/team' || name.endsWith('.vue')) return {}
    throw new Error(name)
  } }
  scope.run(() => vm.runInNewContext(source, context))
  return { hooks, state: context.state, dispose() { hooks.unmount(); scope.stop() } }
}
const profile = (name = '球员档案') => ({ player: { id: 'player', name }, record: { matches: [], summary: {}, nextCursor: null } })
test('public player waits for route initialization, including recovery and onShow arriving before onLoad', async () => {
  for (const order of ['show-first', 'load-first']) {
    const calls: any[] = [], f = fixture(async (...args) => { calls.push(args); return profile() })
    await f.hooks.recover(); assert.equal(calls.length, 0)
    if (order === 'show-first') f.hooks.show()
    f.hooks.load({ id: 'player', teamId: 'team' })
    if (order === 'load-first') f.hooks.show()
    await settle(); assert.deepEqual(calls, [['player', 'team', undefined, undefined]])
    assert.equal(f.state.profile.value.player.name, '球员档案')
    f.hooks.show(); await settle(); assert.equal(calls.length, 2)
    f.dispose()
  }
})
test('public player invalid links make no public request, and disposed reads cannot repaint a page', async () => {
  let calls = 0, resolve!: (value: any) => void
  const f = fixture(() => { calls++; return new Promise(yes => { resolve = yes }) })
  f.hooks.load({ id: 'player' }); await settle(); assert.equal(calls, 0); assert.match(f.state.error.value, /链接不完整/)
  f.hooks.load({ id: 'player', teamId: 'team' }); assert.equal(calls, 1)
  f.dispose(); resolve(profile()); await settle(); assert.equal(f.state.profile.value, null)
})
test('public player scope changes discard delayed old reads and old failures cannot clear the fresh profile', async () => {
  let rejectOld!: (error: Error) => void, calls = 0
  const f = fixture(() => ++calls === 1 ? new Promise((_resolve, reject) => { rejectOld = reject }) : Promise.resolve(profile('最新档案')))
  f.hooks.load({ id: 'player', teamId: 'team' }); f.state.choose('competition-new')
  await settle(); rejectOld(new Error('旧请求失败')); await settle()
  assert.equal(f.state.profile.value.player.name, '最新档案'); assert.equal(f.state.error.value, ''); assert.equal(f.state.busy.value, false)
  f.dispose()
})
