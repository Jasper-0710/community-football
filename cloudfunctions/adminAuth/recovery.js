'use strict'
const { randomBytes } = require('node:crypto')
const M = require('./recovery-model')
const { withRecoveryLock, ID: CONTROL_ID } = require('./recovery-guard')
const FORMAT = 'community-football-backup', SCHEMA = 1
const idValid = id => typeof id === 'string' && /^b_[a-f0-9]{32}$/.test(id)
const hashValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const planValid = id => typeof id === 'string' && /^rp_[a-f0-9]{32}$/.test(id)
const publicBackup = row => ({ id: row.backupId, createdAt: row.createdAt, kind: row.kind, digest: row.digest, bytes: row.bytes, records: row.records, assetCount: row.assetCount, environment: row.environment })
function createRecoveryService({ store, control, storage, authorize, environment, enabled = false, probe = async () => false, now = Date.now, logger = console }) {
  const fields = { 'backup.status': [], 'backup.list': [], 'backup.create': ['requestId'], 'backup.chunk': ['id','digest','index'], 'backup.preview': ['id','digest'], 'backup.apply': ['planId','confirmation'], 'backup.result': ['planId'] }
  const saveMeta = row => store.atomic(tx => tx.set('platformSettings', row._id, row))
  async function archive(id, data, kind, owner, recoveryAssets = []) {
    const existing = await store.read(M.backupKey(id))
    if (existing?.status === 'ready') return existing
    data = M.validateData(data)
    const assets = []; let assetBytes = 0
    for (const fileID of M.assetIds(data)) {
      if (!storage.path(fileID)) M.fail('INVALID_BACKUP', '备份包含其他云环境的文件。')
      let bytes
      try { bytes = await storage.download(fileID) } catch (error) {
        const archived = recoveryAssets.find(asset=>asset.fileID===fileID)
        if (!archived || !storage.isMissing?.(error)) M.fail('MISSING_ASSET', '备份文件缺失或暂时无法读取，尚未生成有效备份。')
        bytes = await storage.download(archived.backupFileID)
        if (M.digest(bytes)!==archived.sha256) M.fail('INVALID_BACKUP','归档文件校验失败。')
      }
      assetBytes += bytes.length
      if (assetBytes > M.MAX_ASSET_BYTES) M.fail('LIMIT_EXCEEDED', '最终文件合计超出当前32MiB归档范围。')
      const sha256 = M.digest(bytes), backupFileID = await storage.upload(`recovery-backups/${id}/assets/${sha256}`, bytes)
      if (!storage.path(backupFileID)?.startsWith(`recovery-backups/${id}/assets/`)) throw new Error('Unexpected backup storage path')
      assets.push({ fileID, backupFileID, sha256, size: bytes.length })
    }
    const payload = { format: FORMAT, schemaVersion: SCHEMA, id, environment, createdAt: new Date(now()).toISOString(), collections: data, assets }
    const text = M.canonical(payload), bytes = Buffer.byteLength(text)
    if (bytes > M.MAX_BYTES) M.fail('LIMIT_EXCEEDED', 'JSON备份超过2MiB，请安排分批归档。')
    const fileID = await storage.upload(`recovery-backups/${id}/snapshot.json`, Buffer.from(text))
    if (storage.path(fileID) !== `recovery-backups/${id}/snapshot.json`) throw new Error('Unexpected backup path')
    const record = { _id: M.backupKey(id), recoveryKind: 'backup', backupId: id, status: 'ready', environment, kind, createdAt: payload.createdAt, createdBy: owner, digest: M.digest(text), fileID, bytes, records: M.COLLECTIONS.reduce((sum,name) => sum + data[name].length,0), assetCount: assets.length }
    await saveMeta(record)
    return record
  }
  async function loadBackup(id, expectedDigest) {
    const record = await store.read(M.backupKey(id))
    if (!record || record.status !== 'ready') M.fail('NOT_FOUND', '未找到完整云端备份，请选择当前环境导出的原始JSON文件。')
    if (record.environment !== environment || record.digest !== expectedDigest) M.fail('INVALID_BACKUP', '备份环境或校验值不匹配。')
    const bytes = await storage.download(record.fileID)
    if (bytes.length !== record.bytes || bytes.length > M.MAX_BYTES || M.digest(bytes) !== record.digest) M.fail('INVALID_BACKUP', '云端备份完整性校验失败，禁止恢复。')
    let payload
    try { payload = JSON.parse(bytes.toString('utf8')) } catch { M.fail('INVALID_BACKUP', '备份JSON无法解析。') }
    if (payload.format !== FORMAT || payload.schemaVersion !== SCHEMA || payload.id !== id || payload.environment !== environment || !Array.isArray(payload.assets)) M.fail('INVALID_BACKUP', '备份版本或环境不受支持。')
    payload.collections = M.validateData(payload.collections)
    if (payload.assets.length !== M.assetIds(payload.collections).length || payload.assets.some(asset => !M.assetIds(payload.collections).includes(asset.fileID) || !storage.path(asset.fileID) || !storage.path(asset.backupFileID)?.startsWith(`recovery-backups/${id}/assets/`) || !hashValid(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size < 0)) M.fail('INVALID_BACKUP', '备份文件清单无效。')
    return { record, payload, text: bytes.toString('utf8') }
  }
  async function verifyAssets(payload, restore) {
    // Snapshot copies remain private and survive normal news/badge/live cleanup.
    for (const asset of payload.assets) {
      let archived
      try { archived = await storage.download(asset.backupFileID) } catch { M.fail('MISSING_ASSET', '归档文件缺失，恢复未执行。') }
      if (archived.length !== asset.size || M.digest(archived) !== asset.sha256) M.fail('INVALID_BACKUP', '归档文件校验失败，恢复未执行。')
      if (!restore) continue
      let original
      try { original = await storage.download(asset.fileID) } catch (error) { if (!storage.isMissing?.(error)) M.fail('SERVICE_UNAVAILABLE', '无法核实原文件状态，请稍后重试。') }
      if (original) { if (M.digest(original) !== asset.sha256) M.fail('CONFLICT', '原文件内容与备份不一致，禁止覆盖。') }
      else if (await storage.upload(storage.path(asset.fileID), archived) !== asset.fileID) throw new Error('Restored asset identifier changed')
    }
  }
  return async event => {
    try {
      const auth = await authorize(event?.token)
      if (!auth?.ok) return auth || { ok: false, error: { code: 'UNAUTHORIZED', message: '请先登录管理后台。' } }
      if (!Object.hasOwn(fields,event?.action) || Object.keys(event).some(key => !['action','token','userInfo','tcbContext',...fields[event.action]].includes(key))) M.fail('INVALID_ARGUMENT', '不支持的备份请求。')
      if (event.action === 'backup.status') return { ok: true, enabled, environment, guardsReady: enabled ? await probe() : false, limits: { records: M.MAX_RECORDS, jsonBytes: M.MAX_BYTES, changes: M.MAX_CHANGES, assets: M.MAX_ASSETS, assetBytes: M.MAX_ASSET_BYTES } }
      if (!enabled) M.fail('NOT_CONFIGURED', '备份恢复尚未部署启用，请完成三个云函数的更新与配置。')
      if (event.action === 'backup.list') return { ok: true, backups: (await store.history()).filter(row => row.status === 'ready').map(publicBackup) }
      if (event.action === 'backup.result') {
        if (!planValid(event.planId)) M.fail('INVALID_ARGUMENT', '恢复任务标识无效。')
        const plan = await store.read(M.planKey(event.planId))
        if (!plan || plan.owner !== M.digest(event.token)) M.fail('NOT_FOUND', '恢复任务不存在或属于其他会话。')
        return { ok: true, status: plan.status, rollbackId: plan.rollbackId || null, completedAt: plan.completedAt || null }
      }
      if (event.action === 'backup.chunk') {
        if (!idValid(event.id) || !hashValid(event.digest) || !Number.isInteger(event.index) || event.index < 0) M.fail('INVALID_ARGUMENT', '备份下载参数无效。')
        const { text } = await loadBackup(event.id,event.digest), bytes = Buffer.from(text), total = Math.ceil(bytes.length/M.CHUNK_BYTES)
        if (event.index >= total) M.fail('INVALID_ARGUMENT', '备份分片不存在。')
        return { ok: true, index: event.index, total, data: bytes.subarray(event.index*M.CHUNK_BYTES,(event.index+1)*M.CHUNK_BYTES).toString('base64') }
      }
      if (!await probe()) M.fail('NOT_CONFIGURED', '三个业务云函数尚未全部支持恢复保护，请完成部署后重试。')
      if (event.action === 'backup.create') {
        if (typeof event.requestId !== 'string' || !/^[a-f0-9]{32}$/.test(event.requestId)) M.fail('INVALID_ARGUMENT', '备份请求无效。')
        const id = 'b_' + M.digest(`${auth.admin?.username}:${event.requestId}`).slice(0,32)
        const previous = await store.read(M.backupKey(id))
        if (previous?.status === 'ready') return { ok: true, backup: publicBackup(previous) }
        return await withRecoveryLock(control,'export',async () => ({ ok: true, backup: publicBackup(await archive(id,await store.snapshot(),'manual',auth.admin?.username || 'admin')) }),now)
      }
      if (event.action === 'backup.preview') {
        if (!idValid(event.id) || !hashValid(event.digest)) M.fail('INVALID_ARGUMENT', '请选择有效的备份JSON。')
        const { payload } = await loadBackup(event.id,event.digest)
        await verifyAssets(payload,false)
        return await withRecoveryLock(control,'preview',async () => {
          const current = M.normalize(await store.snapshot()), target = M.materialize(payload.collections,current), diff = M.changes(current,target)
          if (diff.totalChanges > M.MAX_CHANGES) M.fail('LIMIT_EXCEEDED', '恢复差异超过80条，当前不支持安全原子恢复；未写入业务数据。')
          const id = 'rp_' + randomBytes(16).toString('hex'), expiresAt = now()+10*60000
          const plan = { _id:M.planKey(id), recoveryKind:'plan', planId:id, backupId:event.id, digest:event.digest, currentDigest:M.digest(current), owner:M.digest(event.token), status:'preview', expiresAt, totalChanges:diff.totalChanges }
          await saveMeta(plan)
          return { ok:true, plan:{ id, backupId:event.id, expiresAt:new Date(expiresAt).toISOString(), summary:diff.summary, totalChanges:diff.totalChanges, assetCount:payload.assets.length, confirmation:`恢复 ${event.id}` } }
        },now)
      }
      if (!planValid(event.planId) || typeof event.confirmation !== 'string') M.fail('INVALID_ARGUMENT', '恢复确认参数无效。')
      const plan = await store.read(M.planKey(event.planId))
      if (!plan || plan.owner !== M.digest(event.token)) M.fail('NOT_FOUND', '恢复任务不存在或属于其他会话。')
      if (event.confirmation !== `恢复 ${plan.backupId}`) M.fail('INVALID_ARGUMENT', '请完整输入预览中的恢复确认文字。')
      if (plan.status === 'completed') return { ok:true, applied:false, rollbackId:plan.rollbackId, completedAt:plan.completedAt }
      if (plan.expiresAt <= now()) M.fail('CONFLICT', '恢复预览已过期，请重新校验。')
      const { payload } = await loadBackup(plan.backupId,plan.digest)
      return await withRecoveryLock(control,'restore',async owner => {
        const current = M.normalize(await store.snapshot())
        if (M.digest(current) !== plan.currentDigest) M.fail('CONFLICT', '预览后业务数据已发生变化，请重新校验并确认差异。')
        const target = M.materialize(payload.collections,current), diff = M.changes(current,target)
        if (diff.totalChanges > M.MAX_CHANGES) M.fail('LIMIT_EXCEEDED','恢复差异超出80条原子写入范围。')
        const rollbackId = 'b_' + M.digest(event.planId+':rollback').slice(0,32)
        await archive(rollbackId,current,'before_restore',auth.admin?.username || 'admin',payload.assets)
        await verifyAssets(payload,true)
        const completedAt = new Date(now()).toISOString()
        return store.atomic(async tx => {
          const state = await tx.get('platformSettings',CONTROL_ID), latest = await tx.get('platformSettings',M.planKey(event.planId))
          if (state?.lock?.owner !== owner || state.lock.until <= now() || latest.status !== 'preview' || latest.expiresAt <= now()) M.fail('CONFLICT','恢复锁或预览已失效，请重新读取结果。')
          for (const op of diff.operations) if (M.canonical(await tx.get(op.collection,op.id) || null) !== M.canonical(op.before)) M.fail('CONFLICT','恢复前发现并发变化，已取消本次业务写入。')
          for (const op of diff.operations) { if (op.after) await tx.set(op.collection,op.id,op.after); else await tx.remove(op.collection,op.id) }
          await tx.set('platformSettings',M.planKey(event.planId),{...latest,status:'completed',rollbackId,completedAt})
          await tx.set('platformSettings',CONTROL_ID,{...state,epoch:(state.epoch||0)+1})
          return { ok:true,applied:true,rollbackId,completedAt }
        })
      },now)
    } catch (error) {
      if (error instanceof M.RecoveryError) return { ok:false,error:{code:error.code,message:error.message} }
      logger?.error?.('[recovery] operation failed; inspect task before retrying')
      return { ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'备份恢复服务暂不可用。执行结果不明时，请先检查恢复结果。'} }
    }
  }
}
module.exports = { createRecoveryService, FORMAT, SCHEMA }
