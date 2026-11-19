'use strict'
const { createContentMemoryStore } = require('./content-store.cjs')
function createFavoritesMemoryStore() {
  const memory = createContentMemoryStore()
  memory.collections.users = new Map()
  const { store, collections } = memory
  const favoritesStore = {
    ...store,
    atomic: callback => store.atomic(tx => callback({
      ...tx,
      async saveFavorites(id, favorites) {
        const user = await tx.get('users', id)
        await tx.set('users', id, { ...user, favorites })
      },
    })),
  }
  // SDK-shaped adapter for the real getOrCreate/update profile handler.
  const database = {
    runTransaction: callback => store.atomic(tx => callback({ collection: name => ({ doc: id => ({
      get: async () => ({ data: (await tx.get(name, id)) || null }),
      set: async ({ data }) => tx.set(name, id, { ...data, _id: id }),
      update: async ({ data }) => tx.set(name, id, { ...await tx.get(name, id), ...data, _id: id }),
    }) }) })),
  }
  return { ...memory, favoritesStore, database }
}
module.exports = { createFavoritesMemoryStore }
