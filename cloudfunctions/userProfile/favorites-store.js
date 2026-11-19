'use strict'

function createFavoritesStore(database) {
  return {
    async read(collection, id) { return (await database.collection(collection).doc(id).get()).data },
    async scan(collection) {
      const rows = []; let cursor
      for (;;) {
        const page = (await database.collection(collection).where(cursor ? { _id: database.command.gt(cursor) } : {}).orderBy('_id', 'asc').limit(100).get()).data
        rows.push(...page)
        if (rows.length > 2000) throw new Error('Favorites public catalog limit exceeded')
        if (page.length < 100) return rows
        cursor = page[page.length - 1]._id
      }
    },
    atomic: callback => database.runTransaction(tx => callback({
      async get(collection, id) { return (await tx.collection(collection).doc(id).get()).data },
      async saveFavorites(id, favorites) { await tx.collection('users').doc(id).update({ data: { favorites } }) },
    })),
  }
}
module.exports = { createFavoritesStore }
