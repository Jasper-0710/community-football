'use strict'
const { createHash } = require('node:crypto')
const { calculateStandings, validateRules } = require('./standings-engine')
const COLLECTIONS = ['users', 'leaderTeamBindings', 'teams', 'players', 'competitions', 'registrations', 'registrationFiles', 'matches', 'resultRevisions', 'newsArticles', 'newsImages', 'teamBadges', 'platformSettings', 'matchLiveEntries', 'matchLiveImages', 'evaluationConfigs', 'playerRatings', 'playerComments', 'playerAwards']
const MAX_RECORDS = 2000, MAX_BYTES = 2 * 1024 * 1024, MAX_CHANGES = 80, CHUNK_BYTES = 32768, MAX_ASSETS = 32, MAX_ASSET_BYTES = 32 * 1024 * 1024
class RecoveryError extends Error { constructor(code, message) { super(message); this.code = code } }
const fail = (code, message) => { throw new RecoveryError(code, message) }
function canonical(value) { if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'; if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'; return JSON.stringify(value) }
const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex')
const backupKey = id => 'recovery_backup_' + id
const planKey = id => 'recovery_plan_' + id
function normalize(data) { return Object.fromEntries(COLLECTIONS.map(name => [name, [...(data[name] || [])].sort((a,b) => a._id.localeCompare(b._id))])) }
function validateData(data) {
  if (!data || Array.isArray(data) || Object.keys(data).length !== COLLECTIONS.length || COLLECTIONS.some(name => !Array.isArray(data[name]))) fail('INVALID_BACKUP', '备份集合范围或格式不完整。')
  let count = 0
  const maps = Object.fromEntries(COLLECTIONS.map(name => [name, new Map(data[name].map(row => [row?._id, row]))]))
  const link = (name, id, label) => { if (id && !maps[name].has(id)) fail('INVALID_BACKUP', `备份缺少${label}关联记录。`); return maps[name].get(id) }
  // Older developer-prepared samples deliberately have no authenticated user.
  // Preserve those explicit synthetic owners without inventing login identities.
  const synthetic = row => row?.fixture?.synthetic === true && typeof row.fixture.batchId === 'string' && row.fixture.batchId.length > 0 && row.fixture.source === 'developer-prepared; no real user submission or review'
  const owner = (row, id, label, team) => {
    if (!id || maps.users.has(id)) return link('users', id, label)
    const sample = synthetic(row) && !maps.leaderTeamBindings.has(id) && (team === undefined || synthetic(team) && team.fixture.batchId === row.fixture.batchId && team.leaderUserId === id)
    if (!sample) link('users', id, label)
  }
  for (const name of COLLECTIONS) {
    count += data[name].length
    if (maps[name].size !== data[name].length || data[name].some(row => !row || Array.isArray(row) || typeof row._id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(row._id))) fail('INVALID_BACKUP', '备份记录标识无效或重复。')
  }
  if (count > MAX_RECORDS || Buffer.byteLength(canonical(data)) > MAX_BYTES) fail('LIMIT_EXCEEDED', '备份超出当前支持的2000条记录或2MiB范围。')
  if (data.platformSettings.some(row => row._id !== 'primary')) fail('INVALID_BACKUP', '备份不能包含认证、恢复控制或审计记录。')
  for (const row of data.leaderTeamBindings) { link('users', row._id, '领队用户'); link('teams', row.teamId, '领队球队') }
  for (const row of data.teams) { owner(row, row.leaderUserId, '球队领队'); if (!Array.isArray(row.roster)) fail('INVALID_BACKUP', '球队名单格式无效。'); for (const p of row.roster) link('players', p.id, '球员档案'); link('teamBadges', row.badgeId, '球队队徽') }
  for (const row of data.players) link('teams', row.teamId, '球员球队')
  for (const row of data.registrations) { link('competitions', row.competitionId, '报名赛事'); const team = link('teams', row.teamId, '报名球队'); owner(row, row.ownerUserId, '报名用户', team || null); for (const file of row.attachments || []) link('registrationFiles', file.id, '报名材料') }
  for (const row of data.matches) { link('competitions', row.competitionId, '比赛赛事'); for (const side of ['home', 'away']) { link('teams', row[side+'TeamId'], '参赛球队'); const prior = link('matches', row[side+'From'], '晋级比赛'); if (prior && prior.competitionId !== row.competitionId) fail('INVALID_BACKUP', '晋级来源跨赛事。') } }
  for (const row of data.resultRevisions) link('matches', row.matchId, '赛果历史比赛')
  for (const row of data.newsArticles) { link('competitions', row.competitionId, '新闻赛事'); link('newsImages', row.coverImageId, '新闻封面'); for (const block of row.body || []) if (block.type === 'image') link('newsImages', block.imageId, '新闻图片') }
  for (const row of data.matchLiveEntries) { link('matches', row.matchId, '直播比赛'); for (const image of row.images || []) link('matchLiveImages', image.id || image.imageId, '直播图片') }
  for (const name of ['evaluationConfigs', 'playerRatings', 'playerComments', 'playerAwards']) for (const row of data[name]) { link('competitions', row.competitionId, '评价赛事'); if (name !== 'evaluationConfigs') link('matches', row.matchId, '评价比赛') }
  // Rankings are computed from facts, never imported as a separate stale table.
  for (const c of data.competitions) { if (c.standingsRules) validateRules(c.standingsRules); calculateStandings(c, data.matches.filter(m => m.competitionId === c._id), maps.teams) }
  return normalize(data)
}
function assetIds(data) {
  const ids = new Set(), add = id => { if (typeof id === 'string' && id.startsWith('cloud://')) ids.add(id) }
  for (const u of data.users) add(u.avatarFileId)
  for (const t of data.teams) add(t.badgeFileId)
  for (const r of data.registrations) for (const a of r.attachments || []) add(a.fileID)
  for (const name of ['registrationFiles', 'newsImages', 'teamBadges', 'matchLiveImages']) for (const row of data[name]) if (row.status === 'ready') add(row.fileID)
  if (ids.size > MAX_ASSETS) fail('LIMIT_EXCEEDED', '本轮备份最多支持32个最终文件，请先安排分批归档方案。')
  return [...ids].sort()
}
function materialize(target, current) {
  const result = normalize(JSON.parse(JSON.stringify(target)))
  for (const name of COLLECTIONS) {
    const previous = new Map(current[name].map(r => [r._id, r]))
    for (const row of result[name]) {
      const before = previous.get(row._id)
      if (canonical(row) === canonical(before)) continue
      for (const field of ['version', 'scheduleMutationVersion']) if (Number.isSafeInteger(row[field]) || Number.isSafeInteger(before?.[field])) row[field] = Math.max(row[field] || 0, before?.[field] || 0) + 1
      if (name === 'users' && row.favorites) { row.favorites.version = Math.max(row.favorites.version || 0, before?.favorites?.version || 0) + 1; row.favorites.requests = [] }
      for (const key of ['lastRequestId','lastFingerprint','lastBadgeRequest','lastOwnerRequest','lastReviewRequest','lastAdminRequest','lastExpectedVersion','requests']) delete row[key]
    }
  }
  return result
}
function changes(current, target) {
  const operations = [], summary = []
  for (const name of COLLECTIONS) {
    const before = new Map(current[name].map(row => [row._id,row])), after = new Map(target[name].map(row => [row._id,row]))
    const stats = { collection: name, created: 0, updated: 0, removed: 0, unchanged: 0 }
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      if (canonical(before.get(id)) === canonical(after.get(id))) { stats.unchanged++; continue }
      stats[!after.has(id) ? 'removed' : before.has(id) ? 'updated' : 'created']++
      operations.push({ collection: name, id, before: before.get(id) || null, after: after.get(id) || null })
    }
    summary.push(stats)
  }
  return { operations, summary, totalChanges: operations.length }
}
module.exports = { COLLECTIONS, MAX_RECORDS, MAX_BYTES, MAX_CHANGES, CHUNK_BYTES, MAX_ASSETS, MAX_ASSET_BYTES, RecoveryError, fail, canonical, digest, backupKey, planKey, normalize, validateData, assetIds, materialize, changes }
