import { callWechatCloudFunction } from './wechat-cloud'
import {
  avatarFormat, MAX_AVATAR_BYTES, parseUserProfileResponse, UserProfileError, validateNickname,
  type AvatarUpload, type UserProfile,
} from '@/domain/user'

export function supportsWechatProfile(): boolean {
  // #ifdef MP-WEIXIN
  return true
  // #endif
  // #ifndef MP-WEIXIN
  return false
  // #endif
}

function requireWechat(): void {
  if (!supportsWechatProfile()) {
    throw new UserProfileError('UNSUPPORTED_PLATFORM', '请在微信小程序中登录，网页预览暂不支持微信云登录。')
  }
}

export async function getOrCreateUserProfile(): Promise<UserProfile> {
  requireWechat()
  return parseUserProfileResponse(await callWechatCloudFunction<unknown>('userProfile', { action: 'getOrCreate' }))
}

export async function updateUserProfile(nickname: string, avatar?: AvatarUpload): Promise<UserProfile> {
  requireWechat()
  const data: Record<string, unknown> = { action: 'update', profile: { nickname: validateNickname(nickname) } }
  if (avatar) data.avatar = { base64: avatar.base64, format: avatar.format }
  return parseUserProfileResponse(await callWechatCloudFunction<unknown>('userProfile', data))
}

function fileSize(path: string): Promise<number> {
  return new Promise((resolve, reject) => uni.getFileInfo({
    filePath: path,
    success: result => resolve(result.size),
    fail: () => reject(new UserProfileError('AVATAR_READ_FAILED', '头像文件已失效或无法读取，请重新选择。')),
  }))
}

function imageDimensions(path: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => uni.getImageInfo({
    src: path,
    success: result => resolve({ width: result.width, height: result.height }),
    fail: () => reject(new UserProfileError('INVALID_AVATAR', '图片无法打开，请重新选择 JPG 或 PNG 头像。')),
  }))
}

function compressAvatar(path: string, width: number, height: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => uni.compressImage({
    src: path, compressedWidth: width, compressedHeight: height, quality,
    success: result => resolve(result.tempFilePath),
    fail: () => reject(new UserProfileError('AVATAR_COMPRESS_FAILED', '头像处理失败，请换一张 JPG 或 PNG 图片重试。')),
  }))
}

function readAvatar(path: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => uni.getFileSystemManager().readFile({
    filePath: path,
    success: result => {
      if (result.data instanceof ArrayBuffer) resolve(result.data)
      else reject(new UserProfileError('AVATAR_READ_FAILED', '头像读取失败，请重新选择。'))
    },
    fail: () => reject(new UserProfileError('AVATAR_READ_FAILED', '头像读取失败，请重新选择。')),
  }))
}

/** Prepare the selected local file; uploading and ownership checks belong to the cloud function. */
export async function prepareAvatarUpload(path: string): Promise<{ upload: AvatarUpload; previewPath: string }> {
  requireWechat()
  if (!path) throw new UserProfileError('INVALID_AVATAR', '没有取得头像，请重新选择。')
  const initialSize = await fileSize(path)
  if (!Number.isFinite(initialSize) || initialSize <= 0 || initialSize > 10 * 1024 * 1024) {
    throw new UserProfileError('INVALID_AVATAR', '请选择小于 10 MB 的 JPG 或 PNG 头像。')
  }
  const dimensions = await imageDimensions(path)
  const edge = Math.max(dimensions.width, dimensions.height)
  if (![dimensions.width, dimensions.height].every(value => Number.isFinite(value) && value > 0)) {
    throw new UserProfileError('INVALID_AVATAR', '图片尺寸无法读取，请重新选择头像。')
  }
  let needsResize = edge > 512
  let previewPath = path
  let size = initialSize
  for (const [width, quality] of [[512, 80], [384, 65], [256, 45]]) {
    if (size <= MAX_AVATAR_BYTES && !needsResize) break
    const ratio = Math.min(1, width / edge)
    previewPath = await compressAvatar(path, Math.max(1, Math.round(dimensions.width * ratio)), Math.max(1, Math.round(dimensions.height * ratio)), quality)
    size = await fileSize(previewPath)
    needsResize = false
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_AVATAR_BYTES) {
    throw new UserProfileError('AVATAR_TOO_LARGE', '头像压缩后仍然过大，请选择更小的图片。')
  }
  const contents = await readAvatar(previewPath)
  if (contents.byteLength > MAX_AVATAR_BYTES) {
    throw new UserProfileError('AVATAR_TOO_LARGE', '头像过大，请重新选择。')
  }
  return {
    upload: { base64: uni.arrayBufferToBase64(contents), format: avatarFormat(new Uint8Array(contents)) },
    previewPath,
  }
}

export function profileErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '网络或云服务暂时不可用，请检查网络后重试。'
}
