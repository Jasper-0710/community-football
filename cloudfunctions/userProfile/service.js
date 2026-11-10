'use strict'

const { createHash, randomUUID } = require('node:crypto')
const { inflateSync } = require('node:zlib')
const { PNG } = require('pngjs')
const jpegDecoder = require('jpeg-js')

const DEFAULT_APP_ID = 'wx3230f06c755cef3a'
const MAX_AVATAR_BYTES = 256 * 1024
const MAX_AVATAR_EDGE = 2048
const MAX_AVATAR_PIXELS = 4_000_000
const ROLES = new Set(['user', 'leader', 'admin'])

class ProfileError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function reject(code, message) {
  throw new ProfileError(code, message)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function onlyKeys(value, allowed) {
  return isObject(value) && Object.keys(value).every(key => allowed.includes(key))
}

function userId(appId, openId) {
  return createHash('sha256').update(`${appId}:${openId}`).digest('hex')
}

function checkImageDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || width > MAX_AVATAR_EDGE || height > MAX_AVATAR_EDGE || width * height > MAX_AVATAR_PIXELS) {
    reject('INVALID_AVATAR', '头像宽高不能超过2048像素，且总像素不能超过400万')
  }
}

function checkPngBeforeDecode(bytes) {
  // Read and bound IHDR before pngjs can allocate a bitmap or inflate IDAT.
  if (bytes.length < 33 || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    reject('INVALID_AVATAR', 'PNG头像结构不完整，请重新选择图片')
  }
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  checkImageDimensions(width, height)
  const depth = bytes[24], colorType = bytes[25], interlace = bytes[28]
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  const validDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }[colorType]
  if (!channels || !validDepths.includes(depth) || bytes[26] !== 0 || bytes[27] !== 0 || interlace > 1) {
    reject('INVALID_AVATAR', 'PNG头像格式不正确，请重新选择图片')
  }
  const idat = []
  let offset = 8, ended = false
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    if (length > bytes.length - offset - 12) reject('INVALID_AVATAR', 'PNG头像已损坏或被截断')
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    if (type === 'IHDR' && offset !== 8) reject('INVALID_AVATAR', 'PNG头像包含重复的图像头')
    if (type === 'IDAT') idat.push(bytes.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
    if (type === 'IEND') {
      if (length !== 0 || offset !== bytes.length) reject('INVALID_AVATAR', 'PNG头像结束标记不正确')
      ended = true
      break
    }
  }
  if (!ended || idat.length === 0) reject('INVALID_AVATAR', 'PNG头像缺少完整图像内容')

  // pngjs bounds normal images but its Adam7 inflate path has no output cap.
  // Independently bound the exact scanline size for both ordinary and Adam7 images.
  const passes = interlace === 1
    ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    : [[0, 0, 1, 1]]
  let expectedInflatedBytes = 0
  for (const [startX, startY, stepX, stepY] of passes) {
    const passWidth = width > startX ? Math.ceil((width - startX) / stepX) : 0
    const passHeight = height > startY ? Math.ceil((height - startY) / stepY) : 0
    if (passWidth && passHeight) expectedInflatedBytes += (Math.ceil(passWidth * channels * depth / 8) + 1) * passHeight
  }
  if (inflateSync(Buffer.concat(idat), { maxOutputLength: expectedInflatedBytes }).length !== expectedInflatedBytes) {
    reject('INVALID_AVATAR', 'PNG头像像素内容不完整')
  }
}

function validateAvatarImage(bytes, format) {
  try {
    let image
    if (format === 'png') {
      checkPngBeforeDecode(bytes)
      image = PNG.sync.read(bytes, { checkCRC: true })
    } else {
      if (bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) {
        reject('INVALID_AVATAR', 'JPEG头像已损坏或被截断')
      }
      image = jpegDecoder.decode(bytes, {
        useTArray: true,
        formatAsRGBA: true,
        tolerantDecoding: false,
        maxResolutionInMP: 4,
        maxMemoryUsageInMB: 32,
      })
    }
    checkImageDimensions(image.width, image.height)
    if (!image.data || image.data.length !== image.width * image.height * 4) {
      reject('INVALID_AVATAR', '头像像素内容不完整')
    }
  } catch (error) {
    if (error instanceof ProfileError) throw error
    reject('INVALID_AVATAR', '头像无法解码或超出处理限制，请重新选择有效的PNG或JPEG图片')
  }
}

