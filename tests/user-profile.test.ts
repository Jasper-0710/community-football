import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { deflateSync } from 'node:zlib'

const require = createRequire(import.meta.url)
const cloudRequire = createRequire(new URL('../cloudfunctions/userProfile/package.json', import.meta.url))
const { PNG } = cloudRequire('pngjs')
const jpeg = cloudRequire('jpeg-js')
const { createUserProfileHandler, DEFAULT_APP_ID, MAX_AVATAR_BYTES, userId } = require('../cloudfunctions/userProfile/service.js')
const pixels = { width: 2, height: 2, data: Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]) }
const png: Buffer = PNG.sync.write(pixels)
const jpegImage: Buffer = jpeg.encode(pixels, 85).data

function pngChunk(type: string, data: Buffer): Buffer {
  const content = Buffer.concat([Buffer.from(type), data])
  let crc = 0xffffffff
  for (const byte of content) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  const chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length, 0)
  content.copy(chunk, 4)
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4)
  return chunk
}

function pngWithPixels(raw: Buffer, interlace: boolean): Buffer {
  const header = Buffer.from(png.subarray(16, 29))
  header[12] = interlace ? 1 : 0
  return Buffer.concat([png.subarray(0, 8), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))])
}

type Stored = Record<string, any>

function fixture(options: { avatarUploadEnabled?: boolean } = {}) {
  const records = new Map<string, Stored>()
  const uploads: { cloudPath: string; fileContent: Buffer }[] = []
  const signed: string[] = []
  const failures = { database: false, write: false, upload: false, sign: false }
  let pending = Promise.resolve()
  let writes = 0
  let ticks = 0
  let token = 0
  // The fake serializes whole transactions and commits atomically. The production
  // adapter delegates optimistic conflicts/retries to db.runTransaction itself.
  const database = {
    runTransaction: async (callback: (transaction: any) => Promise<any>) => {
      const predecessor = pending
      let release!: () => void
      pending = new Promise<void>(resolve => { release = resolve })
      await predecessor
      try {
        if (failures.database) throw new Error('private database failure with identity')
        const snapshot = new Map(Array.from(records, ([id, row]) => [id, structuredClone(row)]))
        let transactionWrites = 0
        const result = await callback({ collection: (name: string) => {
          assert.equal(name, 'users')
          return { doc: (id: string) => ({
            get: async () => ({ data: snapshot.has(id) ? structuredClone(snapshot.get(id)) : null }),
            set: async ({ data }: { data: Stored }) => {
              if (failures.write) throw new Error('write failed')
              transactionWrites++
              snapshot.set(id, structuredClone(data))
            },
            update: async ({ data }: { data: Stored }) => {
              if (failures.write) throw new Error('write failed')
              assert.ok(snapshot.has(id), 'update must target an existing record')
              transactionWrites++
              snapshot.set(id, { ...snapshot.get(id), ...structuredClone(data) })
            },
          }) }
        } })
        records.clear()
        for (const [id, row] of snapshot) records.set(id, row)
        writes += transactionWrites
        return result
      } finally {
        release()
      }
    },
  }
  function handler(openId: string | undefined = 'wechat-user-a', appId: string | undefined = DEFAULT_APP_ID) {
    return createUserProfileHandler({
      expectedAppId: DEFAULT_APP_ID,
      avatarUploadEnabled: options.avatarUploadEnabled,
      now: () => new Date(Date.UTC(2026, 10, 4, 0, 0, ticks++)),
      fileToken: () => `test-file-${++token}`,
      logger: { error: () => {} },
      cloud: {
        getWXContext: () => ({ OPENID: openId, APPID: appId }),
        database: (options: unknown) => { assert.deepEqual(options, { throwOnNotFound: false }); return database },
        uploadFile: async (input: { cloudPath: string; fileContent: Buffer }) => {
          if (failures.upload) throw new Error('upload failed')
          uploads.push(input)
          return { fileID: `cloud://test-env/${input.cloudPath}` }
        },
        getTempFileURL: async ({ fileList }: { fileList: { fileID: string; maxAge: number }[] }) => {
          if (failures.sign) return { fileList: fileList.map(file => ({ fileID: file.fileID, status: -1 })) }
          for (const file of fileList) { assert.equal(file.maxAge, 600); signed.push(file.fileID) }
          return { fileList: fileList.map(file => ({ ...file, status: 0, tempFileURL: `https://storage.example.test/avatar?file=${encodeURIComponent(file.fileID)}` })) }
        },
      },
    })
  }
  return { records, uploads, signed, failures, handler, writes: () => writes }
}

