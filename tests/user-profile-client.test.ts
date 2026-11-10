import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import { computed, ref } from 'vue'
import {
  avatarFormat, MAX_AVATAR_BYTES, parseUserProfileResponse, UserProfileError, validateNickname,
} from '../src/domain/user'
import { prepareAvatarUpload } from '../src/services/user-profile'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5mQAAAAASUVORK5CYII=', 'base64')
const profile = {
  id: 'a'.repeat(64), nickname: '上海球迷', avatarFileId: '', avatarUrl: '', avatarUploadEnabled: false,
  role: 'user', createdAt: '2026-11-04T08:00:00.000Z', updatedAt: '2026-11-04T08:01:00.000Z',
}

function code(error: unknown, expected: string): boolean {
  return error instanceof UserProfileError && error.code === expected
}

test('client nickname rules accept trimmed Unicode names through the exact 30-code-point limit', () => {
  assert.equal(validateNickname('  上海球迷  '), '上海球迷')
  assert.equal(validateNickname('😀'.repeat(30)), '😀'.repeat(30))
  for (const value of ['', '   ', '😀'.repeat(31)]) {
    assert.throws(() => validateNickname(value), error => code(error, 'INVALID_NICKNAME'))
  }
})

test('client rejects the same invisible/control characters as the cloud before trimming', () => {
  for (const value of ['球\n迷', '\n球迷', '球迷\t', '球\u0085迷', '球\u202e迷', '球\u0000迷', '\ud800']) {
    assert.throws(() => validateNickname(value), error => code(error, 'INVALID_NICKNAME'), JSON.stringify(value))
  }
})

test('successful response creates a fresh public profile while stripping private identity and extra fields', () => {
  const server = { ...profile, openId: 'private-openid', appId: 'private-appid', teamIds: ['private-team'] }
  const parsed = parseUserProfileResponse({ ok: true, profile: server })
  assert.deepEqual(parsed, profile)
  assert.notEqual(parsed, server)
  assert.ok(!JSON.stringify(parsed).includes('private'))
  parsed.nickname = '本地草稿'
  assert.equal(server.nickname, profile.nickname)
  for (const role of ['user', 'leader', 'admin']) {
    assert.equal(parseUserProfileResponse({ ok: true, profile: { ...profile, role } }).role, role)
  }
  assert.equal(parseUserProfileResponse({ ok: true, profile: { ...profile, nickname: '' } }).nickname, '')
})

test('server-declared errors retain their code and do not masquerade as an authenticated response', () => {
  assert.throws(() => parseUserProfileResponse({ ok: false, error: { code: 'APP_MISMATCH', message: '不能访问' }, profile }), error => {
    return code(error, 'APP_MISMATCH') && (error as Error).message === '不能访问'
  })
  assert.throws(() => parseUserProfileResponse({ ok: false }), error => code(error, 'PROFILE_FAILED'))
  assert.throws(() => parseUserProfileResponse({ ok: false, error: { code: '   ', message: '   ' } }), error => {
    return code(error, 'PROFILE_FAILED') && (error as Error).message.trim().length > 0
  })
  for (const value of [null, undefined, false, [], {}, { ok: 'true', profile }, { ok: true }]) {
    assert.throws(() => parseUserProfileResponse(value), error => code(error, 'INVALID_RESPONSE'))
  }
})

test('missing fields, unknown roles and invalid dates cannot establish client login', () => {
  for (const field of Object.keys(profile)) {
    const incomplete: Record<string, unknown> = { ...profile }
    delete incomplete[field]
    assert.throws(() => parseUserProfileResponse({ ok: true, profile: incomplete }), error => code(error, 'INVALID_RESPONSE'), field)
  }
  for (const changes of [{ role: 'superuser' }, { role: 1 }, { createdAt: 'not a date' }, { updatedAt: null }, { nickname: 123 }]) {
    assert.throws(() => parseUserProfileResponse({ ok: true, profile: { ...profile, ...changes } }), error => code(error, 'INVALID_RESPONSE'))
  }
})

test('avatar availability must be an explicit boolean from the server', () => {
  for (const avatarUploadEnabled of [true, false]) {
    assert.equal(parseUserProfileResponse({ ok: true, profile: { ...profile, avatarUploadEnabled } }).avatarUploadEnabled, avatarUploadEnabled)
  }
  for (const avatarUploadEnabled of [undefined, null, 0, 1, 'true', 'false', {}, []]) {
    assert.throws(() => parseUserProfileResponse({ ok: true, profile: { ...profile, avatarUploadEnabled } }), error => code(error, 'INVALID_RESPONSE'))
  }
})

