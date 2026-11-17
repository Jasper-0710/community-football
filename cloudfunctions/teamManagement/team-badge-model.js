'use strict'
const TEAM_ID = /^t_[a-f0-9]{64}$/, BADGE_ID = /^tb_[a-f0-9]{32}$/
const MAX_BYTES = 256 * 1024, CHUNK = 64 * 1024, TTL = 24 * 3600000, LEASE = 10 * 60000
class TeamBadgeError extends Error { constructor(code, message) { super(message); this.code = code } }
const fail = (code,message) => { throw new TeamBadgeError(code,message) }
function inventory(file) { const removed = new Set(file.removedFileIDs || []); return (file.objects || []).filter(o => !removed.has(o.fileID)) }
function scopedObject(file,object,storage) {
  if (!TEAM_ID.test(file?.teamId) || !BADGE_ID.test(file?._id) || typeof object?.fileID !== 'string') return false
  const path = storage.path(object.fileID)
  if (!path || path !== object.cloudPath) return false
  return new RegExp(`^team-badges/staging/${file.teamId}/${file._id}/[0-3]-[a-f0-9]{64}$`).test(path)
    || new RegExp(`^team-badges/files/${file.teamId}/${file._id}/[a-f0-9]{48}\\.(png|jpg)$`).test(path)
}
function validUrl(url) {
  if (typeof url !== 'string' || url.length > 2000) return false
  try { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password && !u.hash } catch { return false }
}
// Only the persisted team reference is signed. A broken link never hides team data.
async function badgeView(team,storage) {
  const badgeId = team.badgeId || '', hasBadge = !!team.badgeFileId
  let badgeUrl = ''
  try {
    if (hasBadge && storage && BADGE_ID.test(badgeId)) {
      const file = {_id:badgeId,teamId:team._id}, cloudPath = storage.path(team.badgeFileId)
      if (cloudPath?.startsWith(`team-badges/files/${team._id}/${badgeId}/`) && scopedObject(file,{fileID:team.badgeFileId,cloudPath},storage)) {
        const url = await storage.link(team.badgeFileId)
        if (validUrl(url)) badgeUrl = url
      }
    }
  } catch { /* Keep the saved reference and allow an explicit refresh. */ }
  return {badgeId,hasBadge,badgeUrl}
}
module.exports = {TEAM_ID,BADGE_ID,MAX_BYTES,CHUNK,TTL,LEASE,TeamBadgeError,fail,inventory,scopedObject,validUrl,badgeView}
