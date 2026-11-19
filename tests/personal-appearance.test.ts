import test from 'node:test'
import assert from 'node:assert/strict'
import { computed, effectScope, ref, watch } from 'vue'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import { AppearanceError, appearanceStorageKey, defaultPersonalAppearance, parsePersonalAppearance, resolveAppearance } from '../src/domain/personal-appearance'
import { defaultPlatformForm, themeTokens } from '../src/domain/platform-settings'
import { createPersonalAppearanceState } from '../src/composables/personal-appearance-state'

const alice = 'a'.repeat(64), bob = 'b'.repeat(64)
const chosen = () => ({ theme: 'ocean', customColor: '#176390', mode: 'dark', radius: 'round' } as const)
function fixture(environment = 'customer', endpoint = 'https://example.test/api', storage = new Map<string, unknown>()) {
  const state = createPersonalAppearanceState({ environment, endpoint, read: key => storage.get(key), write: (key, value) => storage.set(key, structuredClone(value)) })
  state.selectAccount(null)
  return { state, storage, key: (owner: string) => appearanceStorageKey(environment, endpoint, owner) }
}

test('appearance follows all current platform values by default without mutating platform navigation', () => {
  const platform = defaultPlatformForm(), personal = defaultPersonalAppearance()
  const resolved = resolveAppearance(platform, personal)
  assert.deepEqual(resolved, platform)
  resolved.navigation[0].label = '变化'
  assert.equal(platform.navigation[0].label, '首页')
  const next = { ...platform, title: '新平台名称', theme: 'rose', mode: 'dark' as const, radius: 'square' as const }
  assert.deepEqual(resolveAppearance(next, personal), next)
})

test('personal choices override only chosen appearance fields while platform identity and navigation remain live', () => {
  const platform = { ...defaultPlatformForm(), theme: 'rose', mode: 'light' as const, radius: 'square' as const }
  const personal = { ...chosen(), mode: 'platform' as const }
  const resolved = resolveAppearance(platform, personal)
  assert.equal(resolved.theme, 'ocean'); assert.equal(resolved.mode, 'light'); assert.equal(resolved.radius, 'round')
  const updated = { ...platform, title: '新标题', subtitle: '新说明', mode: 'dark' as const, navigation: [...platform.navigation].reverse() }
  const next = resolveAppearance(updated, personal)
  assert.equal(next.title, '新标题'); assert.equal(next.subtitle, '新说明'); assert.deepEqual(next.navigation, updated.navigation)
  assert.equal(next.theme, 'ocean'); assert.equal(next.mode, 'dark'); assert.equal(next.radius, 'round')
  assert.deepEqual(resolveAppearance(updated, defaultPersonalAppearance()), updated)
})

test('stored appearance rejects unsafe colors, unsupported values and attempts to override platform identity', () => {
  const defaults = defaultPersonalAppearance()
  for (const value of [null, [], {}, { ...defaults, theme: 'unknown' }, { ...defaults, theme: 'custom', customColor: '#fff' }, { ...defaults, customColor: '#123456;background:red' }, { ...defaults, mode: 'auto' }, { ...defaults, radius: '99px' }, { ...defaults, title: '伪造标题' }, { ...defaults, navigation: [] }]) {
    assert.throws(() => parsePersonalAppearance(value), error => error instanceof AppearanceError && error.code === 'INVALID_APPEARANCE')
  }
  const parsed = parsePersonalAppearance({ ...chosen(), customColor: '#AABBCC' })
  assert.equal(parsed.customColor, '#aabbcc')
})

test('draft changes never affect active appearance, and a successful write survives a fresh runtime', () => {
  const f = fixture(), draft = chosen()
  assert.deepEqual(f.state.form.value, defaultPersonalAppearance()); assert.equal(f.storage.size, 0)
  f.state.save(draft, f.state.scopeVersion.value)
  assert.deepEqual(f.state.form.value, draft)
  const restarted = fixture('customer', 'https://example.test/api', f.storage)
  assert.deepEqual(restarted.state.form.value, draft)
})

test('guest and two confirmed accounts retain independent choices through logout, relogin and empty accounts', () => {
  const { state } = fixture()
  const guest = { ...chosen(), theme: 'plum' }, accountB = { ...chosen(), theme: 'amber', mode: 'light' as const }
  state.save(guest, state.scopeVersion.value)
  state.selectAccount(alice); assert.deepEqual(state.form.value, defaultPersonalAppearance())
  state.save(chosen(), state.scopeVersion.value)
  state.selectAccount(bob); assert.deepEqual(state.form.value, defaultPersonalAppearance())
  state.save(accountB, state.scopeVersion.value)
  state.selectAccount(null); assert.deepEqual(state.form.value, guest)
  state.selectAccount(alice); assert.deepEqual(state.form.value, chosen())
  state.selectAccount(bob); assert.deepEqual(state.form.value, accountB)
})

