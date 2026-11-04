'use strict'
// Test-only transactional substitute. Browser integration uses the actual auth service.
exports.createMemoryStore = initial => {
  let account = initial ? structuredClone(initial) : null
  let pending = Promise.resolve()
  const failures = { read: false, write: false }
  const store = {
    async read() {
      if (failures.read) throw new Error('Private test store unavailable')
      return structuredClone(account)
    },
    async transaction(callback) {
      const predecessor = pending
      let release
      pending = new Promise(resolve => { release = resolve })
      await predecessor
      try {
        const snapshot = await store.read()
        let saved, written = false
        const result = await callback(snapshot, async value => {
          if (failures.write) throw new Error('Private test write failure')
          saved = structuredClone(value); written = true
        })
        if (written) account = saved
        return result
      } finally { release() }
    },
  }
  return { store, failures, value: () => structuredClone(account), replace: value => { account = structuredClone(value) } }
}
