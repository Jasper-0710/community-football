import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createRestoreReceipt} from '../admin/src/restore-receipt'
import {backupDigest} from '../admin/src/backup-files'
import {parseRestoreResult,type RestorePlan} from '../src/domain/recovery'
const require=createRequire(import.meta.url)
const {COLLECTIONS}=require('../cloudfunctions/adminAuth/recovery-model')
const plan:RestorePlan={id:'rp_'+'a'.repeat(32),backupId:'b_'+'b'.repeat(32),expiresAt:'2026-11-20T00:00:00.000Z',totalChanges:1,assetCount:2,confirmation:'恢复 b_'+'b'.repeat(32),summary:COLLECTIONS.map((collection:string,index:number)=>({collection,created:0,updated:index===0?1:0,removed:0,unchanged:0}))}
function memory(){const rows=new Map<string,string>();return{rows,getItem:(key:string)=>rows.get(key)||null,setItem:(key:string,value:string)=>{rows.set(key,value)},removeItem:(key:string)=>{rows.delete(key)}}}

test('D13 a reload preserves an unresolved expired preview without persisting tokens or snapshot contents',async()=>{
 const storage=memory(),scope=await backupDigest('customer-environment:current-session')
 const receipt=createRestoreReceipt(storage,scope)
 receipt.write({...plan,token:'must-not-persist',collections:{users:['private-data']}} as any)
 assert.deepEqual(createRestoreReceipt(storage,scope).read(),plan)
 assert.equal([...storage.rows.values()].join('').includes('must-not-persist'),false)
 assert.equal([...storage.rows.values()].join('').includes('private-data'),false)
 receipt.clear(plan.id);assert.equal(receipt.read(),null)
})
test('D13 pending recovery is isolated by environment and authenticated session',async()=>{
 const storage=memory(),key=await backupDigest('env-one:session-one')
 createRestoreReceipt(storage,key).write(plan)
 for(const value of ['env-two:session-one','env-one:session-two']) assert.equal(createRestoreReceipt(storage,await backupDigest(value)).read(),null)
 assert.deepEqual(createRestoreReceipt(storage,key).read(),plan)
 assert.throws(()=>createRestoreReceipt(storage,'raw-token'),/会话范围无效/)
})
test('D13 corrupt saved receipts are discarded and late completion cannot remove a newer task',()=>{
 const storage=memory(),receipt=createRestoreReceipt(storage,'a'.repeat(64))
 receipt.write(plan);const key=[...storage.rows.keys()][0]
 storage.rows.set(key,'not JSON');assert.equal(receipt.read(),null);assert.equal(storage.rows.size,0)
 receipt.write(plan);storage.rows.set(key,JSON.stringify({version:1,plan:{...plan,id:'invalid'}}));assert.equal(receipt.read(),null)
 const newer={...plan,id:'rp_'+'c'.repeat(32)};receipt.write(newer);receipt.clear(plan.id);assert.deepEqual(receipt.read(),newer)
 receipt.clear(newer.id);assert.equal(receipt.read(),null)
})
test('D13 disabled, full or silently failing session storage prevents starting an untraceable restore',()=>{
 const throwing={getItem(){throw new Error('denied')},setItem(){throw new Error('full')},removeItem(){throw new Error('denied')}}
 for(const storage of [undefined,throwing,{getItem:()=>null,setItem(){},removeItem(){}}]) {
  const receipt=createRestoreReceipt(storage,'a'.repeat(64))
  assert.equal(receipt.read(),null);assert.throws(()=>receipt.write(plan),/会话存储/)
 }
})
test('D13 result parsing distinguishes running/cancelled/completed and rejects ambiguous completion receipts',()=>{
 for(const status of ['preview','running','cancelled']) assert.deepEqual(parseRestoreResult({ok:true,status,rollbackId:null,completedAt:null}),{status,rollbackId:null,completedAt:null})
 const completed={ok:true,status:'completed',rollbackId:'b_'+'c'.repeat(32),completedAt:'2026-11-22T00:00:00.000Z'}
 assert.equal(parseRestoreResult(completed).status,'completed')
 for(const value of [{...completed,ok:false},{...completed,rollbackId:null},{...completed,completedAt:'invalid'},{...completed,status:'running'},{ok:true,status:'unknown',rollbackId:null,completedAt:null}]) assert.throws(()=>parseRestoreResult(value),/回执异常/)
})
