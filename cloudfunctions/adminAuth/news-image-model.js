'use strict'
const IMAGE_ID = /^ni_[a-f0-9]{32}$/
const ARTICLE_ID = /^n_[a-f0-9]{32}$/
// Base64 plus JSON must fit the HTTP gateway's request body limit.
const MAX_BYTES = 2 * 1024 * 1024, CHUNK = 64 * 1024, TTL = 24 * 3600000, LEASE = 10 * 60000
class NewsImageError extends Error { constructor(code, message) { super(message); this.code = code } }
const fail = (code, message) => { throw new NewsImageError(code, message) }
function imageIds(record) {
  return [...new Set([record?.coverImageId, ...(record?.body || []).filter(b => b.type === 'image').map(b => b.imageId)].filter(Boolean))]
}
async function syncImageReferences(tx, articleId, previous, next, now) {
  const before = imageIds(previous), after = next?.deletedAt ? [] : imageIds(next)
  // Each image belongs to one article. Binding and cleanup both read/write the
  // same image record inside the article transaction, preventing deletion races.
  for (const id of new Set([...before, ...after])) {
    const file = await tx.get('newsImages', id), referenced = after.includes(id)
    if (referenced && (!file || file.articleId !== articleId || file.status !== 'ready' || !file.referenced && file.expiresAt <= now)) fail('INVALID_ARGUMENT', '图片不存在、已过期或不属于这篇内容，请重新上传。')
    if (!file || file.articleId !== articleId) { if (referenced) fail('INVALID_ARGUMENT', '图片关联无效。'); continue }
    await tx.set('newsImages', id, { ...file, referenced, expiresAt: referenced ? null : now + TTL, updatedAt: now })
  }
}
function scopedObject(file, object, storage) {
  if (!IMAGE_ID.test(file?._id) || !ARTICLE_ID.test(file.articleId) || typeof object?.fileID !== 'string') return false
  const path = storage.path(object.fileID)
  if (!path || path !== object.cloudPath) return false
  return new RegExp(`^news-images/staging/${file._id}/\\d{1,2}-[a-f0-9]{64}$`).test(path) || new RegExp(`^news-images/files/${file._id}/[a-f0-9]{48}\\.(png|jpg)$`).test(path)
}
function inventory(file) { const removed = new Set(file.removedFileIDs || []); return (file.objects || []).filter(o => !removed.has(o.fileID)) }
// Live updates share the proven upload lifecycle, with their own IDs, owners,
// collection and storage scope. News defaults and existing records stay intact.
function createImageModel({ imagePattern, ownerPattern, ownerKey, collection, pathPrefix, ids }) {
  return {
    IMAGE_ID: imagePattern, ARTICLE_ID: ownerPattern, MAX_BYTES, CHUNK, TTL, LEASE, NewsImageError, fail, inventory, imageIds: ids,
    scopedObject(file, object, storage) {
      if (!imagePattern.test(file?._id) || !ownerPattern.test(file[ownerKey]) || typeof object?.fileID !== 'string') return false
      const path = storage.path(object.fileID)
      if (!path || path !== object.cloudPath) return false
      return new RegExp(`^${pathPrefix}/staging/${file._id}/\\d{1,2}-[a-f0-9]{64}$`).test(path) || new RegExp(`^${pathPrefix}/files/${file._id}/[a-f0-9]{48}\\.(png|jpg)$`).test(path)
    },
    async syncImageReferences(tx, owner, previous, next, now) {
      const before = ids(previous), after = next?.deletedAt ? [] : ids(next)
      for (const id of new Set([...before, ...after])) {
        const file = await tx.get(collection, id), referenced = after.includes(id)
        if (referenced && (!file || file[ownerKey] !== owner || file.status !== 'ready' || !file.referenced && file.expiresAt <= now)) fail('INVALID_ARGUMENT', '图片不存在、已过期或不属于这条直播，请重新上传。')
        if (!file || file[ownerKey] !== owner) continue
        await tx.set(collection, id, { ...file, referenced, expiresAt: referenced ? null : now + TTL, updatedAt: now })
      }
    },
  }
}
module.exports = { IMAGE_ID, ARTICLE_ID, MAX_BYTES, CHUNK, TTL, LEASE, NewsImageError, fail, imageIds, syncImageReferences, scopedObject, inventory, createImageModel }
