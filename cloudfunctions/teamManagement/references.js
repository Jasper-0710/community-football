'use strict'
// Matches the documented data contract. Missing future collections are empty;
// permission, network, and all other database errors must stop dissolution.
const REFERENCES = [
  ['registrations',['teamId']],
  ['matches',['homeTeamId','awayTeamId']],
  ['matchEvents',['teamId']],
  ['resultRevisions',['teamId','homeTeamId','awayTeamId']],
]
function missingCollection(error) {
  return [error?.errCode,error?.code].some(code => [-502005,'-502005','DATABASE_COLLECTION_NOT_EXIST','TCB_DB_COLLECTION_NOT_EXISTS'].includes(code))
}
function createReferenceChecker(db) {
  return async teamId => {
    const found=await Promise.all(REFERENCES.map(async ([collection,fields])=>{
      try {
        const condition=fields.length===1?{[fields[0]]:teamId}:db.command.or(fields.map(field=>({[field]:teamId})))
        const response=await db.collection(collection).where(condition).field({_id:true}).limit(1).get()
        if(!Array.isArray(response.data))throw new Error('Invalid reference response')
        return response.data.length>0
      }catch(error){if(missingCollection(error))return false;throw error}
    }))
    return found.some(Boolean)
  }
}
module.exports={REFERENCES,createReferenceChecker,missingCollection}
