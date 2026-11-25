'use strict'
const schema = require('./platform-settings-schema.json')
const { createImageModel } = require('./news-image-model')
const { createNewsImageService } = require('./news-images')
const object = v => v && typeof v === 'object' && !Array.isArray(v)
const keys = (v, allowed) => object(v) && Object.keys(v).every(k => allowed.includes(k))
const text = (v, max, required = false) => typeof v === 'string' && v.trim() === v && (!required || !!v) && Array.from(v).length <= max && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(v)
const imagePattern = /^pi_[a-f0-9]{32}$/
function target(v, allowNone, required) {
  if (!keys(v, ['kind','appId','path','url']) || !(allowNone ? ['none','miniProgram','https'] : ['miniProgram','https']).includes(v.kind) || !text(v.appId,18) || !text(v.path,1024) || !text(v.url,2000)) return false
  if (v.appId && !new RegExp(schema.externalRules.appId).test(v.appId) || v.path && !new RegExp(schema.externalRules.path).test(v.path) || v.url && (!new RegExp(schema.externalRules.https,'i').test(v.url) || /^https:\/\/(?:[^/?#]+\.)?(?:localhost|local)(?::|\/|\?|#|$)/i.test(v.url))) return false
  if (v.kind === 'none') return !v.appId && !v.path && !v.url
  if (v.kind === 'miniProgram') return !v.url && (!required || !!v.appId)
  return !v.appId && !v.path && (!required || !!v.url)
}
function validateExternal(v = schema.defaults.external) {
  const invalid = () => { const e = new Error('请检查社区入口、投保专栏及跳转目标；启用社区须填写目标，启用投保专栏须至少上传一张图片。'); e.code = 'INVALID_ARGUMENT'; throw e }
  if (!keys(v,['community','insurance'])) return invalid()
  const c = v.community, i = v.insurance
  if (!keys(c,['enabled','label','description','target']) || typeof c.enabled !== 'boolean' || !text(c.label,12,true) || !text(c.description,100) || !target(c.target,false,c.enabled)) return invalid()
  if (!keys(i,['enabled','title','description','buttonLabel','target','images']) || typeof i.enabled !== 'boolean' || !text(i.title,20,true) || !text(i.description,200) || !text(i.buttonLabel,12,true) || !target(i.target,true,i.enabled) || !Array.isArray(i.images) || i.images.length > 6 || i.enabled && !i.images.length || i.images.some(x => !keys(x,['imageId','caption']) || !imagePattern.test(x.imageId) || !text(x.caption,100)) || new Set(i.images.map(x => x.imageId)).size !== i.images.length) return invalid()
  return { community:{enabled:c.enabled,label:c.label,description:c.description,target:{...c.target}}, insurance:{enabled:i.enabled,title:i.title,description:i.description,buttonLabel:i.buttonLabel,target:{...i.target},images:i.images.map(x=>({imageId:x.imageId,caption:x.caption}))} }
}
const model = createImageModel({imagePattern,ownerPattern:/^primary$/,ownerKey:'settingsId',collection:'platformImages',pathPrefix:'platform-images',ids:record=>record?.form?.external?.insurance?.images?.map(x=>x.imageId)||[],referenceMessage:'图片不存在、已过期或不属于平台设置，请重新上传。'})
function createPlatformImageService(options) {
  return createNewsImageService({...options,model,prefix:'settings.images',imageCollection:'platformImages',ownerCollection:'platformSettings',ownerKey:'settingsId',idPrefix:'pi',pathPrefix:'platform-images'})
}
module.exports = { validateExternal, model, createPlatformImageService }