test('first/repeated/concurrent login creates one ordinary account without returning trusted identity', async () => {
  const f = fixture()
  const handle = f.handler()
  const results = await Promise.all(Array.from({ length: 20 }, () => handle({ action: 'getOrCreate' })))
  assert.equal(f.records.size, 1)
  assert.equal(f.writes(), 1)
  assert.ok(results.every(result => result.ok === true))
  assert.ok(results.every(result => result.profile.id === results[0].profile.id))
  assert.deepEqual(Object.keys(results[0].profile).sort(), ['id', 'nickname', 'avatarFileId', 'avatarUrl', 'avatarUploadEnabled', 'role', 'createdAt', 'updatedAt'].sort())
  assert.equal(results[0].profile.nickname, '')
  assert.equal(results[0].profile.role, 'user')
  assert.equal(results[0].profile.avatarUrl, '')
  assert.equal(results[0].profile.avatarUploadEnabled, false)
  assert.ok(!JSON.stringify(results).includes('wechat-user-a'))
  assert.deepEqual(await handle({ action: 'getOrCreate' }), results[0])
})

test('trusted identities produce distinct accounts and only their own profile can be edited', async () => {
  const f = fixture()
  const a = f.handler('a'), b = f.handler('b')
  const [first, second] = await Promise.all([a({ action: 'getOrCreate' }), b({ action: 'getOrCreate' })])
  assert.notEqual(first.profile.id, second.profile.id)
  assert.equal(first.profile.id, userId(DEFAULT_APP_ID, 'a'))
  assert.equal(f.records.size, 2)
  assert.equal((await a({ action: 'update', profile: { nickname: '  领队甲  ' } })).profile.nickname, '领队甲')
  assert.equal((await b({ action: 'getOrCreate' })).profile.nickname, '')
})

test('WeChat-injected userInfo metadata is accepted but cannot replace the trusted context identity', async () => {
  const f = fixture()
  const handle = f.handler('trusted-user')
  const injected = { appId: DEFAULT_APP_ID, openId: 'trusted-user' }
  const first = await handle({ action: 'getOrCreate', userInfo: injected })
  assert.equal(first.ok, true)
  assert.equal(first.profile.id, userId(DEFAULT_APP_ID, 'trusted-user'))
  const spoofed = {
    appId: 'wx-foreign', openId: 'another-user', OPENID: 'another-user',
    role: 'admin', id: 'someone-else', nickname: 'injected-name',
  }
  const repeated = await handle({ action: 'getOrCreate', userInfo: spoofed })
  assert.deepEqual(repeated, first)
  const updated = await handle({ action: 'update', profile: { nickname: '本人昵称' }, userInfo: spoofed })
  assert.equal(updated.ok, true)
  assert.equal(updated.profile.id, first.profile.id)
  assert.equal(updated.profile.nickname, '本人昵称')
  assert.equal(updated.profile.role, 'user')
  assert.equal(f.records.size, 1)
  assert.equal(f.records.get(first.profile.id)!.openId, 'trusted-user')
  assert.equal(Object.hasOwn(f.records.get(first.profile.id)!, 'userInfo'), false)
  assert.equal((await f.handler('')({ action: 'getOrCreate', userInfo: injected })).error.code, 'AUTH_REQUIRED')
  assert.equal((await f.handler('trusted-user', 'wx-foreign')({ action: 'getOrCreate', userInfo: injected })).error.code, 'APP_MISMATCH')
  assert.equal((await handle({ action: 'getOrCreate', userInfo: injected, profile: {} })).error.code, 'INVALID_ARGUMENT')
  assert.equal((await handle({ action: 'getOrCreate', userInfo: injected, role: 'admin' })).error.code, 'INVALID_ARGUMENT')
})

