'use strict'
const { randomBytes } = require('node:crypto')
const COLLECTION = 'platformSettings', ID = 'recovery_control', VERSION = 1, LEASE_MS = 120000
const unavailable = () => ({ ok: false, error: { code: 'SERVICE_MAINTENANCE', message: '平台正在备份或恢复，请稍后重新读取。当前不能保存。' } })
function createRecoveryControl(database, now = Date.now) {
  const read = async () => (await database.collection(COLLECTION).doc(ID).get()).data || {}
  const atomic = callback => database.runTransaction(async tx => {
    const ref = tx.collection(COLLECTION).doc(ID), state = (await ref.get()).data || {}
    return callback(state, async value => { const { _id, ...data } = value; await ref.set({ data }) })
  })
  return { read, atomic, now }
}
// A lease covers the entire invocation, including uploads and cleanup outside a
// database transaction. All three independently deployed functions use this file.
function createRecoveryGuard({ control, now = Date.now, logger = console }) {
  return async function guard(event, handler, readOnly = false) {
    if (event?.action === 'recovery.guardStatus') return { ok: true, recoveryGuardVersion: VERSION }
    const id = randomBytes(16).toString('hex')
    let admitted = false
    try {
      if (readOnly) {
        const state = await control.read()
        if (state.lock?.until > now()) return unavailable()
      } else {
        admitted = await control.atomic(async (state, save) => {
          if (state.lock?.until > now()) return false
          const leases = (state.leases || []).filter(item => item.until > now())
          if (leases.length >= 80) return false
          await save({ ...state, leases: [...leases, { id, until: now() + LEASE_MS }] })
          return true
        })
        if (!admitted) return unavailable()
      }
      return await handler(event)
    } catch {
      logger?.error?.('[recovery] guarded operation unavailable')
      return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '平台服务暂不可用，请重新读取确认后再操作。' } }
    } finally {
      if (admitted) try { await control.atomic(async (state, save) => { await save({ ...state, leases: (state.leases || []).filter(item => item.id !== id && item.until > now()) }) }) } catch { logger?.error?.('[recovery] invocation lease awaiting expiry') }
    }
  }
}
async function withRecoveryLock(control, purpose, operation, now = Date.now) {
  const owner = randomBytes(16).toString('hex')
  const acquired = await control.atomic(async (state, save) => {
    if (state.lock?.until > now() || (state.leases || []).some(item => item.until > now())) return false
    await save({ ...state, leases: [], lock: { owner, purpose, until: now() + LEASE_MS } })
    return true
  })
  if (!acquired) return { ok: false, error: { code: 'CONFLICT', message: '仍有业务请求处理中，请稍后重试。' } }
  try { return await operation(owner) }
  finally { await control.atomic(async (state, save) => { if (state.lock?.owner === owner) await save({ ...state, lock: null }) }) }
}
module.exports = { createRecoveryControl, createRecoveryGuard, withRecoveryLock, COLLECTION, ID, VERSION, LEASE_MS }
