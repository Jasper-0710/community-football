'use strict'

const { createHash } = require('node:crypto')
const { calculateStandings } = require('./standings-engine')
const { recordView } = require('./matches')
const { badgeView } = require('./team-badge-model')

const PUBLIC_ACTIONS = ['directory.homePublic', 'directory.teamProfilePublic', 'directory.playerProfilePublic']
const TEAM = /^t_[a-f0-9]{64}$/, PLAYER = /^p_[a-f0-9]{32}$/, COMPETITION = /^c_[a-f0-9]{32}$/
const STATUSES = ['scheduled', 'postponed', 'live', 'finished']
class DirectoryError extends Error { constructor(code, message) { super(message); this.code = code } }
const fail = (code, message) => { throw new DirectoryError(code, message) }
const day = value => new Date(Number(value) + 8 * 3600000).toISOString().slice(0, 10)
const chronological = (a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) || a._id.localeCompare(b._id)
const finished = match => match.status === 'finished' && !!match.result

// Always scope registrations to their own visible competition. Being public in
// one competition must not reveal a team's hidden or unapproved participation.
async function snapshot(store) {
  const [allCompetitions, allTeams, registrations, records] = await Promise.all(['competitions', 'teams', 'registrations', 'matches'].map(name => store.scan(name)))
  const competitions = allCompetitions.filter(c => c.displayEnabled === true).sort((a, b) => a._id.localeCompare(b._id))
  const visible = new Set(competitions.map(c => c._id))
  const active = new Map(allTeams.filter(t => t.status !== 'dissolved').map(t => [t._id, t]))
  const enrolled = new Map(competitions.map(c => [c._id, new Set()]))
  for (const r of registrations) if (r.status === 'approved' && visible.has(r.competitionId) && active.has(r.teamId)) enrolled.get(r.competitionId).add(r.teamId)
  const publicIds = new Set([...enrolled.values()].flatMap(ids => [...ids]))
  const teams = new Map([...active].filter(([id]) => publicIds.has(id)))
  const matches = []
  for (const competition of competitions) {
    const eligible = enrolled.get(competition._id)
    const rows = records.filter(m => m.competitionId === competition._id && STATUSES.includes(m.status)
      && ['home', 'away'].every(side => m[`${side}Qualification`] || m[`${side}From`] || !m[`${side}TeamId`] || eligible.has(m[`${side}TeamId`])))
      .map(m => m.result ? { ...m, result: { ...m.result, goals: m.result.goals || [], cards: m.result.cards || [], substitutions: m.result.substitutions || [] } } : m)
    // Resolve qualification and previous-round winners using the same engine as
    // the public schedule. Never carry a stale, stored team ID into a profile.
    for (const m of calculateStandings(competition, rows, teams).matches) {
      if ([m.homeTeamId, m.awayTeamId].some(id => id && !eligible.has(id))) continue
      if (['live', 'finished'].includes(m.status) && (!m.homeTeamId || !m.awayTeamId)) continue
      matches.push(m)
    }
  }
  return { competitions, teams, enrolled, matches }
}
function teamView(t) {
  return { id: t._id, name: t.name, district: t.district, description: t.description || '', players: (t.roster || []).map(p => ({ id: p.id, name: p.name, number: p.number, position: p.position })).sort((a, b) => a.number - b.number) }
}
function matchView(m, data) {
  return { competitionName: data.competitions.find(c => c._id === m.competitionId).name,
    match: { ...recordView(m), homeTeamName: data.teams.get(m.homeTeamId)?.name || null, awayTeamName: data.teams.get(m.awayTeamId)?.name || null } }
}
function teamSummary(matches, teamId) {
  const out = { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, difference: 0 }
  for (const m of matches.filter(finished)) {
    const home = m.homeTeamId === teamId, gf = home ? m.result.homeScore : m.result.awayScore, ga = home ? m.result.awayScore : m.result.homeScore
    out.played++; out.goalsFor += gf; out.goalsAgainst += ga
    if (gf > ga) out.won++; else if (gf < ga) out.lost++; else out.drawn++
  }
  out.difference = out.goalsFor - out.goalsAgainst
  return out
}
function playerEvents(m, teamId, playerId) {
  if (!finished(m)) return []
  const events = []
  const add = (kind, minute) => events.push({ kind, minute })
  for (const g of m.result.goals) if (g.teamId === teamId && !g.ownGoal) {
    if (g.scorer?.id === playerId) add('goal', g.minute)
    if (g.assist?.id === playerId) add('assist', g.minute)
  }
  for (const c of m.result.cards) if (c.teamId === teamId && c.player?.id === playerId) add(c.kind, c.minute)
  for (const s of m.result.substitutions) if (s.teamId === teamId) {
    if (s.playerIn?.id === playerId) add('subIn', s.minute)
    if (s.playerOut?.id === playerId) add('subOut', s.minute)
  }
  return events.sort((a, b) => a.minute - b.minute || a.kind.localeCompare(b.kind))
}
function page(rows, cursor, scope) {
  const stamp = createHash('sha256').update(JSON.stringify([scope, rows])).digest('hex').slice(0, 32)
  let offset = 0
  if (cursor != null) {
    if (typeof cursor !== 'string' || !/^[a-f0-9]{32}:\d{1,6}$/.test(cursor)) fail('INVALID_ARGUMENT', '分页位置无效，请刷新档案。')
    const [key, value] = cursor.split(':'); offset = Number(value)
    if (key !== stamp) fail('CONFLICT', '比赛记录已更新，请刷新档案后继续。')
    if (!offset || offset % 20 || offset >= rows.length) fail('INVALID_ARGUMENT', '分页位置无效，请刷新档案。')
  }
  return { matches: rows.slice(offset, offset + 20), total: rows.length, nextCursor: rows.length > offset + 20 ? `${stamp}:${offset + 20}` : null }
}
async function readDirectory(event, { store, storage, now = Date.now }) {
  const action = event.action, home = action === 'directory.homePublic', player = action === 'directory.playerProfilePublic'
  const allowed = ['action', 'userInfo', 'tcbContext', ...(home ? [] : ['id', 'competitionId', 'cursor', ...(player ? ['teamId'] : [])])]
  if (Object.keys(event).some(k => !allowed.includes(k))) fail('INVALID_ARGUMENT', '请求包含不支持的字段。')
  if (!home && (typeof event.id !== 'string' || !(player ? PLAYER : TEAM).test(event.id) || player && (typeof event.teamId !== 'string' || !TEAM.test(event.teamId)))) fail('NOT_FOUND', '档案不存在或暂未公开。')
  if (event.competitionId != null && (typeof event.competitionId !== 'string' || !COMPETITION.test(event.competitionId))) fail('INVALID_ARGUMENT', '赛事标识无效。')
  const data = await snapshot(store)
  if (home) {
    const today = day(now()), ordered = [...data.matches].sort(chronological)
    const focus = ordered.find(m => m.status === 'live')
      || ordered.find(m => day(Date.parse(m.scheduledAt)) === today)
      || ordered.find(m => day(Date.parse(m.scheduledAt)) > today)
      || ordered[ordered.length - 1]
    const selectedDate = focus ? day(Date.parse(focus.scheduledAt)) : null
    const matches = ordered.filter(m => day(Date.parse(m.scheduledAt)) === selectedDate)
    const previews = [...data.teams.values()].sort((a, b) => a._id.localeCompare(b._id)).slice(0, 6)
    return { ok: true, home: { today, counts: { competitions: data.competitions.length, teams: data.teams.size, matches: ordered.length, finished: ordered.filter(finished).length },
      matchday: { date: selectedDate, total: matches.length, live: matches.filter(m => m.status === 'live').length, matches: matches.slice(0, 6).map(m => matchView(m, data)) },
      teams: await Promise.all(previews.map(async t => ({ id: t._id, name: t.name, district: t.district, playerCount: (t.roster || []).length, ...await badgeView(t, storage) }))) } }
  }
  const teamId = player ? event.teamId : event.id, t = data.teams.get(teamId)
  if (!t) fail('NOT_FOUND', '档案不存在或暂未公开。')
  const team = teamView(t), p = player ? team.players.find(p => p.id === event.id) : null
  if (player && !p) fail('NOT_FOUND', '球员不在当前公开球队名单中。')
  const competitions = data.competitions.filter(c => data.enrolled.get(c._id).has(teamId)).map(c => ({ id: c._id, name: c.name }))
  if (event.competitionId && !competitions.some(c => c.id === event.competitionId)) fail('NOT_FOUND', '赛事不存在或该球队暂未公开参赛。')
  const matches = data.matches.filter(m => [m.homeTeamId, m.awayTeamId].includes(teamId) && (!event.competitionId || m.competitionId === event.competitionId))
  // Most recent records first; all pages are bound to the current projection so
  // corrections, revocations and visibility edits invalidate an old cursor.
  const ordered = [...matches].sort((a, b) => -chronological(a, b))
  const rows = player ? ordered.map(m => ({ ...matchView(m, data), events: playerEvents(m, teamId, event.id) })).filter(r => r.events.length) : ordered.map(m => matchView(m, data))
  let summary = teamSummary(matches, teamId)
  if (player) {
    summary = { goals: 0, assists: 0, yellow: 0, red: 0, eventMatches: rows.length }
    const metric = { goal: 'goals', assist: 'assists', yellow: 'yellow', red: 'red' }
    for (const r of rows) for (const e of r.events) if (metric[e.kind]) summary[metric[e.kind]]++
  }
  const record = { competitionId: event.competitionId || null, competitions, summary, ...page(rows, event.cursor, [action, teamId, event.id, event.competitionId || null]) }
  if (player) return { ok: true, player: { ...p, teamId, teamName: team.name, district: team.district }, record }
  return { ok: true, team: { ...team, ...await badgeView(t, storage) }, record }
}

module.exports = { PUBLIC_ACTIONS, DirectoryError, readDirectory }
