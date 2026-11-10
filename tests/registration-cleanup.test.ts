import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
const require = createRequire(import.meta.url)
const { createRegistrationMemory } = require('./helpers/registration-store.cjs')
const { createRegistrationFileService } = require('../cloudfunctions/teamManagement/registration-files')
const { createRegistrationService } = require('../cloudfunctions/teamManagement/registrations')
const { createRegistrationCleanupService, OBJECT_LIMIT } = require('../cloudfunctions/adminAuth/registration-cleanup')
const { createStorageAdapter, UPLOAD_LEASE } = require('../cloudfunctions/teamManagement/registration-storage')
const { APP_ID, userId } = require('../cloudfunctions/teamManagement/service')
const cid = 'c_' + 'c'.repeat(32), uid = userId(APP_ID, 'owner'), tid = 't_' + uid
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF')
const requestId = 'a'.repeat(32)
function fixture() {
  const m = createRegistrationMemory(), clock = { value: Date.parse('2026-11-10T00:00:00Z') }, now = () => clock.value
  const files = new Map<string, Buffer>(), storage = {
    path: (id: string) => id,
    async prepare(path: string) { return path },
    async upload(path: string, bytes: Buffer) { files.set(path, Buffer.from(bytes)); return path },
    async download(id: string) { if (!files.has(id)) throw Error('missing'); return files.get(id)! },
    async remove(ids: string[]) { for (const id of ids) files.delete(id); return ids },
  }
  m.seed('users', uid, { appId: APP_ID, openId: 'owner', nickname: '测试领队', registrationUploadSlots: [] })
  m.seed('leaderTeamBindings', uid, { teamId: tid })
  m.seed('teams', tid, { name: '测试球队', district: '黄浦区', contactPhone: '13800000000', leaderUserId: uid, status: 'active', schemaVersion: 1, version: 1, roster: [] })
  m.seed('competitions', cid, { name: '测试赛事', displayEnabled: true, registrationEnabled: true, registrationStartAt: '2026-11-01T00:00:00Z', registrationEndAt: '2026-11-25T00:00:00Z', registrationConfig: { projects: ['男子组'], teamLimit: 16, minPlayers: 5, maxPlayers: 15 }, registrationRulesVersion: 1 })
  const authorize = async (token: string) => token === 'test' ? { ok: true, admin: { username: 'admin' } } : { ok: false, error: { code: 'UNAUTHORIZED' } }
  const cleaner = createRegistrationCleanupService({ store: m.registrationStore, storage, authorize, now, logger: { error() {} } })
  const makeUploader = (store = m.store) => createRegistrationFileService({ store, storage, now, context: () => ({ APPID: APP_ID, OPENID: 'owner' }), enabled: true, logger: { error() {} } })
  const uploader = makeUploader(), registration = createRegistrationService({ store: m.registrationStore, storage, now, context: () => ({ APPID: APP_ID, OPENID: 'owner' }), uploadsEnabled: true, logger: { error() {} } })
  const start = (handler = uploader) => handler({ action: 'files.start', competitionId: cid, requestId, name: '材料.pdf', size: pdf.length })
  const send = (id: string, handler = uploader) => handler({ action: 'files.chunk', id, index: 0, data: pdf.toString('base64') })
  const clean = (extra = {}) => cleaner({ action: 'registrations.cleanup', token: 'test', ...extra })
  const submit = (id: string) => registration({ action: 'registrations.submit', competitionId: cid, expectedVersion: 0, rulesVersion: 1, requestId: 'b'.repeat(32), attachmentIds: [id], form: { teamName: '测试球队', district: '黄浦区', project: '男子组', leaderName: '测试领队', contactPhone: '13800000000' } })
  const expire = () => { clock.value += 86400001 }
  function seed(index: number, extra: any = {}) {
    const id = 'f_' + index.toString(16).padStart(32, '0'), path = `registration-materials/${index.toString(16).padStart(48, '0')}.pdf`
    m.seed('registrationFiles', id, { ownerUserId: uid, competitionId: cid, status: 'ready', name: '材料.pdf', size: pdf.length, extension: 'pdf', chunks: [], fileID: path, expiresAt: now() - 1, createdAt: now() - 86400000, ...extra })
    files.set(path, pdf)
    return { id, path }
  }
  return { ...m, clock, now, files, storage, uploader, makeUploader, start, send, clean, cleaner, submit, expire, seedFile: seed }
}