test('the verified action+tcbContext+userInfo event shape ignores forged nested identity, roles and environment', async () => {
  const f = fixture()
  const handle = f.handler('trusted-context-user')
  const metadata = {
    tcbContext: { env: 'other-env', ENV: 'other-env', OPENID: 'victim', APPID: 'wx-foreign', role: 'admin', userInfo: { openId: 'victim', role: 'admin' } },
    userInfo: { openId: 'victim', appId: 'wx-foreign', role: 'admin' },
  }
  const result = await handle({ action: 'getOrCreate', ...metadata })
  assert.equal(result.ok, true)
  assert.equal(result.profile.id, userId(DEFAULT_APP_ID, 'trusted-context-user'))
  assert.equal(result.profile.role, 'user')
  assert.equal(result.profile.nickname, '')
  const update = await handle({ action: 'update', profile: { nickname: '实际用户' }, ...metadata })
  assert.equal(update.ok, true)
  assert.equal(update.profile.id, result.profile.id)
  assert.equal(update.profile.role, 'user')
  assert.equal(update.profile.nickname, '实际用户')
  const stored = f.records.get(result.profile.id)!
  assert.equal(stored.openId, 'trusted-context-user')
  assert.equal(stored.appId, DEFAULT_APP_ID)
  for (const field of ['tcbContext', 'userInfo', 'env', 'ENV']) assert.equal(Object.hasOwn(stored, field), false)
  assert.equal(f.records.size, 1)
  assert.equal((await f.handler('')({ action: 'getOrCreate', ...metadata })).error.code, 'AUTH_REQUIRED')
  assert.equal((await f.handler('victim', 'wx-foreign')({ action: 'getOrCreate', ...metadata })).error.code, 'APP_MISMATCH')
  assert.deepEqual(await handle({ action: 'getOrCreate', ...metadata, extraField: 'invalid' }), {
    ok: false, error: { code: 'INVALID_ARGUMENT', message: '请求包含不支持的字段' },
  })
})

test('return visits preserve edits, original timestamps, roles and future server-only fields', async () => {
  const f = fixture()
  const handle = f.handler()
  const initial = await handle({ action: 'getOrCreate' })
  const stored = f.records.get(initial.profile.id)!
  stored.role = 'leader'
  stored.teamIds = ['server-team']
  const updated = await handle({ action: 'update', profile: { nickname: '领队' } })
  assert.equal(updated.ok, true)
  assert.equal(updated.profile.role, 'leader')
  assert.equal(updated.profile.createdAt, initial.profile.createdAt)
  assert.notEqual(updated.profile.updatedAt, initial.profile.updatedAt)
  assert.deepEqual(f.records.get(initial.profile.id)!.teamIds, ['server-team'])
  assert.deepEqual(await handle({ action: 'getOrCreate' }), updated)
  f.records.get(initial.profile.id)!.role = 'admin'
  assert.equal((await handle({ action: 'getOrCreate' })).profile.role, 'admin')
})

