'use strict'
const { createHash, randomBytes } = require('node:crypto')
const M = require('./news-image-model')
const { validateNewsImage, MAX_EDGE, MAX_PIXELS } = require('./news-image-validation')
function fields(event, allowed) { if (!event || typeof event !== 'object' || Array.isArray(event) || Object.keys(event).some(k => !['action','token','userInfo','tcbContext',...allowed].includes(k))) M.fail('INVALID_ARGUMENT','图片请求包含不支持的字段。') }
function metadata(event) {
  const name = typeof event.name === 'string' ? event.name.trim() : ''
  if (!name || Array.from(name).length > 120 || /[\\/<>:|?*\x00-\x1f\x7f]/u.test(name) || !Number.isSafeInteger(event.size) || event.size < 1 || event.size > M.MAX_BYTES || !['image/png','image/jpeg'].includes(event.mime) || !/^[a-f0-9]{64}$/.test(event.sha256 || '') || typeof event.sha256 !== 'string') M.fail('INVALID_ARGUMENT','请选择不超过2MB的JPG或PNG图片。')
  if (event.mime === 'image/png' ? !/\.png$/i.test(name) : !/\.jpe?g$/i.test(name)) M.fail('INVALID_ARGUMENT','图片文件名与格式不匹配。')
  return { name,size:event.size,mime:event.mime,sha256:event.sha256 }
}
function plan(file, article, storage, now, M = require('./news-image-model')) {
  const referenced = article && !article.deletedAt && M.imageIds(article).includes(file._id)
  const whole = !referenced && (['discarded','cleaning','cleaned'].includes(file.status) || Number.isFinite(file.expiresAt) && file.expiresAt <= now)
  const objects = M.inventory(file), safe = objects.every(o => M.scopedObject(file,o,storage))
  const eligible = safe && !(file.cleanupLeaseUntil > now) ? objects.filter(o => (whole || file.status === 'ready' && o.fileID !== file.fileID) && o.leaseUntil <= now) : []
  return { whole, referenced:!!referenced, objects:eligible, deferred:!safe || eligible.length < objects.filter(o => whole || o.fileID !== file.fileID).length }
}
function createNewsImageService({store,storage,authorize,enabled=false,now=Date.now,logger=console,model=M,prefix='news.images',imageCollection='newsImages',ownerCollection='newsArticles',ownerKey='articleId',idPrefix='ni',pathPrefix='news-images'}) {
  const M = model
  const operations = {config:[],start:[ownerKey,'requestId','name','size','mime','sha256'],chunk:['id','index','data'],finish:['id'],get:['id',ownerKey],cleanup:['dryRun','cursor']}
  const supported = Object.fromEntries(Object.entries(operations).map(([key,fields]) => [`${prefix}.${key}`,fields]))
  async function image(file) {
    if (!file || file.status !== 'ready' || !file.fileID || !M.inventory(file).some(o => o.fileID === file.fileID && M.scopedObject(file,o,storage))) M.fail('NOT_FOUND','图片不存在或尚未完成上传。')
    const url = await storage.link(file.fileID)
    const parsed = new URL(url)
    if (url.length > 2000 || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error('Invalid image link')
    return {ok:true,image:{id:file._id,[ownerKey]:file[ownerKey],name:file.name,size:file.size,mime:file.mime,width:file.width,height:file.height,url}}
  }
  async function upload(file,cloudPath,key,bytes) {
    const fileID = await storage.prepare(cloudPath), object = {key,fileID,cloudPath,leaseUntil:now()+M.LEASE}
    if (!M.scopedObject(file,object,storage)) throw new Error('Invalid image storage reservation')
    await store.atomic(async tx => {
      const r = await tx.get(imageCollection,file._id)
      if (!r || r.status !== 'uploading' || r.expiresAt <= now()) M.fail('CONFLICT','图片上传状态已变化，请重试或重新选择。')
      const existing = (r.objects || []).find(o => o.key === key)
      if (existing && existing.fileID !== fileID) M.fail('CONFLICT','同一分片不能替换内容。')
      if (!existing && (r.objects || []).length >= 64) M.fail('CONFLICT','图片重试次数过多，请重新选择。')
      await tx.set(imageCollection,r._id,{...r,objects:[...(r.objects || []).filter(o => o.key !== key),object]})
    })
    if (await storage.upload(cloudPath,bytes) !== fileID) throw new Error('Image storage reservation changed')
    return fileID
  }
  return async event => {
    try {
      if (!Object.hasOwn(supported,event?.action)) M.fail('INVALID_ARGUMENT','不支持的图片操作。')
      const auth = await authorize(event.token); if (!auth.ok) return auth
      const action = event.action.slice(prefix.length+1)
      fields(event,supported[event.action])
      if (action === 'config') return {ok:true,enabled,maxBytes:M.MAX_BYTES,chunkSize:M.CHUNK,maxEdge:MAX_EDGE,maxPixels:MAX_PIXELS}
      if (action === 'cleanup') {
        if (typeof event.dryRun !== 'boolean' || event.cursor != null && (typeof event.cursor !== 'string' || !M.IMAGE_ID.test(event.cursor))) M.fail('INVALID_ARGUMENT','图片清理参数无效。')
        const rows = await store.listImages(event.cursor,20,imageCollection), counts = {scanned:rows.length,eligibleObjects:0,removedObjects:0,protectedImages:0,deferredImages:0}
        for (const file of rows) {
          if (!M.IMAGE_ID.test(file._id) || !M.ARTICLE_ID.test(file[ownerKey])) { counts.deferredImages++; continue }
          const preview = plan(file,await store.read(ownerCollection,file[ownerKey]),storage,now(),M)
          if (preview.referenced) counts.protectedImages++
          if (preview.deferred) counts.deferredImages++
          if (event.dryRun) { counts.eligibleObjects += preview.objects.length; continue }
          const claim = await store.atomic(async tx => {
            const current = await tx.get(imageCollection,file._id)
            if (!current) return null
            const check = plan(current,await tx.get(ownerCollection,current[ownerKey]),storage,now(),M)
            if (!check.objects.length) return null
            await tx.set(imageCollection,current._id,{...current,status:check.whole?'cleaning':current.status,cleanupLeaseUntil:now()+5*60000})
            return check
          })
          if (!claim) continue
          counts.eligibleObjects += claim.objects.length
          const ids = claim.objects.map(o => o.fileID)
          let removed = []
          try { removed = [...new Set((await storage.remove(ids)).filter(id => ids.includes(id)))] }
          catch { logger?.error?.('[newsImages] cleanup pending') }
          counts.removedObjects += removed.length
          if (removed.length < ids.length && !preview.deferred) counts.deferredImages++
          await store.atomic(async tx => {
            const current = await tx.get(imageCollection,file._id)
            if (!current) return
            const updated = {...current,removedFileIDs:[...new Set([...(current.removedFileIDs || []),...removed])],cleanupLeaseUntil:0,updatedAt:now()}
            if (claim.whole) updated.status = M.inventory(updated).length ? 'discarded' : 'cleaned'
            await tx.set(imageCollection,current._id,updated)
          })
        }
        return {ok:true,dryRun:event.dryRun,...counts,nextCursor:rows.length===20?rows.at(-1)._id:null}
      }
      if (['start','chunk','finish'].includes(action) && !enabled) M.fail('UPLOAD_UNAVAILABLE','图片上传尚未开放，请联系管理员配置。')
      if (action === 'start') {
        if (typeof event[ownerKey] !== 'string' || !M.ARTICLE_ID.test(event[ownerKey]) || typeof event.requestId !== 'string' || !/^[a-f0-9]{32}$/.test(event.requestId)) M.fail('INVALID_ARGUMENT','图片所属内容或请求标识无效。')
        const meta = metadata(event), id = `${idPrefix}_${event.requestId}`
        return await store.atomic(async tx => {
          const article = await tx.get(ownerCollection,event[ownerKey])
          if (article?.deletedAt) M.fail('NOT_FOUND','内容已删除，不能继续上传。')
          const existing = await tx.get(imageCollection,id)
          if (existing) {
            if (existing[ownerKey] !== event[ownerKey] || Object.entries(meta).some(([key,value]) => existing[key] !== value) || !['uploading','ready'].includes(existing.status) || !existing.referenced && existing.expiresAt <= now()) M.fail('CONFLICT','本次图片上传已失效或内容不一致，请重新选择。')
            if (existing.status === 'ready') return {ok:true,id,chunkSize:M.CHUNK,uploaded:Array.from({length:Math.ceil(meta.size/M.CHUNK)},(_,i)=>i)}
            if (existing.chunkSize !== M.CHUNK) {
              // Only an untouched legacy session can change its partitioning.
              // Keep any reserved/uploaded legacy objects for normal cleanup.
              if (existing.chunks.some(Boolean) || (existing.objects || []).length) M.fail('UPLOAD_RESTART_REQUIRED','图片上传会话已更新，请重新上传。')
              await tx.set(imageCollection,id,{...existing,chunkSize:M.CHUNK,chunks:Array(Math.ceil(meta.size/M.CHUNK)).fill(null),updatedAt:now()})
              return {ok:true,id,chunkSize:M.CHUNK,uploaded:[]}
            }
            return {ok:true,id,chunkSize:M.CHUNK,uploaded:existing.chunks.flatMap((c,i) => c?[i]:[])}
          }
          await tx.set(imageCollection,id,{_id:id,[ownerKey]:event[ownerKey],...meta,status:'uploading',chunkSize:M.CHUNK,referenced:false,chunks:Array(Math.ceil(meta.size/M.CHUNK)).fill(null),objects:[],createdAt:now(),updatedAt:now(),expiresAt:now()+M.TTL})
          return {ok:true,id,chunkSize:M.CHUNK,uploaded:[]}
        })
      }
      if (typeof event.id !== 'string' || !M.IMAGE_ID.test(event.id)) M.fail('NOT_FOUND','图片不存在。')
      const file = await store.read(imageCollection,event.id)
      if (!file || !['uploading','ready'].includes(file.status) || !file.referenced && file.expiresAt <= now()) M.fail('NOT_FOUND','图片不存在或上传已过期。')
      if (action === 'get') {
        if (event[ownerKey] !== file[ownerKey]) M.fail('NOT_FOUND','图片不属于这篇内容。')
        return await image(file)
      }
      if (action === 'chunk') {
        if (file.chunkSize !== M.CHUNK) M.fail('UPLOAD_RESTART_REQUIRED','图片上传会话已更新，请重新上传。')
        const i = event.index, data = event.data
        if (!Number.isSafeInteger(i) || i < 0 || i >= file.chunks.length || typeof data !== 'string' || data.length > Math.ceil(M.CHUNK/3)*4 || !/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) M.fail('INVALID_ARGUMENT','图片分片无效。')
        const bytes = Buffer.from(data,'base64'), expected = Math.min(M.CHUNK,file.size-i*M.CHUNK), hash = createHash('sha256').update(bytes).digest('hex')
        if (bytes.length !== expected || bytes.toString('base64') !== data) M.fail('INVALID_ARGUMENT','图片分片大小不匹配。')
        if (file.chunks[i]) { if (file.chunks[i].hash !== hash) M.fail('CONFLICT','已上传的分片不能替换。'); return {ok:true,index:i} }
        const fileID = await upload(file,`${pathPrefix}/staging/${file._id}/${i}-${hash}`,`chunk-${i}`,bytes)
        await store.atomic(async tx => {
          const r = await tx.get(imageCollection,file._id)
          if (r.status !== 'uploading' || r.expiresAt <= now()) M.fail('CONFLICT','图片上传已过期或状态已变化。')
          if (r.chunks[i] && r.chunks[i].hash !== hash) M.fail('CONFLICT','已上传的分片不能替换。')
          const chunks = [...r.chunks]; chunks[i] = {fileID,hash,size:bytes.length}
          await tx.set(imageCollection,r._id,{...r,chunks,updatedAt:now()})
        })
        return {ok:true,index:i}
      }
      if (file.status === 'ready') return await image(file)
      if (file.chunks.some(c => !c)) M.fail('CONFLICT','图片尚未上传完整，请点击重试。')
      const parts = []
      for (const chunk of file.chunks) {
        if (!M.inventory(file).some(o => o.fileID === chunk.fileID && M.scopedObject(file,o,storage))) throw new Error('Invalid staging scope')
        const bytes = await storage.download(chunk.fileID)
        if (bytes.length !== chunk.size || createHash('sha256').update(bytes).digest('hex') !== chunk.hash) M.fail('INVALID_ARGUMENT','图片分片校验失败，请重新选择。')
        parts.push(bytes)
      }
      const bytes = Buffer.concat(parts)
      if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) M.fail('INVALID_ARGUMENT','图片校验失败，请重新选择。')
      const size = validateNewsImage(bytes,file.mime), key = randomBytes(24).toString('hex')
      let fileID
      try { fileID = await upload(file,`${pathPrefix}/files/${file._id}/${key}.${file.mime==='image/png'?'png':'jpg'}`,`final-${key}`,bytes) }
      catch (e) { if (e?.code === 'CONFLICT') { const current = await store.read(imageCollection,file._id); if (current?.status === 'ready') return await image(current) } throw e }
      const ready = await store.atomic(async tx => {
        const r = await tx.get(imageCollection,file._id)
        if (r.status === 'ready') return r
        if (r.status !== 'uploading' || r.expiresAt <= now()) M.fail('CONFLICT','图片上传状态已变化，请重试。')
        const next = {...r,...size,fileID,status:'ready',updatedAt:now()}
        await tx.set(imageCollection,r._id,next); return next
      })
      return await image(ready)
    } catch (error) {
      if (error instanceof M.NewsImageError) return {ok:false,error:{code:error.code,message:error.message}}
      logger?.error?.('[newsImages] operation failed')
      return {ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'图片服务暂不可用，请重试。已上传的分片会保留。'}}
    }
  }
}
module.exports = {createNewsImageService,metadata,plan}