test('cleanup authenticates first, rejects injected IDs/cursors, and defaults to a read-only preview', async () => {
  const s = fixture(), f = s.seedFile(1), before = structuredClone([...s.records])
  assert.equal((await s.cleaner({ action: 'registrations.cleanup', dryRun: false })).error.code, 'UNAUTHORIZED')
  for (const extra of [{ ids: [f.path] }, { dryRun: 'false' }, { cursor: {} }]) assert.equal((await s.clean(extra)).error.code, 'INVALID_ARGUMENT')
  const r = await s.clean(); assert.equal(r.ok, true); assert.equal(r.dryRun, true); assert.equal(r.candidateObjects, 1)
  assert.deepEqual([...s.records], before); assert.equal(s.files.size, 1)
})

test('expired and discarded sessions clean idempotently, release upload slots, and cannot be resumed', async () => {
  const s = fixture(), f = await s.start(); await s.send(f.id)
  await s.uploader({ action: 'files.discard', id: f.id })
  assert.equal(s.files.size, 1, 'in-flight lease delays physical deletion')
  assert.equal((await s.clean({ dryRun: false })).deferredSessions, 1)
  s.clock.value += UPLOAD_LEASE + 1
  const r = await s.clean({ dryRun: false }); assert.equal(r.removedObjects, 1); assert.equal(r.cleanedSessions, 1)
  assert.equal(s.files.size, 0); assert.equal(s.read('registrationFiles', f.id).status, 'cleaned'); assert.equal(s.read('users', uid).registrationUploadSlots.length, 0)
  assert.equal((await s.start()).error.code, 'CONFLICT'); assert.equal((await s.send(f.id)).error.code, 'INVALID_ATTACHMENT')
  assert.equal((await s.clean({ dryRun: false })).removedObjects, 0)
  const expired = s.seedFile(2); const active = s.seedFile(3, { expiresAt: s.now() + 86400000 })
  assert.equal((await s.clean({ dryRun: false })).removedObjects, 1); assert.equal(s.files.has(expired.path), false); assert.equal(s.files.has(active.path), true)
})

test('current and historical bound materials remain while their staging and losing finals can be removed', async () => {
  const s = fixture(), f = await s.start(); await s.send(f.id); const ready = await s.uploader({ action: 'files.finish', id: f.id }); assert.equal(ready.ok, true)
  const submitted = await s.submit(f.id); assert.equal(submitted.ok, true)
  const canonical = s.read('registrationFiles', f.id).fileID
  // A bound file remains historical even when absent from the latest form.
  const record = s.read('registrations', submitted.registration.id); s.seed('registrations', record._id, { ...record, attachments: [] })
  s.expire(); const r = await s.clean({ dryRun: false })
  assert.equal(r.retainedSessions, 1); assert.equal(r.removedObjects, 1); assert.equal(s.files.has(canonical), true); assert.equal(s.files.size, 1)
  assert.equal(s.read('registrationFiles', f.id).status, 'ready'); assert.equal(s.read('registrationFiles', f.id).registrationId, record._id)
})

test('every upload is durably reserved before bytes; failing the reservation cannot create an orphan', async () => {
  const s = fixture(), f = await s.start(); let uploads = 0
  s.storage.upload = async (path: string, bytes: Buffer) => { uploads++; const r = s.read('registrationFiles', f.id); assert.ok(r.storageObjects.some((o: any) => o.fileID === path)); s.files.set(path, bytes); return path }
  assert.equal((await s.send(f.id)).ok, true); assert.equal(uploads, 1)
  const t = fixture(), next = await t.start(); t.storage.prepare = async path => { t.failures.write = true; return path }
  assert.equal((await t.send(next.id)).error.code, 'SERVICE_UNAVAILABLE'); assert.equal(t.files.size, 0)
})