test('concurrent reads do not reset profile updates or overwrite independent server fields', async () => {
  const f = fixture({ avatarUploadEnabled: true })
  const handle = f.handler()
  const initial = await handle({ action: 'getOrCreate' })
  f.records.get(initial.profile.id)!.teamIds = ['team-1']
  await Promise.all([
    ...Array.from({ length: 8 }, () => handle({ action: 'getOrCreate' })),
    handle({ action: 'update', profile: { nickname: '新昵称' }, avatar: { base64: png.toString('base64'), format: 'png' } }),
    handle({ action: 'update', profile: { nickname: '最后昵称' } }),
  ])
  const read = await handle({ action: 'getOrCreate' })
  assert.equal(read.ok, true)
  assert.notEqual(read.profile.nickname, '')
  assert.ok(read.profile.avatarFileId.includes(`/users/${initial.profile.id}/avatars/`))
  assert.deepEqual(f.records.get(initial.profile.id)!.teamIds, ['team-1'])
  assert.equal(read.profile.createdAt, initial.profile.createdAt)
})

test('missing identity, unexpected application and unknown stored roles fail closed', async () => {
  const f = fixture()
  for (const handle of [f.handler(''), f.handler('a', ''), f.handler('a', 'wx-foreign')]) {
    const result = await handle({ action: 'getOrCreate' })
    assert.equal(result.ok, false)
    assert.ok(['AUTH_REQUIRED', 'APP_MISMATCH'].includes(result.error.code))
  }
  assert.equal(f.records.size, 0)
  const handle = f.handler()
  const created = await handle({ action: 'getOrCreate' })
  f.records.get(created.profile.id)!.role = 'superuser'
  assert.equal((await handle({ action: 'getOrCreate' })).error.code, 'PROFILE_UNAVAILABLE')
  assert.equal((await handle({ action: 'update', profile: { nickname: 'should not change' } })).ok, false)
  assert.equal(f.records.get(created.profile.id)!.nickname, '')
})

test('top-level and nested forged identity, role and unknown fields are rejected before writes', async () => {
  const f = fixture()
  const handle = f.handler()
  const requests: unknown[] = [null, [], {}, { action: 'delete' }, { action: 'getOrCreate', profile: {} }]
  for (const field of ['userId', 'openid', 'OPENID', 'APPID', 'role', 'avatarFileId', 'avatarUrl', 'createdAt']) {
    requests.push({ action: 'getOrCreate', [field]: 'forged' })
    requests.push({ action: 'update', profile: { nickname: 'valid', [field]: 'forged' } })
  }
  for (const request of requests) {
    const response = await handle(request)
    assert.equal(response.ok, false, JSON.stringify(request))
    assert.equal(response.error.code, 'INVALID_ARGUMENT', JSON.stringify(request))
  }
  assert.equal(f.writes(), 0)
  assert.equal(f.uploads.length, 0)
})

test('nickname validation uses Unicode code points, trims spaces and rejects empty/control/oversize input', async () => {
  const f = fixture()
  const handle = f.handler()
  for (const nickname of ['', '   ', 'a'.repeat(31), '球\n员', '\t球员', '球\u0000员', '球\u202e员', '\ud800']) {
    const response = await handle({ action: 'update', profile: { nickname } })
    assert.equal(response.ok, false, JSON.stringify(nickname))
    assert.equal(response.error.code, 'INVALID_NICKNAME')
  }
  assert.equal((await handle({ action: 'update', profile: { nickname: 7 } })).ok, false)
  const response = await handle({ action: 'update', profile: { nickname: ` ${'⚽'.repeat(30)} ` } })
  assert.equal(response.ok, true)
  assert.equal(response.profile.nickname, '⚽'.repeat(30))
})

