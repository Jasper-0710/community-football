'use strict'
const M=require('./team-badge-model')
function plan(file,team,storage,time) {
  // Dissolved teams are historical archives and keep their final badge, too.
  const referenced=!!team && team.badgeId===file._id && team.badgeFileId===file.fileID
  const whole=!referenced && (['discarded','cleaning','cleaned'].includes(file.status)||Number.isFinite(file.expiresAt)&&file.expiresAt<=time)
  const objects=M.inventory(file),safe=objects.every(o=>M.scopedObject(file,o,storage))
  const candidates=objects.filter(o=>whole||file.status==='ready'&&o.fileID!==file.fileID)
  const eligible=safe&&!(file.cleanupLeaseUntil>time)?candidates.filter(o=>o.leaseUntil<=time):[]
  return {whole,referenced,objects:eligible,deferred:!safe||eligible.length<candidates.length}
}
function createTeamBadgeCleanup({store,storage,authorize,now=Date.now,logger=console}) {
  return async event=>{
    try {
      const auth=await authorize(event?.token);if(!auth.ok)return auth
      if(event.action!=='teams.badges.cleanup'||Object.keys(event).some(k=>!['action','token','userInfo','tcbContext','dryRun','cursor'].includes(k))||typeof event.dryRun!=='boolean'||event.cursor!=null&&(typeof event.cursor!=='string'||!M.BADGE_ID.test(event.cursor)))M.fail('INVALID_ARGUMENT','队徽清理参数无效。')
      const rows=await store.listBadges(event.cursor,20),counts={scanned:rows.length,eligibleObjects:0,removedObjects:0,protectedBadges:0,deferredBadges:0}
      for(const file of rows) {
        if(!M.BADGE_ID.test(file._id)||!M.TEAM_ID.test(file.teamId)){counts.deferredBadges++;continue}
        const preview=plan(file,await store.read('teams',file.teamId),storage,now())
        if(preview.referenced)counts.protectedBadges++
        if(preview.deferred)counts.deferredBadges++
        if(event.dryRun){counts.eligibleObjects+=preview.objects.length;continue}
        const claim=await store.atomic(async tx=>{
          const current=await tx.get('teamBadges',file._id);if(!current)return null
          const check=plan(current,await tx.get('teams',current.teamId),storage,now());if(!check.objects.length)return null
          await tx.set('teamBadges',current._id,{...current,status:check.whole?'cleaning':current.status,cleanupLeaseUntil:now()+5*60000})
          return check
        })
        if(!claim)continue
        counts.eligibleObjects+=claim.objects.length
        const ids=claim.objects.map(o=>o.fileID);let removed=[]
        try{removed=[...new Set((await storage.remove(ids)).filter(id=>ids.includes(id)))]}catch{logger?.error?.('[teamBadges] cleanup pending')}
        counts.removedObjects+=removed.length
        if(removed.length<ids.length&&!preview.deferred)counts.deferredBadges++
        await store.atomic(async tx=>{
          const current=await tx.get('teamBadges',file._id);if(!current)return
          const updated={...current,removedFileIDs:[...new Set([...(current.removedFileIDs||[]),...removed])],cleanupLeaseUntil:0,updatedAt:now()}
          if(claim.whole)updated.status=M.inventory(updated).length?'discarded':'cleaned'
          await tx.set('teamBadges',current._id,updated)
        })
      }
      return {ok:true,dryRun:event.dryRun,...counts,nextCursor:rows.length===20?rows.at(-1)._id:null}
    }catch(e){
      if(e instanceof M.TeamBadgeError)return {ok:false,error:{code:e.code,message:e.message}}
      logger?.error?.('[teamBadges] cleanup unavailable')
      return {ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'队徽清理暂不可用，请重新检查。'}}
    }
  }
}
module.exports={createTeamBadgeCleanup,plan}