test('nickname saving omits a stale avatar draft when the server disables avatar uploads', async () => {
  const source = fs.readFileSync(new URL('../src/composables/useUserProfile.ts', import.meta.url), 'utf8')
  const compiled = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2020' }).code
  const avatar = { base64: png.toString('base64'), format: 'png' }
  for (const avatarUploadEnabled of [false, true]) {
    const calls: { nickname: string; upload: unknown }[] = []
    const module = { exports: {} as any }
    const serverProfile = { ...profile, avatarUploadEnabled }
    vm.runInNewContext(compiled, {
      module, exports: module.exports,
      uni: { setStorageSync: () => {} },
      require: (name: string) => {
        if (name === 'vue') return { computed, ref, onMounted: () => {}, onBeforeUnmount: () => {} }
        if (name === '@/services/user-profile') return {
          supportsWechatProfile: () => true,
          getOrCreateUserProfile: async () => serverProfile,
          updateUserProfile: async (nickname: string, upload: unknown) => {
            calls.push({ nickname, upload })
            return { ...serverProfile, nickname }
          },
          profileErrorMessage: (error: Error) => error.message,
        }
        throw new Error(`Unexpected import ${name}`)
      },
    })
    const state = module.exports.useUserProfile()
    await state.login()
    assert.equal(await state.save('修改昵称', avatar), true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].nickname, '修改昵称')
    assert.deepEqual(calls[0].upload, avatarUploadEnabled ? avatar : undefined)
    assert.equal(state.profile.value.nickname, '修改昵称')
  }
})

test('malformed IDs, unsafe avatar addresses and impossible nickname data are rejected at the response boundary', () => {
  for (const changes of [
    { id: ' ' }, { id: 'some-other-id' }, { nickname: '字'.repeat(31) }, { nickname: '用户\u202e' }, { nickname: '  ' },
    { avatarFileId: 'cloud://env/file', avatarUrl: 'http://example.test/avatar.png' },
    { avatarFileId: 'cloud://env/file', avatarUrl: 'javascript:alert(1)' },
    { avatarFileId: 'https://example.test/file', avatarUrl: 'https://example.test/avatar.png' },
    { avatarFileId: '', avatarUrl: 'https://example.test/avatar.png' },
  ]) {
    assert.throws(() => parseUserProfileResponse({ ok: true, profile: { ...profile, ...changes } }), error => code(error, 'INVALID_RESPONSE'), JSON.stringify(changes))
  }
  const avatar = { avatarFileId: 'cloud://env/user-avatar', avatarUrl: 'https://storage.example.test/avatar?signature=test' }
  assert.deepEqual(parseUserProfileResponse({ ok: true, profile: { ...profile, ...avatar } }), { ...profile, ...avatar })
})

test('avatar type detection rejects truncated signatures and non-image content', () => {
  assert.equal(avatarFormat(new Uint8Array(png)), 'png')
  assert.equal(avatarFormat(new Uint8Array([255, 216, 255, 217])), 'jpeg')
  for (const input of [new Uint8Array(), new Uint8Array([255, 216, 255]), new Uint8Array(png.subarray(0, 7)), new TextEncoder().encode('<svg />')]) {
    assert.throws(() => avatarFormat(input), error => code(error, 'INVALID_AVATAR'))
  }
})

type AvatarFixture = {
  sizes?: Record<string, number>
  bytes?: Uint8Array
  failRead?: boolean
  failCompression?: boolean
  compressedSize?: number
  width?: number
  height?: number
  failImageInfo?: boolean
}