test('avatars are disabled by default: avatar requests never upload or write, while nickname updates still succeed', async () => {
  const f = fixture()
  const handle = f.handler()
  const avatars = [{ base64: png.toString('base64'), format: 'png' }, null, 'invalid', {}]
  for (const avatar of avatars) {
    const result = await handle({ action: 'update', profile: { nickname: '不得写入' }, avatar })
    assert.deepEqual(result, { ok: false, error: { code: 'AVATAR_UNAVAILABLE', message: '头像功能暂未开放，请先保存昵称' } })
  }
  assert.equal(f.uploads.length, 0)
  assert.equal(f.signed.length, 0)
  assert.equal(f.records.size, 0)
  assert.equal(f.writes(), 0)
  const first = await handle({ action: 'getOrCreate' })
  assert.equal(first.profile.avatarUploadEnabled, false)
  const updated = await handle({ action: 'update', profile: { nickname: '仅保存昵称' } })
  assert.equal(updated.ok, true)
  assert.equal(updated.profile.nickname, '仅保存昵称')
  assert.equal(updated.profile.avatarUploadEnabled, false)
  const before = structuredClone(f.records.get(updated.profile.id))
  const writesBefore = f.writes()
  const forged = await handle({
    action: 'update', profile: { nickname: '不能顺便保存' }, avatar: avatars[0],
    userInfo: { avatarUploadEnabled: true }, tcbContext: { USER_PROFILE_AVATAR_ENABLED: 'true' },
  })
  assert.equal(forged.error.code, 'AVATAR_UNAVAILABLE')
  assert.deepEqual(f.records.get(updated.profile.id), before)
  assert.equal(f.writes(), writesBefore)
  assert.equal(f.uploads.length, 0)
  assert.equal((await handle({ action: 'update', profile: { nickname: '不能授权', avatarUploadEnabled: true } })).error.code, 'INVALID_ARGUMENT')
})

test('disabled avatar capability does not sign existing images or prevent normal profile reads and nickname updates', async () => {
  const f = fixture({ avatarUploadEnabled: false })
  const handle = f.handler()
  const initial = await handle({ action: 'getOrCreate' })
  const stored = f.records.get(initial.profile.id)!
  stored.avatarFileId = 'cloud://existing-env/users/existing/avatar.png'
  f.failures.sign = true
  const read = await handle({ action: 'getOrCreate' })
  assert.equal(read.ok, true)
  assert.equal(read.profile.avatarUrl, '')
  assert.equal(read.profile.avatarUploadEnabled, false)
  assert.equal(read.profile.avatarFileId, '')
  assert.equal(stored.avatarFileId, 'cloud://existing-env/users/existing/avatar.png')
  const update = await handle({ action: 'update', profile: { nickname: '无头像依赖' } })
  assert.equal(update.ok, true)
  assert.equal(update.profile.nickname, '无头像依赖')
  assert.equal(update.profile.avatarUrl, '')
  assert.equal(update.profile.avatarFileId, '')
  assert.equal(f.records.get(initial.profile.id)!.avatarFileId, 'cloud://existing-env/users/existing/avatar.png')
  assert.equal(f.signed.length, 0)
  assert.equal(f.uploads.length, 0)
})

test('avatars are uploaded beneath the trusted user directory and URLs are signed on the server', async () => {
  const f = fixture({ avatarUploadEnabled: true })
  const handle = f.handler()
  const response = await handle({ action: 'update', profile: { nickname: '球迷' }, avatar: { base64: png.toString('base64'), format: 'png' } })
  assert.equal(response.ok, true)
  assert.equal(response.profile.avatarUploadEnabled, true)
  assert.match(f.uploads[0].cloudPath, new RegExp(`^users/${response.profile.id}/avatars/test-file-1\\.png$`))
  assert.deepEqual(f.uploads[0].fileContent, png)
  assert.ok(response.profile.avatarUrl.startsWith('https://'))
  assert.equal(f.signed[0], response.profile.avatarFileId)
  const returned = await handle({ action: 'getOrCreate' })
  assert.equal(returned.profile.avatarFileId, response.profile.avatarFileId)
  assert.equal(f.signed.length, 2)
  const second = await handle({ action: 'update', profile: { nickname: '球迷' }, avatar: { base64: jpegImage.toString('base64'), format: 'jpeg' } })
  assert.equal(second.ok, true)
  assert.notEqual(second.profile.avatarFileId, response.profile.avatarFileId)
  assert.ok(f.uploads[1].cloudPath.endsWith('.jpg'))
})

