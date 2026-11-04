export const MAX_NICKNAME_LENGTH = 30
export const MAX_AVATAR_BYTES = 256 * 1024

export interface UserProfile {
  id: string
  nickname: string
  avatarFileId: string
  avatarUrl: string
  avatarUploadEnabled: boolean
  role: 'user' | 'leader' | 'admin'
  createdAt: string
  updatedAt: string
}

export interface AvatarUpload {
  base64: string
  format: 'jpeg' | 'png'
}

export class UserProfileError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'UserProfileError'
  }
}

export function validateNickname(value: string): string {
  if (typeof value !== 'string') throw new UserProfileError('INVALID_NICKNAME', '请填写有效昵称。')
  // Match the cloud contract before trimming; hidden characters cannot disappear silently.
  if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)) {
    throw new UserProfileError('INVALID_NICKNAME', '昵称不能包含换行或控制字符。')
  }
  const nickname = value.trim()
  if (!nickname) throw new UserProfileError('INVALID_NICKNAME', '请填写昵称。')
  if (Array.from(nickname).length > MAX_NICKNAME_LENGTH) {
    throw new UserProfileError('INVALID_NICKNAME', `昵称最多 ${MAX_NICKNAME_LENGTH} 个字。`)
  }
  return nickname
}

/** Treat only a successful, complete server response as an authenticated profile. */
export function parseUserProfileResponse(value: unknown): UserProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UserProfileError('INVALID_RESPONSE', '个人资料返回异常，请重试。')
  }
  const response = value as Record<string, unknown>
  if (response.ok === false) {
    const error = response.error as { code?: unknown; message?: unknown } | undefined
    throw new UserProfileError(
      typeof error?.code === 'string' && error.code.trim() ? error.code.trim() : 'PROFILE_FAILED',
      typeof error?.message === 'string' && error.message.trim() ? error.message.trim() : '个人资料操作失败，请重试。',
    )
  }
  const profile = response.profile as Record<string, unknown> | undefined
  if (response.ok !== true || !profile || typeof profile !== 'object' || Array.isArray(profile)
    || typeof profile.id !== 'string' || !/^[a-f0-9]{64}$/.test(profile.id)
    || typeof profile.nickname !== 'string'
    || typeof profile.avatarFileId !== 'string'
    || typeof profile.avatarUrl !== 'string'
    || typeof profile.avatarUploadEnabled !== 'boolean'
    || typeof profile.role !== 'string' || !['user', 'leader', 'admin'].includes(profile.role)
    || typeof profile.createdAt !== 'string' || !Number.isFinite(Date.parse(profile.createdAt))
    || typeof profile.updatedAt !== 'string' || !Number.isFinite(Date.parse(profile.updatedAt))) {
    throw new UserProfileError('INVALID_RESPONSE', '个人资料返回不完整，请重试。')
  }
  try {
    // An empty nickname is valid only for a newly created profile.
    if (profile.nickname !== '' && validateNickname(profile.nickname) !== profile.nickname) throw new Error('Untrimmed nickname')
    if (profile.avatarFileId && !/^cloud:\/\/[^\s]+$/.test(profile.avatarFileId)) throw new Error('Invalid avatar file')
    if (profile.avatarUrl && !/^https:\/\/[^\s]+$/.test(profile.avatarUrl)) throw new Error('Invalid avatar URL')
    if (Boolean(profile.avatarFileId) !== Boolean(profile.avatarUrl)) throw new Error('Incomplete avatar')
  } catch {
    throw new UserProfileError('INVALID_RESPONSE', '个人资料返回异常，请重试。')
  }
  return {
    id: profile.id,
    nickname: profile.nickname,
    avatarFileId: profile.avatarFileId,
    avatarUrl: profile.avatarUrl,
    avatarUploadEnabled: profile.avatarUploadEnabled,
    role: profile.role as UserProfile['role'],
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }
}

export function avatarFormat(bytes: Uint8Array): AvatarUpload['format'] {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (png.every((value, index) => bytes[index] === value)) return 'png'
  throw new UserProfileError('INVALID_AVATAR', '头像仅支持 JPG 或 PNG 图片，请重新选择。')
}