function parseEvent(event) {
  // The verified WeChat callFunction event includes userInfo and tcbContext metadata.
  // Ignore both entirely: client-supplied metadata must never establish identity or environment.
  // Authentication uses cloud.getWXContext() below, and all business fields remain allowlisted.
  if (!onlyKeys(event, ['action', 'profile', 'avatar', 'userInfo', 'tcbContext'])) {
    reject('INVALID_ARGUMENT', '请求包含不支持的字段')
  }
  if (event.action === 'getOrCreate') {
    if (Object.keys(event).some(key => !['action', 'userInfo', 'tcbContext'].includes(key))) {
      reject('INVALID_ARGUMENT', '读取资料时不能提交修改字段')
    }
    return { action: event.action }
  }
  if (event.action !== 'update') reject('INVALID_ARGUMENT', '不支持的用户操作')
  if (!onlyKeys(event.profile, ['nickname']) || typeof event.profile.nickname !== 'string') {
    reject('INVALID_ARGUMENT', '只允许修改昵称及头像')
  }
  // Check before trimming so a hidden control character cannot be silently removed.
  if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(event.profile.nickname)) {
    reject('INVALID_NICKNAME', '昵称不能包含控制字符')
  }
  const nickname = event.profile.nickname.trim()
  if (Array.from(nickname).length < 1 || Array.from(nickname).length > 30) {
    reject('INVALID_NICKNAME', '昵称需为1至30个字符')
  }
  let avatar
  if (Object.prototype.hasOwnProperty.call(event, 'avatar')) {
    const input = event.avatar
    if (!onlyKeys(input, ['base64', 'format']) || !['jpeg', 'png'].includes(input.format)
      || typeof input.base64 !== 'string' || input.base64.length === 0
      || input.base64.length > Math.ceil(MAX_AVATAR_BYTES / 3) * 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) {
      reject('INVALID_AVATAR', '头像需为不超过256KiB的PNG或JPEG图片')
    }
    const bytes = Buffer.from(input.base64, 'base64')
    if (bytes.length > MAX_AVATAR_BYTES || bytes.toString('base64') !== input.base64) {
      reject('INVALID_AVATAR', '头像编码或文件大小不正确')
    }
    const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    if ((input.format === 'png' && !png) || (input.format === 'jpeg' && !jpeg)) {
      reject('INVALID_AVATAR', '头像内容与图片格式不一致')
    }
    validateAvatarImage(bytes, input.format)
    avatar = { bytes, format: input.format }
  }
  return { action: event.action, nickname, avatar }
}

function assertStoredProfile(profile, appId, openId) {
  if (!profile || profile.appId !== appId || profile.openId !== openId || !ROLES.has(profile.role)
    || typeof profile.nickname !== 'string' || typeof profile.avatarFileId !== 'string'
    || typeof profile.createdAt !== 'string' || typeof profile.updatedAt !== 'string') {
    reject('PROFILE_UNAVAILABLE', '用户资料暂不可用，请联系管理员')
  }
}

