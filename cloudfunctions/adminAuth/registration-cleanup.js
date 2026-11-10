'use strict'

const { randomBytes } = require('node:crypto')
const M = require('./registration-model')
const { inventory, scopedObject } = require('./registration-storage')
const PAGE_SIZE = 5, OBJECT_LIMIT = 20, CLAIM_LEASE = 5 * 60 * 1000

function plan(file, storage, now) {
  const bound = Boolean(file.registrationId)
  const eligible = bound ? file.status === 'ready' : ['discarded', 'cleaning', 'cleaned'].includes(file.status) || (['uploading', 'ready'].includes(file.status) && Number.isFinite(file.expiresAt) && file.expiresAt <= now)
  if (!eligible) return { eligible: false, objects: [], blocked: 0, bound }
  const objects = inventory(file).filter(o => !bound || o.fileID !== file.fileID)
  const deferred = file.cleanupClaim?.until > now || objects.some(o => o.leaseUntil > now)
  const safe = objects.filter(o => scopedObject(file, o, storage))
  return { eligible: true, objects: safe, blocked: objects.length - safe.length, deferred, bound }
}

function createRegistrationCleanupService({ store, storage, authorize, now = Date.now, logger = console }) {
  return async event => {
    try {
      const auth = await authorize(event?.token)
      if (!auth.ok) return auth
      M.fields(event, ['action', 'token', 'dryRun', 'cursor', 'userInfo', 'tcbContext'])
      if (event.action !== 'registrations.cleanup' || (event.dryRun != null && typeof event.dryRun !== 'boolean') || (event.cursor != null && !M.FID.test(event.cursor))) M.fail('INVALID_ARGUMENT', '材料维护请求无效，请重新检查。')
      const dryRun = event.dryRun !== false, cursor = event.cursor || null
      const rows = await store.listFiles({ cursor, limit: PAGE_SIZE + 1 })
      if (rows.some(f => !M.FID.test(f._id) || (cursor && f._id <= cursor)) || rows.some((f,i) => i > 0 && f._id <= rows[i-1]._id)) throw new Error('Invalid file page')
      const result = { ok: true, dryRun, scannedSessions: 0, eligibleSessions: 0, retainedSessions: 0, deferredSessions: 0, blockedObjects: 0, candidateObjects: 0, removedObjects: 0, failedObjects: 0, cleanedSessions: 0, retryPage: false, nextCursor: rows.length > PAGE_SIZE ? rows[PAGE_SIZE-1]._id : null }
      let budget = OBJECT_LIMIT
      for (const file of rows.slice(0, PAGE_SIZE)) {
        result.scannedSessions++
        const preview = plan(file, storage, now())
        if (preview.bound) result.retainedSessions++
        if (!preview.eligible) continue
        result.blockedObjects += preview.blocked
        if (preview.deferred) { result.deferredSessions++; continue }
        if (preview.objects.length || (!preview.bound && file.status !== 'cleaned')) result.eligibleSessions++
        result.candidateObjects += preview.objects.length
        if (dryRun) continue
        if (!budget) { if (preview.objects.length) result.retryPage = true; continue }
        const claimId = randomBytes(16).toString('hex')
        const claimed = await store.transaction(async tx => {
          const current = await tx.get('registrationFiles', file._id)
          if (!current) return null
          const check = plan(current, storage, now())
          if (!check.eligible || check.deferred || (check.bound && !check.objects.length)) return null
          if (!check.objects.length && current.status === 'cleaned') return null
          // Claiming an unbound file changes the same record that submission
          // checks in its transaction. Only one side can win the binding race.
          const updated = { ...current, ...(!check.bound ? { status: 'cleaning' } : {}), cleanupClaim: { id: claimId, until: now() + CLAIM_LEASE } }
          await tx.set('registrationFiles', current._id, updated)
          if (!check.bound) {
            const user = await tx.get('users', current.ownerUserId)
            if (user) await tx.set('users', user._id, { ...user, registrationUploadSlots: (user.registrationUploadSlots || []).filter(s => s.id !== current._id) })
          }
          return { file: updated, objects: check.objects.slice(0, budget), more: check.objects.length > budget }
        })
        if (!claimed) continue
        const ids = claimed.objects.map(o => o.fileID)
        budget -= ids.length
        let removed = []
        try { if (ids.length) removed = [...new Set((await storage.remove(ids)).filter(id => ids.includes(id)))] }
        catch { logger?.error?.('[registrationCleanup] storage deletion pending') }
        result.removedObjects += new Set(removed).size
        result.failedObjects += ids.length - new Set(removed).size
        if (claimed.more || removed.length < ids.length) result.retryPage = true
        // If confirmation fails after deletion, the durable claim and object IDs
        // remain. Deleting an already absent object is safe on the next attempt.
        const cleaned = await store.transaction(async tx => {
          const current = await tx.get('registrationFiles', file._id)
          if (current?.cleanupClaim?.id !== claimId) throw new Error('Cleanup claim changed')
          const updated = { ...current, removedFileIDs: [...new Set([...(current.removedFileIDs || []), ...removed])], cleanupClaim: null, cleanupLastAt: now(), cleanupLastBy: auth.admin?.username || 'admin' }
          const remaining = inventory(updated).filter(o => !updated.registrationId || o.fileID !== updated.fileID)
          const complete = !updated.registrationId && !remaining.length
          if (complete) { updated.status = 'cleaned'; updated.cleanedAt = now() }
          await tx.set('registrationFiles', current._id, updated)
          return complete && current.status !== 'cleaned'
        })
        if (cleaned) result.cleanedSessions++
      }
      return result
    } catch (error) { return M.errorResult(error, logger) }
  }
}

module.exports = { createRegistrationCleanupService, plan, PAGE_SIZE, OBJECT_LIMIT }
