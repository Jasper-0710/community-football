'use strict'

const { userId, DEFAULT_APP_ID } = require('./service')
const TEAM_ID = /^t_[a-f0-9]{64}$/
const MAX_FAVORITES = 50
class FavoritesError extends Error {
  constructor(code, message) { super(message); this.code = code }
}
const fail = (code, message) => { throw new FavoritesError(code, message) }
const object = value => value && typeof value === 'object' && !Array.isArray(value)
function savedFavorites(user) {
  if (user.favorites === undefined) return { version: 0, teamIds: [], updatedAt: null }
  const value = user.favorites
  if (!object(value) || !Number.isSafeInteger(value.version) || value.version < 1
    || !Array.isArray(value.teamIds) || value.teamIds.length > MAX_FAVORITES
    || !value.teamIds.every(id => typeof id === 'string' && TEAM_ID.test(id))
    || new Set(value.teamIds).size !== value.teamIds.length
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) {
    fail('FAVORITES_UNAVAILABLE', '收藏记录暂不可用，请联系管理员。')
  }
  return { version: value.version, teamIds: [...value.teamIds], updatedAt: value.updatedAt }
}

function createFavoritesHandler({ store, context, expectedAppId = DEFAULT_APP_ID, now = () => new Date(), logger = console }) {
  async function publicReferences() {
    // Match directory.teamPublic: approved entry in a visible competition.
    // Scans use the default _id index, page explicitly, and fail closed at the cap.
    const [competitions, registrations] = await Promise.all([store.scan('competitions'), store.scan('registrations')])
    const visible = new Set(competitions.filter(c => c.displayEnabled === true).map(c => c._id))
    return registrations.filter(r => r.status === 'approved' && visible.has(r.competitionId))
  }
  async function present(owner, saved) {
    const references = saved.teamIds.length ? await publicReferences() : []
    const publicIds = new Set(references.map(r => r.teamId))
    const teams = await Promise.all(saved.teamIds.map(async id => {
      const team = publicIds.has(id) ? await store.read('teams', id) : null
      // Do not expose the name, district, roster or contacts of a hidden/dissolved team.
      const available = !!team && team.status !== 'dissolved'
      return { id, available, name: available ? team.name : '', district: available ? team.district : '' }
    }))
    return { ok: true, favorites: { owner, ...saved, teams } }
  }
  return async event => {
    try {
      const wx = context()
      if (!wx || typeof wx.OPENID !== 'string' || !wx.OPENID || !wx.APPID) fail('AUTH_REQUIRED', '请先在微信小程序中登录。')
      if (wx.APPID !== expectedAppId) fail('APP_MISMATCH', '当前小程序不能访问此收藏服务。')
      const owner = userId(wx.APPID, wx.OPENID)
      const allowed = ['action', 'expectedOwner', 'userInfo', 'tcbContext']
      if (event?.action === 'favorites.set') allowed.push('teamId', 'favorite', 'expectedVersion')
      if (event?.action === 'favorites.merge') allowed.push('teamIds', 'expectedVersion')
      if (!object(event) || !['favorites.get', 'favorites.set', 'favorites.merge'].includes(event.action)
        || Object.keys(event).some(key => !allowed.includes(key))) fail('INVALID_ARGUMENT', '收藏请求包含不支持的字段。')
      // A precondition only: identity and authorization always come from getWXContext().
      if (event.expectedOwner !== owner) fail('IDENTITY_CHANGED', '微信身份已变化，请重新登录后读取收藏。')
      const changing = event.action !== 'favorites.get'
      if (changing && (!Number.isSafeInteger(event.expectedVersion) || event.expectedVersion < 0)) fail('INVALID_ARGUMENT', '请先读取最新收藏。')
      if (event.action === 'favorites.set' && (typeof event.teamId !== 'string' || !TEAM_ID.test(event.teamId) || typeof event.favorite !== 'boolean')) fail('INVALID_ARGUMENT', '请选择真实球队及有效的收藏操作。')
      if (event.action === 'favorites.merge' && (!Array.isArray(event.teamIds) || !event.teamIds.length || event.teamIds.length > MAX_FAVORITES
        || !event.teamIds.every(id => typeof id === 'string' && TEAM_ID.test(id)) || new Set(event.teamIds).size !== event.teamIds.length)) fail('INVALID_ARGUMENT', '游客收藏列表无效。')
      const additions = event.action === 'favorites.merge' ? event.teamIds : event.favorite ? [event.teamId] : []
      const references = additions.length ? await publicReferences() : []
      const saved = await store.atomic(async tx => {
        const user = await tx.get('users', owner)
        if (!user || user.appId !== wx.APPID || user.openId !== wx.OPENID) fail('AUTH_REQUIRED', '请先登录个人中心。')
        const current = savedFavorites(user)
        if (!changing) return current
        const nextIds = event.action === 'favorites.merge' ? [...new Set([...current.teamIds, ...event.teamIds])]
          : event.favorite ? [...new Set([...current.teamIds, event.teamId])] : current.teamIds.filter(id => id !== event.teamId)
        // An acknowledged desired state is idempotent, even after a lost response.
        if (JSON.stringify(nextIds) === JSON.stringify(current.teamIds)) return current
        if (event.expectedVersion !== current.version) fail('CONFLICT', '收藏已在其他设备更新，请重新同步后操作。')
        if (nextIds.length > MAX_FAVORITES) fail('FAVORITES_LIMIT', `最多关注 ${MAX_FAVORITES} 支球队，请先取消部分关注。`)
        const documents = new Map()
        async function get(collection, id) {
          const key = `${collection}:${id}`
          if (!documents.has(key)) documents.set(key, await tx.get(collection, id))
          return documents.get(key)
        }
        for (const id of additions.filter(id => !current.teamIds.includes(id))) {
          const team = await get('teams', id)
          let visible = false
          for (const candidate of references.filter(r => r.teamId === id)) {
            const registration = await get('registrations', candidate._id)
            const competition = await get('competitions', candidate.competitionId)
            if (registration?.teamId === id && registration.competitionId === candidate.competitionId
              && registration.status === 'approved' && competition?.displayEnabled === true) { visible = true; break }
          }
          if (!team || team.status === 'dissolved' || !visible) fail('TEAM_UNAVAILABLE', '部分球队已下架或暂未公开，请移除对应游客收藏后再试。')
        }
        const next = { version: current.version + 1, teamIds: nextIds, updatedAt: now().toISOString() }
        await tx.saveFavorites(owner, next)
        return next
      })
      return await present(owner, saved)
    } catch (error) {
      if (error instanceof FavoritesError) return { ok: false, error: { code: error.code, message: error.message } }
      logger?.error?.('[favorites] cloud operation failed')
      return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '收藏同步失败，请重新同步确认云端结果后再操作。' } }
    }
  }
}

module.exports = { createFavoritesHandler, MAX_FAVORITES }
