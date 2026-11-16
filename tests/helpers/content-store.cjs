'use strict'
function createContentMemoryStore() {
  const collections = Object.fromEntries(['newsArticles', 'newsImages', 'competitions', 'teams', 'matches', 'registrations'].map(name => [name, new Map()]))
  const failures = { scan: false, read: false, write: false }
  const copy = value => value == null ? value : structuredClone(value)
  let queue = Promise.resolve()
  const store = {
    async scan(name) { if (failures.scan) throw new Error('Unavailable'); return [...collections[name].values()].map(copy) },
    async read(name, id) { if (failures.read) throw new Error('Unavailable'); return copy(collections[name].get(id)) },
    async listImages(cursor, limit = 20) { if (failures.scan) throw new Error('Unavailable'); return [...collections.newsImages.values()].filter(r => !cursor || r._id > cursor).sort((a,b) => a._id.localeCompare(b._id)).slice(0,limit).map(copy) },
    atomic(fn) {
      const operation = queue.then(async () => {
        if (failures.read) throw new Error('Unavailable')
        const draft = new Map()
        const result = await fn({
          async get(name, id) { if (failures.read) throw new Error('Unavailable'); return copy(draft.get(`${name}:${id}`)?.record || collections[name].get(id)) },
          async set(name, id, record) { if (failures.write) throw new Error('Unavailable'); draft.set(`${name}:${id}`,{name,id,record:copy(record)}) },
        })
        for (const {name,id,record} of draft.values()) collections[name].set(id,record)
        return result
      })
      queue = operation.catch(() => {})
      return operation
    },
    transaction(id, fn) { return store.atomic(async tx => fn(await tx.get('newsArticles',id), record => tx.set('newsArticles',id,record),tx)) },
  }
  return { store, collections, failures }
}
module.exports = { createContentMemoryStore }