test('avatar validation rejects external references, malformed encoding, unknown fields and mismatched signatures', async () => {
  const f = fixture({ avatarUploadEnabled: true })
  const handle = f.handler()
  const invalid = [
    null, 'https://example.test/a.png', { url: 'https://example.test/a.png' },
    { base64: png.toString('base64'), format: 'svg' },
    { base64: png.toString('base64'), format: 'png', cloudPath: 'other-user' },
    { base64: png.toString('base64'), format: 'jpeg' },
    { base64: 'not-base64!', format: 'png' },
    { base64: 'data:image/png;base64,' + png.toString('base64'), format: 'png' },
    { base64: '', format: 'png' },
    { base64: Buffer.from('<svg />').toString('base64'), format: 'png' },
    { base64: png.subarray(0, 8).toString('base64'), format: 'png' },
    { base64: png.subarray(0, png.length - 5).toString('base64'), format: 'png' },
    { base64: jpegImage.subarray(0, jpegImage.length - 2).toString('base64'), format: 'jpeg' },
    { base64: Buffer.from([255, 216, 255, 217]).toString('base64'), format: 'jpeg' },
    { base64: Buffer.alloc(MAX_AVATAR_BYTES + 1).toString('base64'), format: 'png' },
  ]
  for (const avatar of invalid) {
    const response = await handle({ action: 'update', profile: { nickname: 'valid' }, avatar })
    assert.equal(response.ok, false)
    assert.equal(response.error.code, 'INVALID_AVATAR')
  }
  assert.equal(f.records.size, 0)
  assert.equal(f.uploads.length, 0)
})

test('oversize files with a genuine image prefix are rejected before upload', async () => {
  const f = fixture({ avatarUploadEnabled: true })
  const bytes = Buffer.alloc(MAX_AVATAR_BYTES + 1)
  png.copy(bytes)
  const response = await f.handler()({ action: 'update', profile: { nickname: '边界' }, avatar: { base64: bytes.toString('base64'), format: 'png' } })
  assert.equal(response.ok, false)
  assert.equal(response.error.code, 'INVALID_AVATAR')
  assert.equal(f.uploads.length, 0)
})

test('image dimensions and total pixels are bounded before large image allocation', async () => {
  const f = fixture({ avatarUploadEnabled: true })
  const widePixels = { width: 2049, height: 1, data: Buffer.alloc(2049 * 4, 255) }
  const widePng: Buffer = PNG.sync.write(widePixels)
  const wideJpeg: Buffer = jpeg.encode(widePixels, 50).data
  // Valid and highly compressed PNG: below each edge limit, but above 4 million pixels.
  const tooManyPixels: Buffer = PNG.sync.write({ width: 2001, height: 2000, data: Buffer.alloc(2001 * 2000 * 4, 255) })
  for (const [image, format] of [[widePng, 'png'], [wideJpeg, 'jpeg'], [tooManyPixels, 'png']] as const) {
    assert.ok(image.length < MAX_AVATAR_BYTES, 'exercise dimensions, not upload size')
    const result = await f.handler()({ action: 'update', profile: { nickname: '尺寸' }, avatar: { base64: image.toString('base64'), format } })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'INVALID_AVATAR')
  }
  assert.equal(f.uploads.length, 0)
  assert.equal(f.records.size, 0)
})

test('PNG inflation is bounded even when a small IHDR contains a large compressed payload', async () => {
  const f = fixture({ avatarUploadEnabled: true })
  for (const interlace of [false, true]) {
    const bomb = pngWithPixels(Buffer.alloc(1024 * 1024), interlace)
    assert.ok(bomb.length < MAX_AVATAR_BYTES)
    const result = await f.handler()({ action: 'update', profile: { nickname: '压缩' }, avatar: { base64: bomb.toString('base64'), format: 'png' } })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'INVALID_AVATAR')
  }
  assert.equal(f.uploads.length, 0)
})

