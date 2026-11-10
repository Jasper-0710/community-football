import { AdminApiError } from './api'

export interface RegistrationCleanupResult {
  dryRun: boolean
  scannedSessions: number
  eligibleSessions: number
  retainedSessions: number
  deferredSessions: number
  blockedObjects: number
  candidateObjects: number
  removedObjects: number
  failedObjects: number
  cleanedSessions: number
  retryPage: boolean
  nextCursor: string | null
}

export function parseCleanupResult(value: any): RegistrationCleanupResult {
  const counters = ['scannedSessions', 'eligibleSessions', 'retainedSessions', 'deferredSessions', 'blockedObjects', 'candidateObjects', 'removedObjects', 'failedObjects', 'cleanedSessions'] as const
  if (!value || typeof value.dryRun !== 'boolean' || typeof value.retryPage !== 'boolean'
    || !counters.every(k => Number.isSafeInteger(value[k]) && value[k] >= 0)
    || !(value.nextCursor === null || (typeof value.nextCursor === 'string' && /^f_[a-f0-9]{32}$/.test(value.nextCursor)))) {
    throw new AdminApiError('INVALID_RESPONSE', '材料维护返回异常，请重新检查，确认清理结果。')
  }
  return Object.fromEntries(['dryRun', ...counters, 'retryPage', 'nextCursor'].map(k => [k, value[k]])) as unknown as RegistrationCleanupResult
}
