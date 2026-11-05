'use strict'
const {REFERENCES}=require('../../cloudfunctions/teamManagement/references')
// Isolated transactional database for behavioral and browser integration tests.
exports.createTeamMemory=()=>{
 const records=new Map(),failures={read:false,write:false,failAfter:Infinity,references:false};let pending=Promise.resolve()
 const key=(c,id)=>c+'/'+id
 const store={
  async transaction(callback){const predecessor=pending;let release;pending=new Promise(r=>release=r);await predecessor
   try{if(failures.read)throw new Error('test read failure');const snapshot=new Map([...records].map(([k,v])=>[k,structuredClone(v)]));let writes=0
    const tx={async hasReferences(id){if(failures.references)throw new Error('reference read failure');return REFERENCES.some(([c,fields])=>[...snapshot].some(([k,v])=>k.startsWith(c+'/')&&fields.some(f=>v[f]===id)))},async get(c,id){return structuredClone(snapshot.get(key(c,id))??null)},async set(c,id,v){if(failures.write||++writes>failures.failAfter)throw new Error('test write failure');snapshot.set(key(c,id),{...structuredClone(v),_id:id})}}
    const result=await callback(tx);records.clear();for(const[k,v]of snapshot)records.set(k,v);return result
   }finally{release()}
  },
 }
 const adminStore={async list(cursor,limit){if(failures.read)throw new Error('read unavailable');return [...records].filter(([k,v])=>k.startsWith('teams/')&&(!cursor||v._id>cursor)).map(([,v])=>structuredClone(v)).sort((a,b)=>a._id.localeCompare(b._id)).slice(0,limit)},async read(id){if(failures.read)throw new Error('read unavailable');return structuredClone(records.get(key('teams',id))??null)},async user(id){return structuredClone(records.get(key('users',id))??null)}}
 function database(){return {runTransaction:fn=>store.transaction(tx=>fn({collection:c=>({doc:id=>({get:async()=>({data:await tx.get(c,id)}),set:async({data})=>tx.set(c,id,data),update:async({data})=>tx.set(c,id,{...await tx.get(c,id),...data})})})}))}}
 return {store,adminStore,records,failures,database,seed(c,id,v){records.set(key(c,id),{...structuredClone(v),_id:id})},read(c,id){return structuredClone(records.get(key(c,id))??null)}}
}
