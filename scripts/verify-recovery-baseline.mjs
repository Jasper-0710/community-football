// Data-backed rehearsal in memory. This script never imports a cloud SDK or
// writes customer data. Snapshot and file inputs must stay outside Git.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createRequire} from 'node:module'
import {parseArgs} from 'node:util'
import {resolve,dirname} from 'node:path'
import {randomBytes} from 'node:crypto'
const require=createRequire(import.meta.url)
const M=require('../cloudfunctions/adminAuth/recovery-model')
const {createRecoveryService}=require('../cloudfunctions/adminAuth/recovery')
const {createRecoveryMemory}=require('../tests/helpers/recovery-store.cjs')
const {values}=parseArgs({options:{snapshot:{type:'string'},assets:{type:'string'},report:{type:'string',default:'artifacts/recovery-baseline/report.json'}}})
if(!values.snapshot||!values.assets)throw new Error('Usage: npm run test:recovery:baseline -- --snapshot <private JSON> --assets <private inventory JSON> [--report <sanitized JSON>]')
const {envId:environment}=JSON.parse(await fs.readFile(new URL('../config/cloud-environment.json',import.meta.url),'utf8'))
const source=await fs.readFile(resolve(values.snapshot))
const sourceDigest=M.digest(source),baseline=M.validateData(JSON.parse(source.toString('utf8')))
const assetIds=M.assetIds(baseline),inventory=JSON.parse(await fs.readFile(resolve(values.assets),'utf8'))
assert.ok(Array.isArray(inventory));assert.equal(inventory.length,assetIds.length)
assert.equal(new Set(inventory.map(row=>row.fileID)).size,assetIds.length)
const paths=fileID=>{const match=/^cloud:\/\/([^/]+)\/(.+)$/.exec(fileID);return match&&(match[1]===environment||match[1].startsWith(environment+'.'))?match[2]:null}
const namespace=assetIds[0]?.slice(0,assetIds[0].indexOf('/',8)+1)||`cloud://${environment}/`
const files=new Map(),assetHashes=[]
let assetBytes=0
for(const item of inventory){
 assert.ok(assetIds.includes(item.fileID)&&paths(item.fileID),'Inventory must match same-environment final files')
 const bytes=await fs.readFile(resolve(item.localPath))
 assert.equal(bytes.length,item.bytes);assert.equal(M.digest(bytes),item.sha256)
 assetBytes+=bytes.length;assert.ok(assetBytes<=M.MAX_ASSET_BYTES)
 files.set(item.fileID,bytes);assetHashes.push(item.sha256)
}
const memory=createRecoveryMemory()
for(const name of M.COLLECTIONS)for(const row of baseline[name])memory.collections[name].set(row._id,structuredClone(row))
const storage={path:paths,isMissing:error=>error?.code==='STORAGE_FILE_NONEXIST',async upload(path,bytes){const fileID=namespace+path;files.set(fileID,Buffer.from(bytes));return fileID},async download(fileID){if(!files.has(fileID)){const error=new Error('Missing offline fixture');error.code='STORAGE_FILE_NONEXIST';throw error}return Buffer.from(files.get(fileID))}}
const session=randomBytes(32).toString('hex')
const service=createRecoveryService({...memory,storage,environment,authorize:async token=>({ok:token===session,admin:{username:'isolated-rehearsal'}}),enabled:true,probe:async()=>true,logger:{error(){}}})
const call=(action,fields={})=>service({action,...fields,token:session})
const checks=[]
const check=name=>{checks.push(name);console.log('PASS '+name)}
const created=await call('backup.create',{requestId:randomBytes(16).toString('hex')})
assert.equal(created.ok,true,JSON.stringify(created));const backup=created.backup
assert.equal(backup.records,M.COLLECTIONS.reduce((sum,name)=>sum+baseline[name].length,0));assert.equal(backup.assetCount,assetIds.length)
check('Nonempty current business snapshot and all final files can be archived in isolation')
const parts=[]
for(let index=0;index<Math.ceil(backup.bytes/M.CHUNK_BYTES);index++){
 const page=await call('backup.chunk',{id:backup.id,digest:backup.digest,index})
 assert.equal(page.ok,true);assert.equal(page.index,index);assert.equal(page.total,Math.ceil(backup.bytes/M.CHUNK_BYTES));parts.push(Buffer.from(page.data,'base64'))
}
const text=Buffer.concat(parts);assert.equal(text.length,backup.bytes);assert.equal(M.digest(text),backup.digest)
const payload=JSON.parse(text.toString('utf8'));assert.equal(M.digest(payload.collections),M.digest(baseline),'Exported business snapshot changed')
for(const asset of payload.assets){const bytes=await storage.download(asset.backupFileID);assert.equal(bytes.length,asset.size);assert.equal(M.digest(bytes),asset.sha256)}
check('Chunk export, canonical JSON SHA-256 and every archived file hash match the private input')
const sample=memory.collections.teams.values().next().value
assert.ok(sample&&typeof sample.name==='string','A nonempty team is required for the isolated reversible sample')
const sampleId=sample._id,originalName=sample.name
sample.name=originalName+'（D13隔离演练）';sample.version=(sample.version||0)+1
const modified=await memory.store.snapshot(),preview=async backup=>{const result=await call('backup.preview',{id:backup.id,digest:backup.digest});assert.equal(result.ok,true,JSON.stringify(result));return result.plan}
let plan=await preview(backup);assert.equal(plan.totalChanges,1)
check('Only the explicit in-memory team sample appears in the restore diff')
memory.failAfterWrites(3) // acquire lease, save rollback manifest, fail on business write
const failed=await call('backup.apply',{planId:plan.id,confirmation:plan.confirmation})
assert.equal(failed.ok,false);assert.equal(M.digest(await memory.store.snapshot()),M.digest(modified),'Failed transaction changed business data')
assert.equal((await call('backup.result',{planId:plan.id})).status,'cancelled');assert.equal((await call('backup.apply',{planId:plan.id,confirmation:plan.confirmation})).error.code,'CONFLICT')
memory.failures.writeAt=0
check('Injected database failure leaves all business records intact and cancels a checked stale attempt')
plan=await preview(backup)
const restored=await call('backup.apply',{planId:plan.id,confirmation:plan.confirmation})
assert.equal(restored.ok,true,JSON.stringify(restored));assert.ok(memory.collections.teams.get(sampleId).name===originalName,'Restore did not recover the sample name')
assert.ok(memory.collections.teams.get(sampleId).version>sample.version)
const writes=memory.writes
assert.equal((await call('backup.apply',{planId:plan.id,confirmation:plan.confirmation})).applied,false);assert.equal(memory.writes,writes)
assert.equal((await call('backup.result',{planId:plan.id})).status,'completed')
check('Restore commits a completed receipt, advances the version and ignores duplicate apply requests')
const rollback=await memory.store.read(M.backupKey(restored.rollbackId)),undo=await preview({id:rollback.backupId,digest:rollback.digest})
assert.equal((await call('backup.apply',{planId:undo.id,confirmation:undo.confirmation})).ok,true)
assert.ok(memory.collections.teams.get(sampleId).name===originalName+'（D13隔离演练）','Rollback did not recover the sample change')
const final=await preview(backup);assert.equal((await call('backup.apply',{planId:final.id,confirmation:final.confirmation})).ok,true)
const after=await memory.store.snapshot()
for(const name of M.COLLECTIONS){
 assert.equal(after[name].length,baseline[name].length,'Collection record count changed')
 for(const row of after[name]){
 const original=baseline[name].find(item=>item._id===row._id)
 assert.ok(original,'Unexpected business record after restore')
  if(name==='teams'&&row._id===sampleId){assert.ok(row.name===originalName);assert.ok(row.version>original.version)}else assert.equal(M.digest(row),M.digest(original),'Unrelated business record changed')
 }
}
assert.equal(M.digest(await fs.readFile(resolve(values.snapshot))),sourceDigest,'Private source snapshot changed')
for(const item of inventory){assert.equal(M.digest(files.get(item.fileID)),item.sha256,'Original in-memory file changed');assert.equal(M.digest(await fs.readFile(resolve(item.localPath))),item.sha256,'Private source file changed')}
check('Automatic rollback and final restore preserve every unrelated business record and all original file bytes')
const report={date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),scope:'Current customer snapshot and original final file bytes; all backup, restore, failure injection and rollback operations use isolated in-memory database/storage/auth. No customer cloud writes or physical-device acceptance.',environment,collections:M.COLLECTIONS.length,records:backup.records,originalJsonBytes:Buffer.byteLength(M.canonical(baseline)),assets:assetIds.length,assetBytes,assetHashesVerified:assetHashes.length,archiveJsonBytes:backup.bytes,checks,errors:[]}
await fs.mkdir(dirname(resolve(values.report)),{recursive:true});await fs.writeFile(resolve(values.report),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({passed:checks.length,records:report.records,assets:report.assets,assetBytes,cloudWrites:0,errors:[]}))
