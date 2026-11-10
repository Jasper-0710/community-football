'use strict'

const UPLOAD_LEASE = 10 * 60 * 1000
const MAX_OBJECTS = 128
const FINAL_PATH = /^registration-materials\/[a-f0-9]{48}\.(pdf|png|jpg|jpeg|docx|xlsx)$/

// The adapter rejects another environment even if a registry record is malformed.
function createStorageAdapter(cloud, environment, metadataClient) {
  function path(fileID) {
    if (typeof environment !== 'string' || !environment || typeof fileID !== 'string') return null
    const match = /^cloud:\/\/([^/]+)\/(.+)$/.exec(fileID)
    return match && (match[1] === environment || match[1].startsWith(environment + '.')) ? match[2] : null
  }
  return {
    path,
    async prepare(cloudPath) {
      const result = await metadataClient.getUploadMetadata({ cloudPath })
      const fileID = result?.data?.fileId
      if (path(fileID) !== cloudPath) throw new Error('Unable to reserve storage object')
      return fileID
    },
    async upload(cloudPath, fileContent) { return (await cloud.uploadFile({ cloudPath, fileContent })).fileID },
    async download(fileID) { return (await cloud.downloadFile({ fileID })).fileContent },
    async remove(fileList) {
      const result = await cloud.deleteFile({ fileList })
      return (result.fileList || []).filter(f => fileList.includes(f.fileID) && (f.status === 0 || f.status === -503003)).map(f => f.fileID)
    },
    async link(fileID) {
      const result = await cloud.getTempFileURL({ fileList: [{ fileID, maxAge: 300 }] })
      const file = result.fileList?.[0]
      if (!file?.tempFileURL || file.status !== 0) throw new Error('Download unavailable')
      return file.tempFileURL
    },
  }
}

function scopedObject(file, object, storage) {
  if (!/^[a-f0-9]{64}$/.test(file.ownerUserId) || !/^f_[a-f0-9]{32}$/.test(file._id)) return false
  const path = storage.path(object.fileID)
  if (!path || (object.cloudPath && object.cloudPath !== path)) return false
  if (FINAL_PATH.test(path)) return true
  const prefix = `registration-staging/${file.ownerUserId}/${file._id}/`
  return path.startsWith(prefix) && /^\d{1,2}-[a-f0-9]{64}$/.test(path.slice(prefix.length))
}

function inventory(file) {
  const objects = new Map()
  for (const object of file.storageObjects || []) {
    if (object?.fileID) objects.set(object.fileID, { ...object })
  }
  for (const object of [...(file.chunks || []).filter(Boolean), ...(file.fileID ? [{ fileID: file.fileID }] : [])]) {
    if (!objects.has(object.fileID)) objects.set(object.fileID, { fileID: object.fileID, leaseUntil: (file.createdAt || 0) + UPLOAD_LEASE })
  }
  const removed = new Set(file.removedFileIDs || [])
  return [...objects.values()].filter(o => !removed.has(o.fileID))
}

module.exports = { UPLOAD_LEASE, MAX_OBJECTS, createStorageAdapter, scopedObject, inventory }
