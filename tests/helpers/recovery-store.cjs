'use strict'
const M = require('../../cloudfunctions/adminAuth/recovery-model')
const clone = value => value == null ? value : structuredClone(value)
function createRecoveryMemory() {
  const collections = Object.fromEntries(M.COLLECTIONS.map(name=>[name,new Map()]))
  let queue = Promise.resolve(), writes = 0
  const failures = { writeAt:0, download:false, upload:false }
  const store = {
    async snapshot() { return Object.fromEntries(M.COLLECTIONS.map(name=>[name,[...collections[name].values()].filter(row=>name!=='platformSettings'||row._id==='primary').map(clone)])) },
    async read(id) { return clone(collections.platformSettings.get(id)) },
    async history() { return [...collections.platformSettings.values()].filter(row=>row.recoveryKind==='backup').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,30).map(clone) },
    atomic(fn) {
      const operation = queue.then(async()=>{
        const draft=Object.fromEntries(Object.entries(collections).map(([name,map])=>[name,new Map([...map].map(([id,value])=>[id,clone(value)]))]))
        const mutate=()=>{writes++;if(failures.writeAt&&writes===failures.writeAt)throw new Error('Simulated database write failure')}
        const result=await fn({async get(name,id){return clone(draft[name].get(id))},async set(name,id,value){mutate();draft[name].set(id,{...clone(value),_id:id})},async remove(name,id){mutate();draft[name].delete(id)}})
        for(const [name,map]of Object.entries(draft)){collections[name].clear();for(const [id,row]of map)collections[name].set(id,row)}
        return result
      });queue=operation.catch(()=>{});return operation
    },
  }
  const control={async read(){return await store.read('recovery_control')||{}},atomic(fn){return store.atomic(async tx=>fn(await tx.get('platformSettings','recovery_control')||{},value=>tx.set('platformSettings','recovery_control',value)))}}
  const files=new Map(),environment='cloud-test'
  const storage={
    path(id){return typeof id==='string'&&id.startsWith(`cloud://${environment}/`)?id.slice(environment.length+9):null},
    isMissing:error=>error?.code==='STORAGE_FILE_NONEXIST',
    async upload(path,bytes){if(failures.upload)throw new Error('Upload failed');const id=`cloud://${environment}/${path}`;files.set(id,Buffer.from(bytes));return id},
    async download(id){if(failures.download)throw new Error('Network unavailable');if(!files.has(id)){const e=new Error('Missing');e.code='STORAGE_FILE_NONEXIST';throw e}return Buffer.from(files.get(id))},
  }
  return{store,control,storage,files,collections,failures,environment,get writes(){return writes},failAfterWrites(n){failures.writeAt=writes+n}}
}
module.exports={createRecoveryMemory}
