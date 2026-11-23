'use strict'
const { createHash } = require('node:crypto')
const TTL = 120000, MAX_BYTES = 512 * 1024
const ACTIONS = ['competitions.listPublic','competitions.getPublic','matches.listPublic','matches.getPublic','standings.getPublic','news.listPublic','news.getPublic','search.public','search.suggestions','directory.teamPublic','directory.playerPublic','directory.homePublic','directory.teamProfilePublic','directory.playerProfilePublic','live.listPublic','settings.getPublic']
const ALLOWED = ['action','id','competitionId','matchId','teamId','cursor','category','query','kind']
function query(event) {
  const data = Object.fromEntries(Object.entries(event || {}).filter(([key])=>!['userInfo','tcbContext'].includes(key)))
  if (!ACTIONS.includes(data.action) || Object.keys(data).some(key=>!ALLOWED.includes(key)) || Buffer.byteLength(JSON.stringify(data))>2048) return null
  return Object.fromEntries(Object.entries(data).sort(([a],[b])=>a.localeCompare(b)))
}
const pathFor = data => 'recovery-public/' + createHash('sha256').update(JSON.stringify(data)).digest('hex') + '.json'
function createPublicCache({storage,environment,enabled=false,now=Date.now,logger=console}) {
  return async (event,handler) => {
    const savedAt=now(),result=await handler(event),data=query(event)
    if(enabled&&data&&result?.ok===true){
      try { const payload=Buffer.from(JSON.stringify({schemaVersion:1,environment,query:data,savedAt,expiresAt:savedAt+TTL,result}));if(payload.length<=MAX_BYTES)await storage.upload(pathFor(data),payload) }
      catch { logger?.error?.('[publicCache] snapshot publication unavailable') }
    }
    return result
  }
}
module.exports={TTL,MAX_BYTES,ACTIONS,query,pathFor,createPublicCache}
