'use strict'

const { createHash } = require('node:crypto')
const { KINDS, normalize, rankSearch, compare } = require('./search-engine')
const { IMAGE_ID, NewsImageError, syncImageReferences, scopedObject, inventory } = require('./news-image-model')
const {badgeView} = require('./team-badge-model')
const CATEGORIES = ['快讯', '战报', '公告', '深度', '独家']
const PUBLIC_ACTIONS = ['news.listPublic', 'news.getPublic', 'search.public', 'search.suggestions', 'directory.teamPublic', 'directory.playerPublic']
const ACTIONS = [...PUBLIC_ACTIONS, 'news.listAdmin', 'news.getAdmin', 'news.create', 'news.update', 'news.delete', 'search.admin', 'content.overview']
const NEWS_ID = /^n_[a-f0-9]{32}$/, TEAM_ID = /^t_[a-f0-9]{64}$/, PLAYER_ID = /^p_[a-f0-9]{32}$/, COMPETITION_ID = /^c_[a-f0-9]{32}$/
class ContentError extends Error { constructor(code, message) { super(message); this.code = code } }
const fail = (code, message) => { throw new ContentError(code, message) }
const object = value => !!value && typeof value === 'object' && !Array.isArray(value)
function fields(value, allowed) { if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_ARGUMENT', '请求包含不支持的字段。') }
function text(value, label, max, optional = false) {
  if (typeof value !== 'string') fail('INVALID_ARGUMENT', `请填写${label}。`)
  const out = value.trim()
  if ((!optional && !out) || Array.from(out).length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(out)) fail('INVALID_ARGUMENT', `${label}为空、过长或包含无效字符。`)
  return out
}
function imageUrl(value, optional = false) {
  if (optional && value === '') return ''
  const out = text(value, '图片HTTPS地址', 500)
  try { const url = new URL(out); if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error() } catch { fail('INVALID_ARGUMENT', '图片须使用有效的HTTPS地址。') }
  return out
}
function validateNewsForm(value) {
  fields(value, ['title', 'category', 'excerpt', 'author', 'coverUrl', 'coverImageId', 'body', 'status', 'pinned', 'competitionId'])
  if (value.coverImageId != null && (typeof value.coverImageId !== 'string' || !IMAGE_ID.test(value.coverImageId))) fail('INVALID_ARGUMENT', '封面图片标识无效。')
  const form = { title: text(value.title, '标题', 80), category: value.category, excerpt: text(value.excerpt, '摘要', 200, true), author: text(value.author, '作者', 40), coverUrl: value.coverImageId ? '' : imageUrl(value.coverUrl, true), ...(value.coverImageId ? {coverImageId:value.coverImageId} : {}), status: value.status, pinned: value.pinned, competitionId: value.competitionId }
  if (!CATEGORIES.includes(form.category) || !['draft', 'published'].includes(form.status) || typeof form.pinned !== 'boolean' || form.competitionId !== null && (typeof form.competitionId !== 'string' || !COMPETITION_ID.test(form.competitionId))) fail('INVALID_ARGUMENT', '分类、发布状态、置顶或关联赛事无效。')
  if (!Array.isArray(value.body) || !value.body.length || value.body.length > 30) fail('INVALID_ARGUMENT', '正文须包含1–30个文字或图片段落。')
  form.body = value.body.map(block => {
    if (block?.type === 'text') { fields(block, ['type', 'text']); return { type: 'text', text: text(block.text, '正文段落', 2000) } }
    if (block?.type === 'image') {
      fields(block, ['type', 'url', 'caption', 'imageId'])
      if (block.imageId != null && (typeof block.imageId !== 'string' || !IMAGE_ID.test(block.imageId))) fail('INVALID_ARGUMENT', '正文图片标识无效。')
      return { type: 'image', url: block.imageId ? '' : imageUrl(block.url), ...(block.imageId ? {imageId:block.imageId} : {}), caption: text(block.caption, '图片说明', 100, true) }
    }
    fail('INVALID_ARGUMENT', '正文仅支持文字和图片段落。')
  })
  if (Buffer.byteLength(JSON.stringify(form)) > 12000) fail('INVALID_ARGUMENT', '正文和图片地址合计过长，请精简后保存。')
  return form
}
const iso = value => new Date(value).toISOString()
const chinaTime = value => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ')
function article(record, admin = false, full = false) {
  const out = { id: record._id, title: record.title, category: record.category, excerpt: record.excerpt, author: record.author, coverUrl: record.coverUrl, pinned: record.pinned, competitionId: record.competitionId, publishedAt: record.publishedAt === null ? null : iso(record.publishedAt), updatedAt: iso(record.updatedAt) }
  if (full) out.body = record.body.map(b => b.type === 'text' ? {...b} : {type:'image',url:b.url,caption:b.caption,...(admin && b.imageId ? {imageId:b.imageId} : {})})
  if (admin) Object.assign(out, { status: record.status, version: record.version, createdAt: iso(record.createdAt), coverImageId:record.coverImageId || null })
  return out
}
function page(rows, cursor, scope) {
  const stamp = createHash('sha256').update(JSON.stringify([scope, rows])).digest('hex').slice(0, 32)
  let offset = 0
  if (cursor != null) {
    if (typeof cursor !== 'string' || !/^[a-f0-9]{32}:\d{1,6}$/.test(cursor)) fail('INVALID_ARGUMENT', '分页位置无效，请重新搜索或刷新。')
    const [key, index] = cursor.split(':'); offset = Number(index)
    if (key !== stamp) fail('CONFLICT', '内容已更新，请刷新后继续。')
    if (!offset || offset % 20 || offset >= rows.length) fail('INVALID_ARGUMENT', '分页位置无效，请刷新。')
  }
  return { items: rows.slice(offset, offset + 20), nextCursor: rows.length > offset + 20 ? `${stamp}:${offset + 20}` : null, total: rows.length }
}
function publicTeam(record) { return { id: record._id, name: record.name, district: record.district, description: record.description || '', players: (record.roster || []).map(player => ({ id: player.id, name: player.name, number: player.number, position: player.position })).sort((a, b) => a.number - b.number) } }
async function catalog(store, publicOnly) {
  const [competitions, allTeams, allMatches, news, registrations] = await Promise.all(['competitions', 'teams', 'matches', 'newsArticles', 'registrations'].map(collection => store.scan(collection)))
  const visible = new Set(competitions.filter(c => c.displayEnabled === true).map(c => c._id))
  const approved = new Set(registrations.filter(r => r.status === 'approved' && visible.has(r.competitionId)).map(r => r.teamId))
  const teams = allTeams.filter(t => !publicOnly || t.status !== 'dissolved' && approved.has(t._id))
  const matches = allMatches.filter(m => !publicOnly || visible.has(m.competitionId) && ['scheduled', 'postponed', 'live', 'finished'].includes(m.status))
  const articles = news.filter(n => !n.deletedAt && (!publicOnly || n.status === 'published' && (!n.competitionId || visible.has(n.competitionId))))
  return { competitions, teams, matches, articles, allTeams }
}
function searchItems(data) {
  const names = new Map(data.allTeams.map(t => [t._id, t.name])), competitions = new Map(data.competitions.map(c => [c._id, c.name]))
  return [
    ...data.teams.map(t => ({ kind: 'team', id: t._id, title: t.name, detail: t.district, teamId: t._id, searchText: `${t.district} ${t.description || ''}` })),
    ...data.teams.flatMap(t => (t.roster || []).map(p => ({ kind: 'player', id: p.id, title: p.name, detail: `${t.name} · ${p.number}号`, teamId: t._id, searchText: `${t.name} ${p.number} ${p.position}` }))),
    ...data.matches.map(m => ({ kind: 'match', id: m._id, competitionId: m.competitionId, title: `${names.get(m.homeTeamId) || '待定球队'} vs ${names.get(m.awayTeamId) || '待定球队'}`, detail: `${competitions.get(m.competitionId) || ''} · ${chinaTime(m.scheduledAt)} 北京时间 · ${m.venue}`, searchText: `${m.venue} ${competitions.get(m.competitionId) || ''} ${m.stage} ${m.status}` })),
    ...data.articles.map(n => ({ kind: 'news', id: n._id, title: n.title, detail: `${n.category} · ${n.author}`, searchText: `${n.category} ${n.excerpt} ${n.body.filter(b => b.type === 'text').map(b => b.text).join(' ')}` })),
  ]
}
const safeSearchItem = ({ searchText, ...item }) => item

function createContentService({ store, storage, authorize, now = Date.now, logger = console }) {
  async function present(record, admin = false, full = false) {
    const out = article(record,admin,full), cache = new Map()
    async function link(id) {
      if (!cache.has(id)) cache.set(id,(async () => {
        const file = await store.read('newsImages',id)
        if (!storage || file?.articleId !== record._id || file.status !== 'ready' || !file.referenced || !inventory(file).some(o => o.fileID === file.fileID && scopedObject(file,o,storage))) throw new Error('Referenced image unavailable')
        const url = await storage.link(file.fileID), parsed = new URL(url)
        if (url.length > 2000 || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error('Invalid image URL')
        return url
      })())
      return cache.get(id)
    }
    if (record.coverImageId) out.coverUrl = await link(record.coverImageId)
    if (full) for (let i=0;i<record.body.length;i++) if (record.body[i].imageId) out.body[i].url = await link(record.body[i].imageId)
    return out
  }
  return async event => {
    try {
      if (!object(event) || !ACTIONS.includes(event.action)) fail('INVALID_ARGUMENT', '不支持的内容操作。')
      const action = event.action, publicOnly = PUBLIC_ACTIONS.includes(action)
      if (!publicOnly) { const auth = await authorize(event.token); if (!auth.ok) return auth }
      const base = ['action', 'token', 'userInfo', 'tcbContext']
      if (['news.create', 'news.update', 'news.delete'].includes(action)) {
        fields(event, [...base, ...(action === 'news.create' ? ['requestId', 'form'] : action === 'news.update' ? ['id', 'expectedVersion', 'form'] : ['id', 'expectedVersion'])])
        if (action === 'news.create' ? typeof event.requestId !== 'string' || !/^[a-f0-9]{32}$/.test(event.requestId) : typeof event.id !== 'string' || !NEWS_ID.test(event.id) || !Number.isSafeInteger(event.expectedVersion) || event.expectedVersion < 1) fail('INVALID_ARGUMENT', '记录标识或版本无效，请重新读取。')
        const form = action === 'news.delete' ? null : validateNewsForm(event.form)
        if (form?.competitionId && !await store.read('competitions', form.competitionId)) fail('INVALID_ARGUMENT', '关联赛事不存在。')
        const id = action === 'news.create' ? `n_${event.requestId}` : event.id
        const fingerprint = form ? createHash('sha256').update(JSON.stringify(form)).digest('hex') : null
        const result = await store.transaction(id, async (record, save, tx) => {
          if (action === 'news.create' && record) {
            if (record.creationFingerprint !== fingerprint || record.deletedAt) fail('CONFLICT', '本次创建请求已使用，请刷新后重试。')
            return { ok: true, created: false, record }
          }
          if (action !== 'news.create' && (!record || record.deletedAt)) fail('NOT_FOUND', '内容不存在或已删除。')
          if (record && record.version !== event.expectedVersion) fail('CONFLICT', '内容已被修改，请重新读取后编辑。')
          const time = now()
          const updated = { ...record, ...form, coverImageId:form?.coverImageId || (action === 'news.delete' ? record.coverImageId : null) || null, _id: id, version: record ? record.version + 1 : 1, createdAt: record?.createdAt ?? time, updatedAt: time, publishedAt: form?.status === 'published' ? record?.publishedAt ?? time : record?.publishedAt ?? null, deletedAt: action === 'news.delete' ? time : null, creationFingerprint: record?.creationFingerprint || fingerprint }
          await syncImageReferences(tx,id,record,updated,time)
          await save(updated)
          return action === 'news.delete' ? { ok: true } : { ok: true, created: action === 'news.create', record:updated }
        })
        if (!result.record) return result
        try { return {ok:true,created:result.created,article:await present(result.record,true,true)} }
        catch { fail('WRITE_COMMITTED','内容已保存，但图片链接暂不可用。请刷新列表后重新打开，勿重复提交。') }
      }
      if (['news.listPublic', 'news.listAdmin'].includes(action)) {
        fields(event, [...base, 'category', 'cursor'])
        if (event.category != null && !CATEGORIES.includes(event.category)) fail('INVALID_ARGUMENT', '新闻分类无效。')
        const [news, competitions] = await Promise.all([store.scan('newsArticles'), store.scan('competitions')])
        const visible = new Set(competitions.filter(c => c.displayEnabled === true).map(c => c._id))
        const rows = news.filter(n => !n.deletedAt && (!event.category || n.category === event.category) && (!publicOnly || n.status === 'published' && (!n.competitionId || visible.has(n.competitionId))))
          .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.publishedAt ?? b.updatedAt) - (a.publishedAt ?? a.updatedAt) || compare(a._id, b._id))
        const result = page(rows, event.cursor, [action, event.category || 'all'])
        return { ok: true, articles: await Promise.all(result.items.map(n => present(n,!publicOnly))), nextCursor: result.nextCursor, total: result.total }
      }
      if (['news.getPublic', 'news.getAdmin'].includes(action)) {
        fields(event, [...base, 'id'])
        const record = typeof event.id === 'string' && NEWS_ID.test(event.id) ? await store.read('newsArticles', event.id) : null
        if (!record || record.deletedAt || publicOnly && (record.status !== 'published' || record.competitionId && !(await store.read('competitions', record.competitionId))?.displayEnabled)) fail('NOT_FOUND', '内容不存在或暂未公开。')
        return { ok: true, article: await present(record, !publicOnly, true) }
      }
      if (['search.public', 'search.admin'].includes(action)) {
        fields(event, [...base, 'query', 'kind', 'cursor'])
        const query = normalize(text(event.query, '搜索词', 40)), kind = event.kind || 'all'
        if (!['all', ...KINDS].includes(kind)) fail('INVALID_ARGUMENT', '搜索类型无效。')
        const data = await catalog(store, publicOnly), ranked = rankSearch(searchItems(data), query)
        const counts = Object.fromEntries(KINDS.map(k => [k, ranked.filter(r => r.kind === k).length]))
        const result = page(ranked.filter(r => kind === 'all' || r.kind === kind).map(safeSearchItem), event.cursor, [action, query, kind])
        return { ok: true, results: result.items, counts, nextCursor: result.nextCursor, total: result.total }
      }
      if (action === 'search.suggestions') {
        fields(event, base)
        const data = await catalog(store, true)
        return { ok: true, words: [...new Set([...data.teams.map(t => t.name).sort(compare).filter(s => Array.from(s).length <= 40).slice(0, 4), ...CATEGORIES])].slice(0, 8) }
      }
      if (action === 'directory.teamPublic' || action === 'directory.playerPublic') {
        fields(event, [...base, 'id', ...(action === 'directory.playerPublic' ? ['teamId'] : [])])
        if (typeof event.id !== 'string' || (action === 'directory.teamPublic' ? !TEAM_ID.test(event.id) : !PLAYER_ID.test(event.id) || typeof event.teamId !== 'string' || !TEAM_ID.test(event.teamId))) fail('NOT_FOUND', '档案不存在或暂未公开。')
        const data = await catalog(store, true), record = data.teams.find(t => t._id === (event.teamId || event.id))
        if (!record) fail('NOT_FOUND', '档案不存在或暂未公开。')
        const team = publicTeam(record)
        if (action === 'directory.teamPublic') { const {hasBadge,badgeUrl}=await badgeView(record,storage); return { ok: true, team:{...team,hasBadge,badgeUrl} } }
        const player = team.players.find(p => p.id === event.id)
        if (!player) fail('NOT_FOUND', '档案不存在或暂未公开。')
        return { ok: true, player: { ...player, teamId: team.id, teamName: team.name, district: team.district } }
      }
      fields(event, base)
      const data = await catalog(store, false)
      return { ok: true, counts: { teams: data.teams.filter(t => t.status !== 'dissolved').length, matches: data.matches.length, goals: data.matches.filter(m => m.status === 'finished').reduce((sum, m) => sum + (m.result?.homeScore ?? 0) + (m.result?.awayScore ?? 0), 0), news: data.articles.length, publishedNews: data.articles.filter(n => n.status === 'published').length }, recentNews: await Promise.all(data.articles.sort((a, b) => b.updatedAt - a.updatedAt || compare(a._id, b._id)).slice(0, 5).map(n => present(n,true))), serverTime: iso(now()) }
    } catch (error) {
      if (error instanceof ContentError || error instanceof NewsImageError) return { ok: false, error: { code: error.code, message: error.message } }
      logger?.error?.('[content] operation failed')
      return { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '内容服务暂不可用，请稍后重试。' } }
    }
  }
}
module.exports = { createContentService, PUBLIC_ACTIONS, CATEGORIES, validateNewsForm }