function installAvatarApi(t: TestContext, options: AvatarFixture = {}) {
  const prior = (globalThis as any).uni
  const compressed: { src: string; compressedWidth: number; compressedHeight: number; quality: number }[] = []
  const readPaths: string[] = []
  const sizes = options.sizes || { '/selected.png': png.length }
  let reads = 0
  ;(globalThis as any).uni = {
    getImageInfo: ({ success, fail }: any) => options.failImageInfo ? fail({}) : success({ width: options.width ?? 32, height: options.height ?? 32 }),
    getFileInfo: ({ filePath, success, fail }: any) => {
      const size = sizes[filePath] ?? (filePath.startsWith('/compressed-') ? options.compressedSize ?? png.length : undefined)
      if (typeof size === 'number') success({ size })
      else fail({ errMsg: 'not found' })
    },
    compressImage: ({ src, compressedWidth, compressedHeight, quality, success, fail }: any) => {
      compressed.push({ src, compressedWidth, compressedHeight, quality })
      if (options.failCompression) fail({ errMsg: 'compression failed' })
      else success({ tempFilePath: `/compressed-${compressedWidth}.png` })
    },
    getFileSystemManager: () => ({ readFile: ({ filePath, success, fail }: any) => {
      reads++
      readPaths.push(filePath)
      if (options.failRead) fail({ errMsg: 'read failed' })
      else {
        const bytes = options.bytes || png
        success({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
      }
    } }),
    arrayBufferToBase64: (buffer: ArrayBuffer) => Buffer.from(buffer).toString('base64'),
  }
  t.after(() => {
    if (prior === undefined) delete (globalThis as any).uni
    else (globalThis as any).uni = prior
  })
  return { compressed, readPaths, reads: () => reads }
}

test('a valid small selected image preserves its bytes and does not invoke lossy compression', async t => {
  const api = installAvatarApi(t)
  const result = await prepareAvatarUpload('/selected.png')
  assert.deepEqual(result, { upload: { base64: png.toString('base64'), format: 'png' }, previewPath: '/selected.png' })
  assert.equal(api.compressed.length, 0)
  assert.equal(api.reads(), 1)
})

test('large selected image is compressed, then the actual compressed file is prepared for upload', async t => {
  const api = installAvatarApi(t, { sizes: { '/selected.png': MAX_AVATAR_BYTES + 1 } })
  const result = await prepareAvatarUpload('/selected.png')
  assert.notEqual(result.previewPath, '/selected.png')
  assert.equal(result.upload.base64, png.toString('base64'))
  assert.ok(api.compressed.length > 0)
  assert.ok(api.compressed.every(call => call.src === '/selected.png'))
  assert.deepEqual(api.readPaths, [result.previewPath])
})

test('missing or oversized selected files fail before any contents are read', async t => {
  const api = installAvatarApi(t, { sizes: { '/huge.png': 10 * 1024 * 1024 + 1, '/empty.png': 0 } })
  for (const path of ['', '/huge.png', '/empty.png']) {
    await assert.rejects(prepareAvatarUpload(path), error => code(error, 'INVALID_AVATAR'))
  }
  await assert.rejects(prepareAvatarUpload('/missing.png'), error => code(error, 'AVATAR_READ_FAILED'))
  assert.equal(api.reads(), 0)
  assert.equal(api.compressed.length, 0)
})

test('file size changing between metadata and reading cannot bypass upload size limit', async t => {
  installAvatarApi(t, { bytes: new Uint8Array(MAX_AVATAR_BYTES + 1) })
  await assert.rejects(prepareAvatarUpload('/selected.png'), error => code(error, 'AVATAR_TOO_LARGE'))
})

test('image that remains oversized after compression is rejected without sending its bytes', async t => {
  const api = installAvatarApi(t, { sizes: { '/selected.png': MAX_AVATAR_BYTES + 1 }, compressedSize: MAX_AVATAR_BYTES + 1 })
  await assert.rejects(prepareAvatarUpload('/selected.png'), error => code(error, 'AVATAR_TOO_LARGE'))
  assert.ok(api.compressed.length > 0)
  assert.equal(api.reads(), 0)
})

test('failed compression does not create a fake upload or preview result', async t => {
  const api = installAvatarApi(t, { sizes: { '/selected.png': MAX_AVATAR_BYTES + 1 }, failCompression: true })
  await assert.rejects(prepareAvatarUpload('/selected.png'), error => code(error, 'AVATAR_COMPRESS_FAILED'))
  assert.equal(api.reads(), 0)
})

test('failed local read reports a recoverable error rather than empty avatar bytes', async t => {
  installAvatarApi(t, { failRead: true })
  await assert.rejects(prepareAvatarUpload('/selected.png'), error => code(error, 'AVATAR_READ_FAILED'))
})


test('stored avatar without a usable signed URL still establishes login and preserves the reference for retry', () => {
  const value = { ...profile, avatarUploadEnabled: true, avatarFileId: 'cloud://env/users/me/avatars/saved.png', avatarUrl: '' }
  assert.deepEqual(parseUserProfileResponse({ ok: true, profile: value }), value)
})

test('a small compressed file with large image dimensions is resized before upload', async t => {
  const api = installAvatarApi(t, { width: 3000, height: 3000 })
  const result = await prepareAvatarUpload('/selected.png')
  assert.equal(result.previewPath, '/compressed-512.png')
  assert.equal(api.compressed.length, 1)
})

test('unreadable image metadata produces a useful selection error before reading or uploading', async t => {
  const api = installAvatarApi(t, { failImageInfo: true })
  await assert.rejects(prepareAvatarUpload('/selected.png'), error => code(error, 'INVALID_AVATAR'))
  assert.equal(api.reads(), 0)
  assert.equal(api.compressed.length, 0)
})

function profileState(read: () => Promise<any>, update = async (nickname: string) => ({ ...profile, nickname })) {
  const source = fs.readFileSync(new URL('../src/composables/useUserProfile.ts', import.meta.url), 'utf8')
  const module = { exports: {} as any }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2020' }).code, {
    module, exports: module.exports,
    uni: { setStorageSync: () => {} },
    require: (name: string) => {
      if (name === 'vue') return { computed, ref, onMounted: () => {}, onBeforeUnmount: () => {} }
      if (name === '@/services/user-profile') return {
        supportsWechatProfile: () => true, getOrCreateUserProfile: read,
        updateUserProfile: update, profileErrorMessage: (e: Error) => e.message,
      }
      throw new Error(`Unexpected import ${name}`)
    },
  })
  return module.exports.useUserProfile()
}

