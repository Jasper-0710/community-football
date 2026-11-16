'use strict'
// Isolated byte storage shared by service tests and the HTTPS browser fixture.
function createNewsImageStorage() {
  const objects = new Map(), removed = [], controls = { uploadFails: 0, responseFails: 0, linkFails: false, removeFails: false, removeLimit: Infinity, version: 0 }
  const prefix = 'cloud://news-test.bucket/'
  const storage = {
    path: id => typeof id === 'string' && id.startsWith(prefix) ? id.slice(prefix.length) : null,
    async prepare(path) { return prefix + path },
    async upload(path, bytes) {
      if (controls.uploadFails-- > 0) throw new Error('Injected upload failure')
      const id = prefix + path; objects.set(id, Buffer.from(bytes))
      if (controls.responseFails-- > 0) throw new Error('Upload succeeded but response lost')
      return id
    },
    async download(id) { if (!objects.has(id)) throw new Error('Missing object'); return Buffer.from(objects.get(id)) },
    async link(id) { if (controls.linkFails || !objects.has(id)) throw new Error('Link unavailable'); return `https://images.example.test/object?id=${encodeURIComponent(id)}&v=${++controls.version}` },
    async remove(ids) {
      if (controls.removeFails) throw new Error('Delete unavailable')
      const selected = ids.slice(0, controls.removeLimit)
      for (const id of selected) { objects.delete(id); removed.push(id) }
      return selected
    },
  }
  return { storage, objects, removed, controls }
}
module.exports = { createNewsImageStorage }