test('a valid Adam7 interlaced PNG is decoded and accepted', async () => {
  const f = fixture({ avatarUploadEnabled: true })
  // For a 2×2 image, Adam7 passes 1, 6 and 7 contain one, one and two pixels.
  const raw = Buffer.concat([
    Buffer.from([0]), pixels.data.subarray(0, 4),
    Buffer.from([0]), pixels.data.subarray(4, 8),
    Buffer.from([0]), pixels.data.subarray(8, 16),
  ])
  const image = pngWithPixels(raw, true)
  const result = await f.handler()({ action: 'update', profile: { nickname: '交错' }, avatar: { base64: image.toString('base64'), format: 'png' } })
  assert.equal(result.ok, true)
  assert.equal(f.uploads.length, 1)
})

test('cloud read/write/upload/signing failures never report a successful profile', async () => {
  for (const failure of ['database', 'write', 'upload', 'sign'] as const) {
    const f = fixture({ avatarUploadEnabled: true })
    f.failures[failure] = true
    const request = failure === 'upload' || failure === 'sign'
      ? { action: 'update', profile: { nickname: '球迷' }, avatar: { base64: png.toString('base64'), format: 'png' } }
      : { action: 'getOrCreate' }
    const response = await f.handler()(request)
    assert.deepEqual(response, { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '用户服务暂不可用，请重试；保存状态以重新读取的资料为准' } })
    assert.equal(f.records.size, 0)
    assert.ok(!JSON.stringify(response).includes('private database'))
  }
})

test('failed updates leave committed profile intact and service recovery allows a fresh read', async () => {
  const f = fixture()
  const handle = f.handler()
  const before = await handle({ action: 'update', profile: { nickname: '原始昵称' } })
  f.failures.write = true
  assert.equal((await handle({ action: 'update', profile: { nickname: '新昵称' } })).ok, false)
  f.failures.write = false
  const after = await handle({ action: 'getOrCreate' })
  assert.deepEqual(after, before)
})


test('unavailable saved avatar falls back without blocking login or nickname updates and recovers on the next read', async () => {
  const f = fixture({ avatarUploadEnabled: true })
  const handle = f.handler()
  const saved = await handle({ action: 'update', profile: { nickname: '原昵称' }, avatar: { base64: png.toString('base64'), format: 'png' } })
  assert.equal(saved.ok, true)
  f.failures.sign = true
  const login = await handle({ action: 'getOrCreate' })
  assert.equal(login.ok, true)
  assert.equal(login.profile.avatarFileId, saved.profile.avatarFileId)
  assert.equal(login.profile.avatarUrl, '')
  const updated = await handle({ action: 'update', profile: { nickname: '新昵称' } })
  assert.equal(updated.ok, true)
  assert.equal(updated.profile.nickname, '新昵称')
  assert.equal(updated.profile.avatarFileId, saved.profile.avatarFileId)
  assert.equal(updated.profile.avatarUrl, '')
  f.failures.sign = false
  const recovered = await handle({ action: 'getOrCreate' })
  assert.equal(recovered.profile.nickname, '新昵称')
  assert.equal(recovered.profile.avatarFileId, saved.profile.avatarFileId)
  assert.match(recovered.profile.avatarUrl, /^https:/)
})

test('a failed replacement upload or signing step never changes the previously saved avatar or nickname', async () => {
  for (const failure of ['upload', 'sign'] as const) {
    const f = fixture({ avatarUploadEnabled: true })
    const handle = f.handler()
    const saved = await handle({ action: 'update', profile: { nickname: '原昵称' }, avatar: { base64: png.toString('base64'), format: 'png' } })
    f.failures[failure] = true
    const failed = await handle({ action: 'update', profile: { nickname: '不应保存' }, avatar: { base64: jpegImage.toString('base64'), format: 'jpeg' } })
    assert.equal(failed.ok, false)
    f.failures[failure] = false
    const restored = await handle({ action: 'getOrCreate' })
    assert.equal(restored.profile.nickname, '原昵称')
    assert.equal(restored.profile.avatarFileId, saved.profile.avatarFileId)
  }
})