function createUserProfileHandler({ cloud, expectedAppId = DEFAULT_APP_ID, avatarUploadEnabled = false, now = () => new Date(), fileToken = randomUUID, logger = console }) {
  // Deployment-only capability: request fields can neither enable nor override it.
  const canUploadAvatar = avatarUploadEnabled === true
  async function avatarUrl(fileID) {
    if (!fileID) return ''
    // Client storage access remains closed: only the trusted function signs the caller's avatar.
    const result = await cloud.getTempFileURL({ fileList: [{ fileID, maxAge: 600 }] })
    const file = result && Array.isArray(result.fileList) && result.fileList.find(item => item.fileID === fileID)
    if (!file || file.status !== 0 || typeof file.tempFileURL !== 'string' || !file.tempFileURL.startsWith('https://')) {
      throw new Error('Avatar URL unavailable')
    }
    return file.tempFileURL
  }

  return async function userProfile(event) {
    try {
      const context = cloud.getWXContext()
      if (!context || typeof context.OPENID !== 'string' || !context.OPENID
        || typeof context.APPID !== 'string' || !context.APPID) {
        reject('AUTH_REQUIRED', '请在微信小程序中登录后重试')
      }
      if (typeof expectedAppId !== 'string' || !expectedAppId || context.APPID !== expectedAppId) {
        reject('APP_MISMATCH', '当前小程序不能访问此用户服务')
      }
      if (!canUploadAvatar && isObject(event) && Object.prototype.hasOwnProperty.call(event, 'avatar')) {
        reject('AVATAR_UNAVAILABLE', '头像功能暂未开放，请先保存昵称')
      }
      const input = parseEvent(event)
      const id = userId(context.APPID, context.OPENID)
      let uploadedFileId = ''
      let uploadedAvatarUrl = ''
      if (input.avatar) {
        const uploaded = await cloud.uploadFile({
          cloudPath: `users/${id}/avatars/${fileToken()}.${input.avatar.format === 'jpeg' ? 'jpg' : 'png'}`,
          fileContent: input.avatar.bytes,
        })
        if (!uploaded || typeof uploaded.fileID !== 'string' || !uploaded.fileID.startsWith('cloud://')) {
          throw new Error('Avatar upload unavailable')
        }
        uploadedFileId = uploaded.fileID
        // Verify access before persisting a newly uploaded avatar reference.
        uploadedAvatarUrl = await avatarUrl(uploadedFileId)
      }

      // In wx-server-sdk, a missing document is null only with throwOnNotFound:false.
      // A missing collection or any cloud error still rejects and must not create a fake user.
      const db = cloud.database({ throwOnNotFound: false })
      const saved = await db.runTransaction(async transaction => {
        const document = transaction.collection('users').doc(id)
        const result = await document.get()
        const existing = result.data
        if (existing !== null && existing !== undefined) {
          assertStoredProfile(existing, context.APPID, context.OPENID)
          if (input.action === 'getOrCreate') return existing
          const changes = { nickname: input.nickname, updatedAt: now().toISOString() }
          if (uploadedFileId) changes.avatarFileId = uploadedFileId
          await document.update({ data: changes })
          return { ...existing, ...changes }
        }
        const timestamp = now().toISOString()
        const profile = {
          appId: context.APPID,
          openId: context.OPENID,
          nickname: input.action === 'update' ? input.nickname : '',
          avatarFileId: uploadedFileId,
          role: 'user',
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        await document.set({ data: profile })
        return profile
      })

      let signedAvatarUrl = ''
      if (canUploadAvatar) {
        if (uploadedFileId && saved.avatarFileId === uploadedFileId) signedAvatarUrl = uploadedAvatarUrl
        else {
          // A removed image or a temporary signing failure must not prevent login or nickname changes.
          // Keep the stored reference so a later read can recover without replacing the user's avatar.
          try { signedAvatarUrl = await avatarUrl(saved.avatarFileId) }
          catch { if (logger && typeof logger.error === 'function') logger.error('[userProfile] saved avatar unavailable') }
        }
      }
      return {
        ok: true,
        profile: {
          id,
          nickname: saved.nickname,
          avatarFileId: canUploadAvatar ? saved.avatarFileId : '',
          avatarUrl: signedAvatarUrl,
          avatarUploadEnabled: canUploadAvatar,
          role: saved.role,
          createdAt: saved.createdAt,
          updatedAt: saved.updatedAt,
        },
      }
    } catch (error) {
      if (error instanceof ProfileError) return { ok: false, error: { code: error.code, message: error.message } }
      // Never log the event, identity, profile, signed URL or SDK error text.
      if (logger && typeof logger.error === 'function') logger.error('[userProfile] cloud operation failed')
      return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '用户服务暂不可用，请重试；保存状态以重新读取的资料为准' } }
    }
  }
}

module.exports = { createUserProfileHandler, DEFAULT_APP_ID, MAX_AVATAR_BYTES, userId }