test('refreshing a signed avatar URL preserves the edited nickname, login and other profile fields', async () => {
  let count = 0
  const state = profileState(async () => ({ ...profile, nickname: ++count === 1 ? '原昵称' : '别处更改', avatarUploadEnabled: true,
    avatarFileId: 'cloud://env/avatar.png', avatarUrl: `https://storage.example.test/avatar?version=${count}` }))
  await state.login()
  const original = state.profile.value
  assert.equal(await state.refreshAvatar(), true)
  assert.equal(state.profile.value, original, 'do not replace the profile and trigger draft-reset watchers')
  assert.equal(state.profile.value.nickname, '原昵称')
  assert.equal(state.profile.value.avatarUrl, 'https://storage.example.test/avatar?version=2')
  assert.equal(state.refreshingAvatar.value, false)
})

test('a slow avatar refresh cannot restore login after logout or overwrite a newly saved avatar', async () => {
  for (const action of ['logout', 'save']) {
    let finish!: (value: any) => void
    let reads = 0
    const state = profileState(async () => ++reads === 1 ? { ...profile } : new Promise(resolve => { finish = resolve }))
    await state.login()
    const pending = state.refreshAvatar()
    assert.equal(state.refreshingAvatar.value, true)
    if (action === 'logout') state.logout()
    else assert.equal(await state.save('已保存昵称'), true)
    finish({ ...profile, avatarFileId: 'cloud://env/stale.png', avatarUrl: 'https://storage.example.test/stale.png' })
    assert.equal(await pending, false)
    assert.equal(state.refreshingAvatar.value, false)
    if (action === 'logout') assert.equal(state.profile.value, null)
    else {
      assert.equal(state.profile.value.nickname, '已保存昵称')
      assert.equal(state.profile.value.avatarFileId, '')
    }
  }
})

test('a failed avatar refresh keeps login usable and permits an explicit retry', async () => {
  let reads = 0
  const state = profileState(async () => { if (++reads === 2) throw new Error('network'); return { ...profile } })
  await state.login()
  assert.equal(await state.refreshAvatar(), false)
  assert.ok(state.profile.value)
  assert.equal(state.error.value, '')
  assert.equal(state.refreshingAvatar.value, false)
  await state.refreshAvatar()
  assert.equal(reads, 3)
})


test('portrait avatar compression keeps both dimensions within bounds and preserves the aspect ratio', async t => {
  const api = installAvatarApi(t, { width: 400, height: 4000 })
  await prepareAvatarUpload('/selected.png')
  assert.equal(api.compressed[0].compressedWidth, 51)
  assert.equal(api.compressed[0].compressedHeight, 512)
})
