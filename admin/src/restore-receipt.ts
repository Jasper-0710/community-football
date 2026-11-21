import {BackupClientError,parseRestorePlan,type RestorePlan} from '../../src/domain/recovery'

type ReceiptStorage = Pick<Storage,'getItem'|'setItem'|'removeItem'>
const PREFIX = 'community-football.pending-restore.v1:'

// The caller hashes the environment and current session. Only the projected
// plan is saved; credentials and customer snapshot contents never enter it.
export function createRestoreReceipt(storage:ReceiptStorage|undefined,scope:string) {
 if (!/^[a-f0-9]{64}$/.test(scope)) throw new BackupClientError('恢复会话范围无效。')
 const key = PREFIX + scope
 function read():RestorePlan|null {
  try {
   const text = storage?.getItem(key)
   if (!text) return null
   if (text.length > 16384) throw new Error('Oversized receipt')
   const saved = JSON.parse(text)
   if (saved.version !== 1) throw new Error('Invalid receipt version')
   // An expired preview can still have a completed or running server receipt.
   return parseRestorePlan(saved.plan)
  } catch {
   try { storage?.removeItem(key) } catch { /* Keep the page usable for status reads. */ }
   return null
  }
 }
 return {
  read,
  write(plan:RestorePlan) {
   try {
    if (!storage) throw new Error('Storage unavailable')
    const text = JSON.stringify({version:1,plan:parseRestorePlan(plan)})
    if (text.length > 16384) throw new Error('Oversized receipt')
    storage.setItem(key,text)
    if (storage.getItem(key) !== text) throw new Error('Receipt was not saved')
   } catch { throw new BackupClientError('浏览器无法保存待确认恢复任务，请允许会话存储后再执行恢复。') }
  },
  clear(planId:string) {
   // A late response from a previous page must not clear a newer task.
   if (read()?.id === planId) {
    try { storage?.removeItem(key) } catch { /* A retained receipt is safe to check again. */ }
   }
  },
 }
}
