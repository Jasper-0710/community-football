'use strict'

// Only the service's fixed collection names reach this adapter. Reads page by
// the default _id index; no unbounded SDK query or default 20-row truncation.
function createContentStore(database) {
  const store = {
    async liveEntries(matchId) {
      const rows = []; let cursor
      for (;;) {
        const page = (await database.collection('matchLiveEntries').where({ matchId, ...(cursor ? { _id: database.command.gt(cursor) } : {}) }).orderBy('_id', 'asc').limit(100).get()).data
        rows.push(...page)
        if (rows.length > 2000) throw new Error('Live feed limit exceeded')
        if (page.length < 100) return rows
        cursor = page[page.length - 1]._id
      }
    },
    async read(collection, id) { return (await database.collection(collection).doc(id).get()).data },
    async scan(collection) {
      const rows = []; let cursor
      for (;;) {
        const page = (await database.collection(collection).where(cursor ? { _id: database.command.gt(cursor) } : {}).orderBy('_id', 'asc').limit(100).get()).data
        rows.push(...page)
        if (rows.length > 2000) throw new Error('Content scan limit exceeded')
        if (page.length < 100) return rows
        cursor = page[page.length - 1]._id
      }
    },
    async listImages(cursor, limit = 20, collection = 'newsImages') {
      return (await database.collection(collection).where(cursor ? { _id: database.command.gt(cursor) } : {}).orderBy('_id', 'asc').limit(limit).get()).data
    },
    async atomic(callback) {
      return database.runTransaction(async tx => {
        return callback({
          async get(collection, id) { return (await tx.collection(collection).doc(id).get()).data },
          async set(collection, id, record) {
            const { _id, _openid, ...fields } = record
            await tx.collection(collection).doc(id).set({ data: fields })
          },
        })
      })
    },
    async transaction(id, callback) {
      return store.atomic(async tx => callback(await tx.get('newsArticles', id), record => tx.set('newsArticles', id, record), tx))
    },
  }
  return store
}
module.exports = { createContentStore }
