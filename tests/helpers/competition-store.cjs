'use strict'
function createCompetitionMemoryStore() {
  const records = new Map(), failures = { read: false, write: false, list: false }
  let queue = Promise.resolve()
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value))
  const store = {
    async read(id) { if (failures.read) throw new Error('read unavailable'); return copy(records.get(id)) },
    async list({ publicOnly, cursor, limit }) {
      if (failures.list) throw new Error('list unavailable')
      return [...records.values()].filter(r => (!publicOnly || r.displayEnabled) && (!cursor || r._id > cursor)).sort((a, b) => a._id.localeCompare(b._id)).slice(0, limit).map(copy)
    },
    transaction(id, callback) {
      const operation = queue.then(async () => {
        if (failures.read) throw new Error('read unavailable')
        let draft
        const result = await callback(copy(records.get(id)), async record => { if (failures.write) throw new Error('write unavailable'); draft = copy(record) })
        if (draft) records.set(id, draft)
        return result
      })
      queue = operation.catch(() => {})
      return operation
    },
  }
  return { store, records, failures }
}
module.exports = { createCompetitionMemoryStore }
