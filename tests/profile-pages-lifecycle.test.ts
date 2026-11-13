import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import * as vue from 'vue'
import * as teamDomain from '../src/domain/team'
import * as registrationDomain from '../src/domain/registration'

type PageKind = 'team' | 'registration' | 'mine'
const user = { id: 'current-wechat-user', nickname: '当前用户' }
const team = { id: 'team-current', version: 1, name: '当前球队', district: '浦东新区', description: '', contactPhone: '13000000000', players: [] }
const preparation = {
  team, registration: null, uploadsEnabled: true, serverTime: '2026-11-13T08:00:00Z',
  competition: { id: 'c-current', registrationEndAt: '2026-12-01T08:00:00Z', rulesVersion: 1,
    registrationConfig: { projects: ['足球'], minPlayers: 2, maxPlayers: 18, teamLimit: 10 }, registrationStats: { occupied: 0 } },
}
const readName = { team: 'getMyTeam', registration: 'prepareRegistration', mine: 'listMyRegistrations' }
const readResult = { team, registration: preparation, mine: { registrations: [{ id: 'r-current' }], nextCursor: 'next-current' } }
function deferred<T = any>() {
  let resolve!: (value: T) => void, reject!: (failure: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve))

function page(t: TestContext, kind: PageKind, services: Record<string, any> = {}) {
  const file = kind === 'team' ? 'team/manage' : kind === 'registration' ? 'registration/manage' : 'registration/mine'
  const component = fs.readFileSync(new URL(`../src/pages/${file}.vue`, import.meta.url), 'utf8')
  const script = component.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
  const exposed = kind === 'team'
    ? 'team,ready,loading,saving,error,notice,editingTeam,editingPlayer,form,player,confirmName,load,startTeam,saveTeam'
    : kind === 'registration'
      ? 'record,preparation,ready,loading,busy,confirming,submitting,editing,error,notice,drafts,form,load,choose,submit,cancel'
      : 'records,cursor,ready,loading,error,load'
  const profile = vue.ref<any>({ ...user }), scope = vue.effectScope()
  const hooks = { show: [] as (() => void)[], unload: [] as (() => void)[] }
  const service = { [readName[kind]]: async () => structuredClone(readResult[kind]), ...services }
  const context: any = {
    Error, Promise,
    uni: { showToast: () => {}, pageScrollTo: () => {}, showModal: (args: any) => args.success({ confirm: true }) },
    require(name: string) {
      if (name === 'vue') return vue
      if (name === '@dcloudio/uni-app') return {
        onShow: (fn: () => void) => hooks.show.push(fn), onUnload: (fn: () => void) => hooks.unload.push(fn),
        onLoad: (fn: (query: any) => void) => fn({ competitionId: 'c-current' }),
      }
      if (name === '@/composables/useUserProfile') return { useUserProfile: () => ({ profile, loading: vue.ref(false), error: vue.ref(''), supported: true, login: async () => {} }) }
      if (name === '@/domain/team') return teamDomain
      if (name === '@/domain/registration') return registrationDomain
      if (name === '@/domain/competition') return { competitionTime: () => '' }
      if (name === '@/services/teams' || name === '@/services/registrations') return service
      if (name.endsWith('.vue')) return {}
      throw new Error(`Unexpected import ${name}`)
    },
  }
  scope.run(() => vm.runInNewContext(transformSync(script + `\nglobalThis.__page = {${exposed}}`, { loader: 'ts', format: 'cjs', target: 'es2020' }).code, context))
  t.after(() => { hooks.unload.forEach(fn => fn()); scope.stop() })
  return { state: context.__page as any, profile, show: () => hooks.show.forEach(fn => fn()), unload: () => hooks.unload.forEach(fn => fn()), uni: context.uni }
}

