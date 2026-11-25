'use strict'
const { COLLECTIONS, MAX_RECORDS } = require('./recovery-model')
function createRecoveryStore(database) {
  async function scan(name) {
    if (name === 'platformSettings') { const row = (await database.collection(name).doc('primary').get()).data; return row ? [row] : [] }
    const rows = []; let cursor
    for (;;) {
      let page
      try { page = (await database.collection(name).where(cursor ? { _id: database.command.gt(cursor) } : {}).orderBy('_id', 'asc').limit(100).get()).data }
      catch (error) { if (name === 'platformImages' && error?.errCode === -502005 && !rows.length) return []; throw error }
      rows.push(...page)
      if (rows.length > MAX_RECORDS) throw new Error('Recovery inventory exceeds supported bound')
      if (page.length < 100) return rows
      cursor = page[page.length - 1]._id
    }
  }
  return {
    async snapshot() { const data = {}; let count = 0; for (const name of COLLECTIONS) { data[name] = await scan(name); count += data[name].length; if (count > MAX_RECORDS) throw new Error('Recovery inventory exceeds supported bound') } return data },
    async read(id) { return (await database.collection('platformSettings').doc(id).get()).data },
    async history() { return (await database.collection('platformSettings').where({ recoveryKind: 'backup' }).orderBy('createdAt', 'desc').limit(30).get()).data },
    async atomic(callback) {
      return database.runTransaction(tx => callback({
        async get(name, id) { return (await tx.collection(name).doc(id).get()).data },
        async set(name, id, value) { const { _id, ...data } = value; await tx.collection(name).doc(id).set({ data }) },
        async remove(name, id) { await tx.collection(name).doc(id).remove() },
      }))
    },
  }
}
module.exports = { createRecoveryStore }