test('orphaned final after a failed commit remains tracked and is collected after expiry', async () => {
  const s = fixture(), f = await s.start(); await s.send(f.id)
  const store = { transaction: (callback: any) => s.store.transaction((tx: any) => callback({ ...tx, set: async (c: string, id: string, value: any) => { if (c === 'registrationFiles' && value.status === 'ready') throw Error('failed final commit'); return tx.set(c, id, value) } })) }
  const r = await s.makeUploader(store)({ action: 'files.finish', id: f.id }); assert.equal(r.error.code, 'SERVICE_UNAVAILABLE')
  assert.equal(s.files.size, 2); assert.equal(s.read('registrationFiles', f.id).storageObjects.length, 2)
  s.expire(); assert.equal((await s.clean({ dryRun: false })).removedObjects, 2); assert.equal(s.files.size, 0)
})

test('a lost final commit response can be retried; cleanup preserves the subsequently submitted winner', async () => {
  const s = fixture(), f = await s.start(); await s.send(f.id)
  let loseOnce = true
  const store = { transaction: async (callback: any) => { let finishing = false; const result = await s.store.transaction((tx: any) => callback({ ...tx, set: async (c: string, id: string, value: any) => { if (value.status === 'ready') finishing = true; await tx.set(c, id, value) } })); if (finishing && loseOnce) { loseOnce = false; throw Error('response lost') } return result } }
  assert.equal((await s.makeUploader(store)({ action: 'files.finish', id: f.id })).error.code, 'SERVICE_UNAVAILABLE')
  assert.equal((await s.uploader({ action: 'files.finish', id: f.id })).ok, true); assert.equal((await s.submit(f.id)).ok, true)
  s.expire(); assert.equal((await s.clean({ dryRun: false })).removedObjects, 1); assert.equal(s.files.size, 1)
})

test('a late upload after discard is deferred by its reservation lease and collected later', async () => {
  const s = fixture(), f = await s.start(); let release!: () => void, started!: () => void
  const gate = new Promise<void>(r => release = r), entered = new Promise<void>(r => started = r)
  s.storage.upload = async (path, bytes) => { started(); await gate; s.files.set(path, bytes); return path }
  const sending = s.send(f.id); await entered; await s.uploader({ action: 'files.discard', id: f.id })
  assert.equal((await s.clean({ dryRun: false })).deferredSessions, 1)
  release(); assert.equal((await sending).error.code, 'CONFLICT'); assert.equal(s.files.size, 1)
  s.clock.value += UPLOAD_LEASE + 1; assert.equal((await s.clean({ dryRun: false })).removedObjects, 1); assert.equal(s.files.size, 0)
})

test('partial deletion retries only failures; an ambiguous deletion confirmation can retry after claim expiry', async () => {
  const s = fixture(), f = await s.start(); await s.send(f.id); await s.uploader({ action: 'files.finish', id: f.id }); s.expire()
  const original = s.storage.remove; let partial = true
  s.storage.remove = async ids => { if (partial) { partial = false; return original(ids.slice(0, 1)) } return original(ids) }
  let r = await s.clean({ dryRun: false }); assert.equal(r.removedObjects, 1); assert.equal(r.failedObjects, 1); assert.equal(r.retryPage, true); assert.equal(s.read('registrationFiles', f.id).status, 'cleaning')
  r = await s.clean({ dryRun: false }); assert.equal(r.removedObjects, 1); assert.equal(r.cleanedSessions, 1); assert.equal(s.files.size, 0)
  const t = fixture(), old = t.seedFile(1); t.storage.remove = async ids => { const removed = ids; ids.forEach(id => t.files.delete(id)); t.failures.write = true; return removed }
  assert.equal((await t.clean({ dryRun: false })).error.code, 'SERVICE_UNAVAILABLE'); t.failures.write = false
  assert.equal((await t.clean()).deferredSessions, 1); t.clock.value += 5 * 60000 + 1; t.storage.remove = original
  assert.equal((await t.clean({ dryRun: false })).cleanedSessions, 1); assert.equal(t.read('registrationFiles', old.id).status, 'cleaned')
})

