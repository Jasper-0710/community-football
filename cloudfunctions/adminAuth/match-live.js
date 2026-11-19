'use strict'
const { createHash } = require('node:crypto')
const { model: M } = require('./match-live-images')
const PUBLIC_ACTIONS = ['live.listPublic']
const ACTIONS = [...PUBLIC_ACTIONS, 'live.listAdmin', 'live.publish', 'live.correct', 'live.delete']
const MATCH_ID = /^m_[a-f0-9]{32}$/, ENTRY_ID = /^l_[a-f0-9]{32}$/, REQUEST_ID = /^[a-f0-9]{32}$/
class LiveError extends Error { constructor(code, message) { super(message); this.code = code } }
const fail = (code, message) => { throw new LiveError(code, message) }
const object = value => !!value && typeof value === 'object' && !Array.isArray(value)
function fields(value, allowed) { if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_ARGUMENT', '直播请求包含不支持的字段。') }
function text(value, max) {
  if (typeof value !== 'string' || Array.from(value.trim()).length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail('INVALID_ARGUMENT', '直播文字过长或包含无效字符。')
  return value.trim()
}
function url(value) {
  const out = text(value, 500)
  try { const u = new URL(out); if (u.protocol !== 'https:' || u.username || u.password || u.hash) throw new Error() } catch { fail('INVALID_ARGUMENT', '图片须使用有效的HTTPS地址。') }
  return out
}
function validateForm(value) {
  fields(value, ['text', 'minute', 'images'])
  if (value.minute !== null && (!Number.isSafeInteger(value.minute) || value.minute < 0 || value.minute > 150) || !Array.isArray(value.images) || value.images.length > 4) fail('INVALID_ARGUMENT', '比赛分钟应为0–150，图片最多4张。')
  const images = value.images.map(image => {
    fields(image, ['imageId', 'url', 'caption'])
    if (image.imageId != null && (typeof image.imageId !== 'string' || !M.IMAGE_ID.test(image.imageId))) fail('INVALID_ARGUMENT', '直播图片标识无效。')
    return { imageId: image.imageId || null, url: image.imageId ? '' : url(image.url), caption: text(image.caption, 100) }
  })
  if (new Set(images.filter(i => i.imageId).map(i => i.imageId)).size !== images.filter(i => i.imageId).length) fail('INVALID_ARGUMENT', '同一张上传图片不能重复添加。')
  const form = { text: text(value.text, 1000), minute: value.minute, images }
  if (!form.text && !images.length) fail('INVALID_ARGUMENT', '请填写直播文字或添加图片。')
  return form
}
const compare = (a, b) => b.createdAt - a.createdAt || (a._id < b._id ? 1 : a._id > b._id ? -1 : 0)
function cursor(value, matchId) {
  if (value == null) return null
  try {
    if (typeof value !== 'string' || value.length > 300 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error()
    const c = JSON.parse(Buffer.from(value, 'base64url').toString())
    if (!Array.isArray(c) || c.length !== 3 || c[0] !== matchId || !Number.isSafeInteger(c[1]) || c[1] < 0 || !ENTRY_ID.test(c[2])) throw new Error()
    return { createdAt: c[1], _id: c[2] }
  } catch { fail('INVALID_ARGUMENT', '直播分页已失效，请刷新。') }
}
function createLiveService({ store, storage, authorize, now = Date.now, logger = console }) {
  async function matchScope(reader, matchId, publicOnly) {
    const match = await reader('matches', matchId)
    const competition = match ? await reader('competitions', match.competitionId) : null
    if (!match || !competition || publicOnly && (competition.displayEnabled !== true || !['scheduled', 'postponed', 'live', 'finished'].includes(match.status))) fail('NOT_FOUND', '比赛不存在或暂未公开。')
    return match
  }
  async function present(record, admin) {
    const images = []
    for (const image of record.images) {
      let imageUrl = image.url
      if (image.imageId) {
        const file = await store.read('matchLiveImages', image.imageId)
        if (!file || file.entryId !== record._id || file.status !== 'ready' || !file.referenced || !M.inventory(file).some(o => o.fileID === file.fileID && M.scopedObject(file, o, storage))) throw new Error('Live image unavailable')
        imageUrl = await storage.link(file.fileID)
        const u = new URL(imageUrl)
        if (imageUrl.length > 2000 || u.protocol !== 'https:' || u.username || u.password || u.hash) throw new Error('Invalid live image URL')
      }
      images.push({ url: imageUrl, caption: image.caption, ...(admin ? { imageId: image.imageId } : {}) })
    }
    return { id: record._id, matchId: record.matchId, text: record.text, minute: record.minute, images, createdAt: new Date(record.createdAt).toISOString(), updatedAt: new Date(record.updatedAt).toISOString(), corrected: record.version > 1, ...(admin ? { version: record.version } : {}) }
  }
  return async event => {
    try {
      if (!object(event) || !ACTIONS.includes(event.action)) fail('INVALID_ARGUMENT', '不支持的直播操作。')
      const publicOnly = PUBLIC_ACTIONS.includes(event.action), listing = ['live.listPublic', 'live.listAdmin'].includes(event.action)
      if (!publicOnly) { const auth = await authorize(event.token); if (!auth.ok) return auth }
      fields(event, ['action', 'token', 'userInfo', 'tcbContext', 'matchId', ...(listing ? ['cursor'] : event.action === 'live.publish' ? ['requestId', 'form'] : ['id', 'expectedVersion', 'requestId', ...(event.action === 'live.correct' ? ['form'] : [])])])
      if (typeof event.matchId !== 'string' || !MATCH_ID.test(event.matchId)) fail('INVALID_ARGUMENT', '请选择有效的比赛。')
      if (listing) {
        const after = cursor(event.cursor, event.matchId)
        await matchScope(store.read, event.matchId, publicOnly)
        const rows = (await store.liveEntries(event.matchId)).filter(row => !row.deletedAt && (!after || compare(row, after) > 0)).sort(compare)
        const selected = rows.slice(0, 20), last = selected.at(-1)
        const entries = await Promise.all(selected.map(record => present(record, !publicOnly)))
        // Recheck visibility after resolving links; hidden matches never become an empty public feed.
        await matchScope(store.read, event.matchId, publicOnly)
        return { ok: true, entries, nextCursor: rows.length > 20 ? Buffer.from(JSON.stringify([event.matchId, last.createdAt, last._id])).toString('base64url') : null }
      }
      if (typeof event.requestId !== 'string' || !REQUEST_ID.test(event.requestId) || event.action !== 'live.publish' && (typeof event.id !== 'string' || !ENTRY_ID.test(event.id) || !Number.isSafeInteger(event.expectedVersion) || event.expectedVersion < 1)) fail('INVALID_ARGUMENT', '直播标识或版本无效，请重新读取。')
      const id = event.action === 'live.publish' ? `l_${event.requestId}` : event.id
      const form = event.action === 'live.delete' ? null : validateForm(event.form)
      const fingerprint = createHash('sha256').update(JSON.stringify([event.action, event.matchId, event.expectedVersion ?? null, form])).digest('hex')
      const record = await store.atomic(async tx => {
        const match = await matchScope(tx.get, event.matchId, false)
        const previous = await tx.get('matchLiveEntries', id)
        if (event.action === 'live.publish' && previous) {
          if (previous.creationFingerprint !== fingerprint || previous.deletedAt) fail('CONFLICT', '本次发布请求已使用，请重新读取。')
          return previous
        }
        if (event.action !== 'live.publish') {
          if (!previous || previous.matchId !== event.matchId) fail('NOT_FOUND', '直播记录不存在。')
          const retry = previous.mutations?.find(m => m.id === event.requestId)
          if (retry) { if (retry.fingerprint !== fingerprint || retry.version !== previous.version) fail('CONFLICT', '本次请求已使用或记录已再次变化。'); return previous }
          if (previous.deletedAt) fail('NOT_FOUND', '直播已删除。')
          if (previous.version !== event.expectedVersion) fail('CONFLICT', '直播已被其他管理员修改，请重新读取后编辑。')
        }
        const time = now(), version = (previous?.version || 0) + 1
        const next = { ...previous, ...form, _id: id, matchId: event.matchId, competitionId: match.competitionId, version, createdAt: previous?.createdAt ?? time, updatedAt: time, deletedAt: event.action === 'live.delete' ? time : null, creationFingerprint: previous?.creationFingerprint || fingerprint, mutations: [...(previous?.mutations || []).slice(-19), { id: event.requestId, fingerprint, version }] }
        await M.syncImageReferences(tx, id, previous, next, time)
        await tx.set('matchLiveEntries', id, next)
        return next
      })
      if (event.action === 'live.delete') return { ok: true }
      try { return { ok: true, entry: await present(record, true) } }
      catch { fail('WRITE_COMMITTED', '直播已保存，但图片链接暂不可用。请重新读取列表，勿重复发布。') }
    } catch (error) {
      if (error instanceof LiveError || error instanceof M.NewsImageError) return { ok: false, error: { code: error.code, message: error.message } }
      logger?.error?.('[matchLive] operation failed')
      return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '直播服务暂不可用，请刷新确认最新结果后重试。' } }
    }
  }
}
module.exports = { createLiveService, PUBLIC_ACTIONS, validateForm }