test('a draft from a previous login scope cannot be written after switching even back to the same account', () => {
  const { state, storage } = fixture(); state.selectAccount(alice)
  const oldScope = state.scopeVersion.value
  state.selectAccount(bob)
  assert.throws(() => state.save(chosen(), oldScope), error => error instanceof AppearanceError && error.code === 'IDENTITY_CHANGED')
  state.selectAccount(alice)
  assert.throws(() => state.save(chosen(), oldScope), error => error instanceof AppearanceError && error.code === 'IDENTITY_CHANGED')
  assert.equal(storage.size, 0)
  const current = state.scopeVersion.value
  state.selectAccount(alice); assert.equal(state.scopeVersion.value, current, 'ordinary profile updates do not reset an editor')
})

test('environment and endpoint boundaries cannot import preferences from another deployment', () => {
  const f = fixture(); f.state.selectAccount(alice); f.state.save(chosen(), f.state.scopeVersion.value)
  for (const [environment, endpoint] of [['other', 'https://example.test/api'], ['customer', 'https://other.test/api']]) {
    const other = fixture(environment, endpoint, f.storage); other.state.selectAccount(alice)
    assert.deepEqual(other.state.form.value, defaultPersonalAppearance())
  }
  assert.notEqual(appearanceStorageKey('a:b', 'c', alice), appearanceStorageKey('a', 'b:c', alice))
})

test('corrupt, foreign-owner and unreadable storage fall back without carrying the former account theme', () => {
  for (const corrupt of [{ version: 2, owner: alice, form: chosen() }, { version: 1, owner: bob, form: chosen() }, { version: 1, owner: alice, form: { ...chosen(), customColor: 'url(x)' } }, 'invalid']) {
    const f = fixture(); f.state.save(chosen(), f.state.scopeVersion.value); f.storage.set(f.key(alice), corrupt)
    f.state.selectAccount(alice)
    assert.deepEqual(f.state.form.value, defaultPersonalAppearance()); assert.ok(f.state.readError.value)
    f.state.save(chosen(), f.state.scopeVersion.value); assert.equal(f.state.readError.value, '')
  }
  const denied = createPersonalAppearanceState({ environment: 'env', endpoint: '', read() { throw new Error('denied') }, write() {} })
  denied.selectAccount(alice); assert.deepEqual(denied.form.value, defaultPersonalAppearance()); assert.ok(denied.readError.value)
  assert.throws(() => denied.selectAccount('forged'), error => error instanceof AppearanceError && error.code === 'INVALID_IDENTITY')
})

test('save failures leave the current theme and saved record unchanged and allow a retry', () => {
  let denied = false
  const storage = new Map<string, unknown>()
  const state = createPersonalAppearanceState({ environment: 'env', endpoint: '', read: key => storage.get(key), write(key, value) { if (denied) throw new Error('quota'); storage.set(key, structuredClone(value)) } })
  state.selectAccount(alice); state.save(chosen(), state.scopeVersion.value)
  const before = structuredClone([...storage.entries()])
  denied = true
  assert.throws(() => state.save(defaultPersonalAppearance(), state.scopeVersion.value), error => error instanceof AppearanceError && error.code === 'STORAGE_UNAVAILABLE')
  assert.deepEqual(state.form.value, chosen()); assert.deepEqual([...storage.entries()], before)
  denied = false; state.save(defaultPersonalAppearance(), state.scopeVersion.value)
  assert.deepEqual(state.form.value, defaultPersonalAppearance())
})

test('the app identity watcher outlives the first mounted page and ignores platform refreshes for personal fields', () => {
  const identity = ref<string | null>(null), platform = ref({ version: 0, updatedAt: null, form: defaultPlatformForm() })
  const storage = new Map<string, unknown>(), module = { exports: {} as any }
  const code = transformSync(readFileSync(new URL('../src/composables/usePersonalAppearance.ts', import.meta.url), 'utf8').replaceAll('import.meta.env.', 'runtimeEnv.'), { loader: 'ts', format: 'cjs', target: 'es2020' }).code
  vm.runInNewContext(code, {
    module, exports: module.exports, runtimeEnv: {}, uni: { getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, structuredClone(value)) },
    require(name: string) {
      if (name === 'vue') return { computed, effectScope, watch }
      if (name === './useUserProfile') return { currentUserId: identity }
      if (name === './personal-appearance-state') return { createPersonalAppearanceState }
      if (name === './usePlatformSettings') return { usePlatformSettings: () => ({ settings: platform }) }
      if (name === '@/domain/personal-appearance') return { resolveAppearance }
      if (name === '@/domain/platform-settings') return { themeTokens }
      throw new Error(`Unexpected import ${name}`)
    },
  })
  const pageScope = effectScope()
  let state: ReturnType<typeof module.exports.usePersonalAppearance>
  pageScope.run(() => { state = module.exports.usePersonalAppearance() })
  state!.save(chosen(), state!.scopeVersion.value)
  pageScope.stop()
  identity.value = alice
  assert.deepEqual(state!.form.value, defaultPersonalAppearance())
  state!.save({ ...chosen(), mode: 'platform' }, state!.scopeVersion.value)
  platform.value.form.mode = 'dark'; assert.equal(state!.effective.value.mode, 'dark')
  platform.value.form.theme = 'rose'; assert.equal(state!.effective.value.theme, 'ocean')
  identity.value = null; assert.deepEqual(state!.form.value, chosen())
})