test('binding and cleaning serialize on one file record and never delete the submitted material', async () => {
  const s = fixture(), f = await s.start(); await s.send(f.id); await s.uploader({ action: 'files.finish', id: f.id })
  s.clock.value += UPLOAD_LEASE + 1
  // Force a stale preview from before a concurrent successful submission.
  const list = s.registrationStore.listFiles
  s.registrationStore.listFiles = async (args: any) => { const rows = await list(args); await s.submit(f.id); return rows.map((r: any) => ({ ...r, expiresAt: s.now() - 1 })) }
  const canonical = s.read('registrationFiles', f.id).fileID
  assert.equal((await s.clean({ dryRun: false })).ok, true); assert.equal(s.files.has(canonical), true); assert.ok(s.read('registrationFiles', f.id).registrationId)
  const t = fixture(), old = t.seedFile(1); await t.clean({ dryRun: false }); assert.equal((await t.submit(old.id)).error.code, 'INVALID_ATTACHMENT'); assert.equal(t.files.has(old.path), false)
})

test('batch limits, cursors and overlapping cleaners do not skip remaining objects or delete twice', async () => {
  const s = fixture(), f = s.seedFile(1), objects = Array.from({ length: OBJECT_LIMIT + 3 }, (_, i) => { const path = `registration-materials/${(100+i).toString(16).padStart(48, '0')}.pdf`; s.files.set(path, pdf); return { fileID: path, leaseUntil: 0 } })
  s.seedFile(1, { storageObjects: objects }); for (let i=2; i<=7; i++) s.seedFile(i)
  const first = await s.clean({ dryRun: false }); assert.equal(first.removedObjects, OBJECT_LIMIT); assert.equal(first.retryPage, true); assert.ok(first.nextCursor)
  const [a,b] = await Promise.all([s.clean({ dryRun: false }),s.clean({ dryRun: false })]); assert.equal(a.ok, true); assert.equal(b.ok, true)
  assert.ok(a.removedObjects + b.removedObjects <= 8); assert.equal(s.read('registrationFiles', f.id).status, 'cleaned')
  assert.equal((await s.clean({ dryRun: false, cursor: first.nextCursor })).scannedSessions, 2); assert.equal(s.files.size, 0)
})

test('scope guards reject avatars, other environments and malformed registry paths; shared helpers stay identical', async () => {
  const s = fixture(), f = s.seedFile(1, { fileID: 'user-avatars/private.png' }); s.files.set('user-avatars/private.png', pdf)
  const r = await s.clean({ dryRun: false }); assert.equal(r.blockedObjects, 1); assert.equal(s.files.has('user-avatars/private.png'), true); assert.equal(s.read('registrationFiles', f.id).status, 'cleaning')
  const adapter = createStorageAdapter({}, 'customer-env')
  assert.equal(adapter.path('cloud://old-env.bucket/registration-materials/a.pdf'), null)
  assert.equal(adapter.path('cloud://customer-env-evil.bucket/registration-materials/a.pdf'), null)
  assert.equal(adapter.path('cloud://customer-env.bucket/registration-materials/a.pdf'), 'registration-materials/a.pdf')
  assert.deepEqual(await readFile('cloudfunctions/teamManagement/registration-storage.js'), await readFile('cloudfunctions/adminAuth/registration-storage.js'))
})


test('a slower concurrent finish returns the winning attachment without uploading a second final', async () => {
 const s=fixture(),f=await s.start();await s.send(f.id)
 let finalCalls=0,release!:()=>void
 const gate=new Promise<void>(r=>release=r)
 s.storage.prepare=async path=>{if(path.startsWith('registration-materials/')&&++finalCalls===2)await gate;return path}
 const first=s.uploader({action:'files.finish',id:f.id}),second=s.uploader({action:'files.finish',id:f.id})
 const winner=await first;release();const slower=await second
 assert.equal(winner.ok,true);assert.deepEqual(slower,winner);assert.equal(s.files.size,2)
})