for (const kind of ['team', 'registration', 'mine'] as const) {
  test(`${kind}: an already authenticated page loads onShow and same-account nickname saves preserve its state`, async t => {
    let reads = 0
    const runtime = page(t, kind, { [readName[kind]]: async () => { ++reads; return structuredClone(readResult[kind]) } })
    runtime.show()
    await settle()
    assert.equal(reads, 1)
    assert.equal(runtime.state.ready.value, true)
    if (kind === 'team') { runtime.state.startTeam(); runtime.state.form.name = '未保存球队草稿' }
    if (kind === 'registration') runtime.state.form.leaderName = '未保存领队草稿'
    runtime.profile.value = { ...user, nickname: '新昵称' }
    await settle()
    assert.equal(reads, 1, 'saving the same account must not reload a business page')
    if (kind === 'team') {
      assert.equal(runtime.state.form.name, '未保存球队草稿')
      assert.equal(runtime.state.editingTeam.value, true)
    }
    if (kind === 'registration') {
      assert.equal(runtime.state.form.leaderName, '未保存领队草稿')
      assert.equal(runtime.state.editing.value, true)
    }
    if (kind === 'mine') assert.equal(runtime.state.cursor.value, 'next-current')
    else {
      runtime.show()
      await settle()
      assert.equal(reads, 1, 'returning to an open editor must preserve the unsaved draft')
    }
  })

  test(`${kind}: logout clears private state and a stale failure cannot stop the new account's loading`, async t => {
    const oldRead = deferred(), freshRead = deferred()
    let reads = 0
    const runtime = page(t, kind, { [readName[kind]]: () => ++reads === 1 ? oldRead.promise : freshRead.promise })
    runtime.show()
    assert.equal(runtime.state.loading.value, true)
    runtime.profile.value = null
    assert.equal(runtime.state.loading.value, false)
    assert.equal(runtime.state.ready.value, false)
    assert.equal(runtime.state.error.value, '')
    if (kind === 'mine') { assert.equal(runtime.state.records.value.length, 0); assert.equal(runtime.state.cursor.value, null) }
    if (kind === 'team') { assert.equal(runtime.state.team.value, null); assert.equal(runtime.state.form.name, ''); assert.equal(runtime.state.saving.value, false) }
    if (kind === 'registration') { assert.equal(runtime.state.record.value, null); assert.equal(runtime.state.drafts.value.length, 0); assert.equal(runtime.state.busy.value, false) }
    runtime.profile.value = { id: 'another-wechat-user', nickname: '另一用户' }
    assert.equal(reads, 2)
    assert.equal(runtime.state.loading.value, true)
    oldRead.reject(new Error('旧账号网络错误'))
    await settle()
    assert.equal(runtime.state.error.value, '')
    assert.equal(runtime.state.loading.value, true)
    freshRead.resolve(structuredClone(readResult[kind]))
    await settle()
    assert.equal(runtime.state.ready.value, true)
    assert.equal(runtime.state.loading.value, false)
  })

  test(`${kind}: leaving the page discards a pending successful read`, async t => {
    const read = deferred()
    const runtime = page(t, kind, { [readName[kind]]: () => read.promise })
    runtime.show()
    runtime.unload()
    read.resolve(structuredClone(readResult[kind]))
    await settle()
    assert.equal(runtime.state.ready.value, false)
    assert.equal(runtime.state.loading.value, false)
    if (kind === 'mine') assert.equal(runtime.state.records.value.length, 0)
    if (kind === 'team') assert.equal(runtime.state.team.value, null)
    if (kind === 'registration') assert.equal(runtime.state.preparation.value, null)
  })
}

test('team: an old account save cannot replace the new team or clear a newer save indicator', async t => {
  const oldSave = deferred(), freshSave = deferred()
  let writes = 0
  const runtime = page(t, 'team', { updateMyTeam: () => ++writes === 1 ? oldSave.promise : freshSave.promise })
  runtime.show(); await settle()
  runtime.state.startTeam()
  const older = runtime.state.saveTeam()
  assert.equal(runtime.state.saving.value, true)
  runtime.profile.value = null
  runtime.profile.value = { id: 'another-wechat-user', nickname: '另一用户' }
  await settle()
  runtime.state.startTeam()
  const newer = runtime.state.saveTeam()
  oldSave.resolve({ ...team, name: '旧账号返回的球队' })
  await older
  assert.equal(runtime.state.team.value.name, team.name)
  assert.equal(runtime.state.saving.value, true)
  freshSave.resolve({ ...team, name: '新账号保存结果' })
  await newer
  assert.equal(runtime.state.team.value.name, '新账号保存结果')
  assert.equal(runtime.state.saving.value, false)
})

test('registration: logout during file selection clears drafts and ignores a stale picker response', async t => {
  const picker = deferred()
  let uploads = 0
  const runtime = page(t, 'registration', { chooseRegistrationFiles: () => picker.promise, uploadRegistrationFile: async () => { ++uploads } })
  runtime.show(); await settle()
  runtime.state.form.leaderName = '私有领队姓名'
  const selected = runtime.state.choose()
  assert.equal(runtime.state.busy.value, true)
  runtime.profile.value = null
  assert.equal(runtime.state.busy.value, false)
  assert.equal(runtime.state.form.leaderName, '')
  picker.resolve([{ id: 'old-file', name: '旧账号附件.xlsx' }])
  await selected
  assert.equal(runtime.state.drafts.value.length, 0)
  assert.equal(uploads, 0)
  assert.equal(runtime.state.error.value, '')
})
