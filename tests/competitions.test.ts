import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { parseCompetition, parseCompetitionPage, competitionTime } from '../src/domain/competition'
const require = createRequire(import.meta.url)
const { createCompetitionService, registrationStatus, PUBLIC_ACTIONS, createApplicationRouter } = require('../cloudfunctions/adminAuth/competitions.js')
const { createHttpHandler } = require('../cloudfunctions/adminAuth/http.js')
const { createAdminService, createAccount, SESSION_MS } = require('../cloudfunctions/adminAuth/service.js')
const { createMemoryStore } = require('./helpers/admin-store.cjs')
const { createCompetitionMemoryStore } = require('./helpers/competition-store.cjs')
const form = { name: '上海社区足球赛', description: '社区赛事\n欢迎参加', format: 'group_knockout', formatDescription: '小组赛后进行淘汰赛', startDate: '2026-11-20', endDate: '2026-12-01', venue: '上海足球场', registrationRequirements: '填写完整球队资料', registrationStartAt: '2026-11-01T00:00:00.000Z', registrationEndAt: '2026-11-15T00:00:00.000Z' }
const TOKEN = 'a'.repeat(64)
const requestId = 'a'.repeat(32), id = 'c_' + requestId
function setup() {
  const memory = createCompetitionMemoryStore()
  const service = createCompetitionService({ store: memory.store, authorize: async (token: string) => token === TOKEN ? { ok: true } : { ok: false, error: { code: 'UNAUTHORIZED' } }, now: () => Date.parse('2026-11-05T00:00:00Z'), logger: { error() {} } })
  const call = (action: string, fields = {}) => service({ action: 'competitions.' + action, token: TOKEN, ...fields })
  const create = (fields = {}) => call('create', { requestId, form, ...fields })
  return { ...memory, service, call, create }
}
test('competition writes require real admin authorization, including expired and forged sessions', async () => {
  const clock = { value: Date.now() }
  const account = createMemoryStore(await createAccount('admin', 'a-valid-test-password', clock.value))
  const auth = createAdminService({ store: account.store, now: () => clock.value, logger: { error() {} } })
  const { store, records } = createCompetitionMemoryStore()
  const service = createCompetitionService({ store, authorize: (token: string) => auth({ action: 'session', token }) })
  const login = await auth({ action: 'login', username: 'admin', password: 'a-valid-test-password' })
  assert.equal(login.ok, true)
  for (const token of [undefined, 'f'.repeat(64)]) assert.equal((await service({ action: 'competitions.create', token, requestId, form })).error.code, 'UNAUTHORIZED')
  clock.value += SESSION_MS
  assert.equal((await service({ action: 'competitions.create', token: login.token, requestId, form })).error.code, 'UNAUTHORIZED')
  assert.equal(records.size, 0)
})
test('concurrent identical creates are idempotent and default hidden with registration off', async () => {
  const s = setup(); const replies = await Promise.all([s.create(), s.create()])
  assert.deepEqual(replies.map(r => r.created), [true, false]); assert.equal(s.records.size, 1)
  const c = replies[0].competition
  assert.equal(c.displayEnabled, false); assert.equal(c.registrationEnabled, false); assert.equal(c.version, 1)
  assert.equal((await s.create({ form: { ...form, name: '另一个名字' } })).error.code, 'CONFLICT')
})
test('hidden competition is absent from public list and direct access matches missing', async () => {
  const s = setup(); await s.create()
  assert.deepEqual((await s.call('listPublic')).competitions, [])
  assert.deepEqual(await s.call('getPublic', { id }), await s.call('getPublic', { id: 'c_' + 'b'.repeat(32) }))
  await s.call('visibility', { id, expectedVersion: 1, enabled: true })
  const reply = await s.call('getPublic', { id })
  assert.equal(reply.ok, true)
  for (const key of ['_id', 'version', 'createdAt', 'creationFingerprint', 'displayEnabled']) assert.equal(key in reply.competition, false)
  assert.equal(parseCompetition(reply.competition).name, form.name)
  await s.call('visibility', { id, expectedVersion: 2, enabled: false })
  assert.equal((await s.call('getPublic', { id })).error.code, 'NOT_FOUND')
})
test('visibility and registration are independent; opening registration requires a complete window', async () => {
  const s = setup(); await s.create({ form: { ...form, registrationStartAt: null, registrationEndAt: null } })
  assert.equal((await s.call('registration', { id, expectedVersion: 1, enabled: true })).error.code, 'INVALID_ARGUMENT')
  assert.equal(s.records.get(id).version, 1)
  await s.call('update', { id, expectedVersion: 1, form })
  const enabled = await s.call('registration', { id, expectedVersion: 2, enabled: true })
  assert.equal(enabled.competition.registrationStatus, 'open'); assert.equal(enabled.competition.displayEnabled, false)
  assert.equal((await s.call('getPublic', { id })).error.code, 'NOT_FOUND')
  await s.call('visibility', { id, expectedVersion: 3, enabled: true })
  assert.equal((await s.call('getPublic', { id })).competition.registrationStatus, 'open')
  assert.equal((await s.call('update', { id, expectedVersion: 4, form: { ...form, registrationStartAt: null, registrationEndAt: null } })).error.code, 'INVALID_ARGUMENT')
  const closed = await s.call('registration', { id, expectedVersion: 4, enabled: false })
  assert.equal(closed.competition.displayEnabled, true); assert.equal(closed.competition.registrationStatus, 'disabled')
})
test('registration is open at start and closed exactly at end, using server time', () => {
  const c = { ...form, registrationEnabled: true }
  const start = Date.parse(form.registrationStartAt), end = Date.parse(form.registrationEndAt)
  assert.equal(registrationStatus(c, start - 1), 'upcoming'); assert.equal(registrationStatus(c, start), 'open')
  assert.equal(registrationStatus(c, end - 1), 'open'); assert.equal(registrationStatus(c, end), 'closed')
  assert.equal(registrationStatus({ ...c, registrationEnabled: false }, start), 'disabled')
  assert.equal(competitionTime('2026-11-04T16:30:00.000Z'), '2026-11-05 00:30')
})
test('server rejects malformed, excessive and forged competition fields', async () => {
  const bad = [
    { name: ' ' }, { name: 'a'.repeat(81) }, { description: 'a'.repeat(1001) }, { venue: 'a'.repeat(121) }, { format: 'invalid' },
    { startDate: '2026-02-30' }, { endDate: '2026-11-19' }, { startDate: '2019-12-31' }, { registrationStartAt: null },
    { registrationEndAt: form.registrationStartAt }, { registrationEndAt: '2026-11-02T08:00:00+08:00' }, { name: 'test\u0001' },
    { displayEnabled: true }, { version: 99 }, { _openid: 'forged' }, { registrationEnabled: true }, { registrationStartAt: '2026-02-30T00:00:00.000Z' },
  ]
  for (const change of bad) { const s=setup(); assert.equal((await s.create({ form: { ...form, ...change } })).error.code, 'INVALID_ARGUMENT', JSON.stringify(change)); assert.equal(s.records.size, 0) }
  const s=setup(); assert.equal((await s.create({ userInfo: { isAdmin: true }, token: 'forged' })).error.code, 'UNAUTHORIZED')
  assert.equal((await s.create({ now: '2026-11-01' })).error.code, 'INVALID_ARGUMENT')
  assert.equal((await s.create({ requestId: '../bad' })).error.code, 'INVALID_ARGUMENT')
  assert.equal((await s.create({ userInfo: { openId: 'platform metadata' } })).ok, true)
})
test('concurrent edits use optimistic version checks and never overwrite the winner', async () => {
  const s = setup(); await s.create()
  const result = await Promise.all(['first', 'second'].map(name => s.call('update', { id, expectedVersion: 1, form: { ...form, name } })))
  assert.equal(result[0].ok, true); assert.equal(result[1].error.code, 'CONFLICT')
  assert.equal(s.records.get(id).name, 'first'); assert.equal(s.records.get(id).version, 2)
  assert.equal((await s.call('visibility', { id, expectedVersion: 1, enabled: true })).error.code, 'CONFLICT')
})
test('public pagination includes only published records without exposing admin fields', async () => {
  const s = setup()
  for (let i=1;i<=45;i++) {
    const req=i.toString(16).padStart(32,'0'); await s.create({ requestId: req })
    if (i % 2) await s.call('visibility', { id: 'c_' + req, expectedVersion: 1, enabled: true })
  }
  const first = await s.call('listPublic'), second = await s.call('listPublic', { cursor: first.nextCursor })
  assert.equal(first.competitions.length,20); assert.equal(second.competitions.length,3); assert.equal(second.nextCursor,null)
  assert.equal(new Set([...first.competitions,...second.competitions].map(c=>c.id)).size,23)
  assert.equal(parseCompetitionPage(first).competitions.length,20)
  assert.equal((await s.call('listAdmin')).competitions.length,20)
  assert.equal((await s.call('listPublic', { cursor: 'invalid' })).error.code,'INVALID_ARGUMENT')
})
test('storage errors roll back changes and fail closed for reads', async () => {
  const s=setup(); await s.create(); s.failures.write=true
  assert.equal((await s.call('visibility',{id,expectedVersion:1,enabled:true})).error.code,'SERVICE_UNAVAILABLE')
  assert.equal(s.records.get(id).displayEnabled,false); assert.equal(s.records.get(id).version,1)
  s.failures.list=true; assert.equal((await s.call('listPublic')).error.code,'SERVICE_UNAVAILABLE')
  s.store.list=async()=>[s.records.get(id)]
  assert.equal((await s.call('listPublic')).error.code,'SERVICE_UNAVAILABLE')
  s.failures.read=true; assert.equal((await s.call('getPublic',{id})).error.code,'SERVICE_UNAVAILABLE')
})
test('HTTP gateway explicitly allows public competition actions and protects all mutations', async () => {
  const s=setup(); const router=createApplicationRouter(async()=>({ok:false,error:{code:'UNAUTHORIZED'}}),s.service)
  const http=createHttpHandler(router,['https://admin.example.com'],PUBLIC_ACTIONS)
  const call=(data:object,authorization?:string)=>http({httpMethod:'POST',headers:{origin:'https://admin.example.com','content-type':'application/json',...(authorization?{authorization}: {})},body:JSON.stringify(data)})
  assert.equal((await call({action:'competitions.listPublic'})).statusCode,200)
  assert.equal((await call({action:'competitions.getPublic',id})).statusCode,404)
  assert.equal((await call({action:'competitions.create',requestId,form})).statusCode,401)
  assert.equal((await call({action:'competitions.create',requestId,form},'Bearer ' + TOKEN)).statusCode,200)
  assert.equal((await call({action:'competitions.create',requestId,form:{...form,name:'changed'}},'Bearer ' + TOKEN)).statusCode,409)
  assert.equal((await call({action:'competitions.listAdmin',token:TOKEN})).statusCode,400)
  const full={...form,description:'中'.repeat(1000),formatDescription:'中'.repeat(1000),registrationRequirements:'中'.repeat(1000)}
  assert.equal((await call({action:'competitions.create',requestId:'b'.repeat(32),form:full},'Bearer ' + TOKEN)).statusCode,200)
})
test('public parser projects safe fields and rejects malformed response pages', async () => {
  const s=setup(); const c=(await s.create()).competition
  assert.equal('creationFingerprint' in parseCompetition({...c,creationFingerprint:'private'}),false)
  assert.throws(()=>parseCompetition({...c,registrationStatus:'fake'}))
  assert.throws(()=>parseCompetitionPage({competitions:[c],nextCursor:'bad'}))
  assert.throws(()=>parseCompetitionPage({competitions:Array(21).fill(c),nextCursor:null}))
})
