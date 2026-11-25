import schema from './platform-settings-schema.json'
import { safeContentImage } from './content'

export interface ExternalTarget { kind: 'none' | 'miniProgram' | 'https'; appId: string; path: string; url: string }
export interface ExternalEntries {
  community: { enabled: boolean; label: string; description: string; target: ExternalTarget }
  insurance: { enabled: boolean; title: string; description: string; buttonLabel: string; target: ExternalTarget; images: { imageId: string; caption: string }[] }
}
export interface PlatformDisplayImage { id: string; url: string; width: number; height: number }
export interface PlatformUploadedImage extends PlatformDisplayImage { settingsId: 'primary'; name: string; size: number; mime: 'image/png' | 'image/jpeg' }
export const PLATFORM_IMAGE_LIMIT = 6
const object = (v: any) => v && typeof v === 'object' && !Array.isArray(v)
const keys = (v: any, allowed: string[]) => object(v) && Object.keys(v).every(k => allowed.includes(k))
const text = (v: any, max: number, required = false) => typeof v === 'string' && v.trim() === v && (!required || !!v) && Array.from(v).length <= max && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(v)
export const platformImageId = (v: unknown): v is string => typeof v === 'string' && /^pi_[a-f0-9]{32}$/.test(v)
export function safeExternalUrl(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 2000 && new RegExp(schema.externalRules.https, 'i').test(v) && !/^https:\/\/(?:[^/?#]+\.)?(?:localhost|local)(?::|\/|\?|#|$)/i.test(v)
}
export function validExternalTarget(v: any, allowNone: boolean, required: boolean): v is ExternalTarget {
  if (!keys(v, ['kind', 'appId', 'path', 'url']) || !(allowNone ? ['none', 'miniProgram', 'https'] : ['miniProgram', 'https']).includes(v.kind) || !text(v.appId, 18) || !text(v.path, 1024) || !text(v.url, 2000)) return false
  if (v.appId && !new RegExp(schema.externalRules.appId).test(v.appId) || v.path && !new RegExp(schema.externalRules.path).test(v.path) || v.url && !safeExternalUrl(v.url)) return false
  if (v.kind === 'none') return !v.appId && !v.path && !v.url
  if (v.kind === 'miniProgram') return !v.url && (!required || !!v.appId)
  return !v.appId && !v.path && (!required || !!v.url)
}
export function parseExternalEntries(v: any = schema.defaults.external): ExternalEntries {
  const invalid = (): never => { throw new Error('请检查社区入口、投保专栏及跳转目标；启用社区须填写目标，启用投保专栏须至少上传一张图片。') }
  if (!keys(v, ['community', 'insurance'])) return invalid()
  const c = v.community, i = v.insurance
  if (!keys(c, ['enabled', 'label', 'description', 'target']) || typeof c.enabled !== 'boolean' || !text(c.label, 12, true) || !text(c.description, 100) || !validExternalTarget(c.target, false, c.enabled)) return invalid()
  if (!keys(i, ['enabled', 'title', 'description', 'buttonLabel', 'target', 'images']) || typeof i.enabled !== 'boolean' || !text(i.title, 20, true) || !text(i.description, 200) || !text(i.buttonLabel, 12, true) || !validExternalTarget(i.target, true, i.enabled) || !Array.isArray(i.images) || i.images.length > PLATFORM_IMAGE_LIMIT || i.enabled && !i.images.length || i.images.some((x: any) => !keys(x, ['imageId', 'caption']) || !platformImageId(x.imageId) || !text(x.caption, 100)) || new Set(i.images.map((x: any) => x.imageId)).size !== i.images.length) return invalid()
  return { community: { enabled: c.enabled, label: c.label, description: c.description, target: { ...c.target } }, insurance: { enabled: i.enabled, title: i.title, description: i.description, buttonLabel: i.buttonLabel, target: { ...i.target }, images: i.images.map((x: any) => ({ imageId: x.imageId, caption: x.caption })) } }
}
export function parsePlatformDisplayImage(v: any): PlatformDisplayImage {
  if (!object(v) || !platformImageId(v.id) || !safeContentImage(v.url) || !Number.isSafeInteger(v.width) || !Number.isSafeInteger(v.height) || v.width < 1 || v.height < 1 || v.width > 4096 || v.height > 4096 || v.width * v.height > 8_000_000) throw new Error('投保图片返回异常，请重新读取。')
  return { id: v.id, url: v.url, width: v.width, height: v.height }
}
export function parsePlatformUploadedImage(v: any): PlatformUploadedImage {
  const image = parsePlatformDisplayImage(v)
  if (v.settingsId !== 'primary' || !text(v.name, 120, true) || !Number.isSafeInteger(v.size) || v.size < 1 || v.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg'].includes(v.mime)) throw new Error('投保图片上传回执异常，请重试。')
  return { ...image, settingsId: 'primary', name: v.name, size: v.size, mime: v.mime }
}
