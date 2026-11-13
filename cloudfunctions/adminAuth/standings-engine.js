'use strict'

class StandingsError extends Error { constructor(code, message) { super(message); this.code = code } }
const fail = (message, code = 'INVALID_ARGUMENT') => { throw new StandingsError(code, message) }
const TEAM_ID = /^t_[a-f0-9]{64}$/
const PLAYER_ID = /^p_[a-f0-9]{32}$/
const stages = ['group', 'quarter', 'semi', 'final']
const defaults = { winPoints: 3, drawPoints: 1, lossPoints: 0, legs: 1, groups: [] }
function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('请求包含不支持的字段。')
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label}须为${min}–${max}的整数。`)
  return value
}
function cleanText(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label}格式不正确。`)
  return value.trim()
}
function validateRules(value) {
  fields(value, ['winPoints', 'drawPoints', 'lossPoints', 'legs', 'groups'])
  const result = {
    winPoints: integer(value.winPoints, 0, 10, '胜场积分'), drawPoints: integer(value.drawPoints, 0, 10, '平场积分'),
    lossPoints: integer(value.lossPoints, 0, 10, '负场积分'), legs: integer(value.legs, 1, 2, '循环轮数'), groups: [],
  }
  if (result.winPoints <= result.drawPoints || result.drawPoints < result.lossPoints) fail('胜场积分须高于平场，平场积分不得低于负场。')
  if (!Array.isArray(value.groups) || value.groups.length > 16) fail('最多设置16个分组。')
  const groupIds = new Set(), teamIds = new Set()
  for (const group of value.groups) {
    fields(group, ['id', 'teamIds'])
    const id = cleanText(group.id, 40, '分组名称')
    if (groupIds.has(id) || !Array.isArray(group.teamIds) || group.teamIds.length < 2 || group.teamIds.length > 32) fail('分组名称须唯一，每组须有2–32支球队。')
    groupIds.add(id)
    for (const teamId of group.teamIds) {
      if (typeof teamId !== 'string' || !TEAM_ID.test(teamId) || teamIds.has(teamId)) fail('分组球队无效或重复，一支球队只能属于一个分组。')
      teamIds.add(teamId)
    }
    result.groups.push({ id, teamIds: [...group.teamIds] })
  }
  if (teamIds.size > 128) fail('每项赛事最多配置128支球队。')
  return result
}
function qualification(value) {
  if (value == null) return null
  fields(value, ['groupId', 'rank'])
  return { groupId: cleanText(value.groupId, 40, '来源分组'), rank: integer(value.rank, 1, 32, '来源名次') }
}
function rankRows(rows, equal) {
  rows.forEach((row, index) => { row.rank = index && equal(row, rows[index - 1]) ? rows[index - 1].rank : index + 1 })
  return rows
}
function winner(match) {
  if (match.status !== 'finished' || !match.result || !match.homeTeamId || !match.awayTeamId) return null
  const { homeScore, awayScore, penalties } = match.result
  if (homeScore !== awayScore) return homeScore > awayScore ? match.homeTeamId : match.awayTeamId
  if (!penalties || penalties[0] === penalties[1]) return null
  return penalties[0] > penalties[1] ? match.homeTeamId : match.awayTeamId
}
function publicTeam(teamId, teams) { return { teamId, teamName: teams.get(teamId)?.name || '参赛球队' } }
function calculateStandings(competition, records, teams = new Map()) {
  const rules = competition.standingsRules || { ...defaults, groups: [] }
  const groups = rules.groups.map(group => {
    const rows = new Map(group.teamIds.map(teamId => [teamId, { ...publicTeam(teamId, teams), rank: 0, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, difference: 0, points: 0 }]))
    const matches = records.filter(match => match.stage === 'group' && match.groupId === group.id)
    const pairs = new Map()
    let valid = true
    for (const match of matches) {
      if (!rows.has(match.homeTeamId) || !rows.has(match.awayTeamId) || match.homeTeamId === match.awayTeamId) { valid = false; continue }
      const key = [match.homeTeamId, match.awayTeamId].sort().join(':')
      pairs.set(key, (pairs.get(key) || 0) + 1)
      if (match.status !== 'finished' || !match.result) continue
      for (const [teamId, gf, ga] of [[match.homeTeamId, match.result.homeScore, match.result.awayScore], [match.awayTeamId, match.result.awayScore, match.result.homeScore]]) {
        const row = rows.get(teamId)
        row.played++; row.goalsFor += gf; row.goalsAgainst += ga; row.difference = row.goalsFor - row.goalsAgainst
        if (gf > ga) { row.won++; row.points += rules.winPoints } else if (gf === ga) { row.drawn++; row.points += rules.drawPoints } else { row.lost++; row.points += rules.lossPoints }
      }
    }
    const expected = group.teamIds.length * (group.teamIds.length - 1) / 2 * rules.legs
    const complete = valid && matches.length === expected && pairs.size === expected / rules.legs
      && [...pairs.values()].every(count => count === rules.legs) && matches.every(match => match.status === 'finished' && match.result)
    const sorted = [...rows.values()].sort((a, b) => b.points - a.points || b.difference - a.difference || b.goalsFor - a.goalsFor || a.teamId.localeCompare(b.teamId))
    rankRows(sorted, (a, b) => a.points === b.points && a.difference === b.difference && a.goalsFor === b.goalsFor)
    return { id: group.id, complete, expectedMatches: expected, scheduledMatches: matches.length, finishedMatches: matches.filter(match => match.status === 'finished' && match.result).length, rows: sorted }
  })
  const groupTeam = source => {
    const group = groups.find(item => item.id === source.groupId)
    if (!group?.complete) return null
    const matches = group.rows.filter(row => row.rank === source.rank)
    return matches.length === 1 ? matches[0].teamId : null
  }
  const cache = new Map(), byId = new Map(records.map(record => [record._id, record]))
  function resolve(record, path = new Set()) {
    if (cache.has(record._id)) return cache.get(record._id)
    if (path.has(record._id)) fail('晋级来源存在循环引用。', 'CONFLICT')
    const nextPath = new Set(path).add(record._id)
    const side = name => {
      const q = record[`${name}Qualification`], from = record[`${name}From`]
      if (q) return groupTeam(q)
      if (from) { const prior = byId.get(from); return prior ? winner(resolve(prior, nextPath)) : null }
      return record[`${name}TeamId`] || null
    }
    const resolved = { ...record, homeTeamId: side('home'), awayTeamId: side('away') }
    cache.set(record._id, resolved)
    return resolved
  }
  const matches = records.map(record => resolve(record))
  const totals = new Map()
  for (const match of matches) {
    if (match.status !== 'finished' || !match.result) continue
    for (const goal of match.result.goals) {
      if (goal.ownGoal) continue
      for (const [player, metric] of [[goal.scorer, 'goals'], [goal.assist, 'assists']]) {
        if (!player) continue
        const key = `${goal.teamId}:${player.id}`
        if (!totals.has(key)) totals.set(key, { ...publicTeam(goal.teamId, teams), playerId: player.id, playerName: player.name, number: player.number, goals: 0, assists: 0 })
        totals.get(key)[metric]++
      }
    }
  }
  const ranking = metric => rankRows([...totals.values()].filter(row => row[metric] > 0).map(row => ({ ...row, value: row[metric] }))
    .sort((a, b) => b.value - a.value || a.playerId.localeCompare(b.playerId) || a.teamId.localeCompare(b.teamId)), (a, b) => a.value === b.value)
  const finals = matches.filter(match => match.stage === 'final')
  return { rules, groups, goals: ranking('goals'), assists: ranking('assists'), matches, championTeamId: finals.length === 1 ? winner(finals[0]) : null }
}
function assertSchedule(records, rules) {
  const groups = rules?.groups || []
  for (const record of records) {
    if (groups.length && record.stage === 'group') {
      const group = groups.find(item => item.id === record.groupId)
      if (!group || !group.teamIds.includes(record.homeTeamId) || !group.teamIds.includes(record.awayTeamId)) fail('小组赛双方须属于规则中配置的同一分组。')
    }
    for (const side of ['home', 'away']) {
      const q = record[`${side}Qualification`]
      if (!q) continue
      const group = groups.find(item => item.id === q.groupId)
      if (record.stage === 'group' || record[`${side}TeamId`] || record[`${side}From`] || !group || q.rank > group.teamIds.length) fail('分组晋级来源无效，请先设置分组并清空该方的固定球队或比赛来源。')
      if (records.some(prior => prior.stage === 'group' && prior.groupId === q.groupId && Date.parse(prior.scheduledAt) >= Date.parse(record.scheduledAt))) fail('晋级比赛必须晚于该组全部小组赛。')
    }
    if (record.homeQualification && record.awayQualification && record.homeQualification.groupId === record.awayQualification.groupId && record.homeQualification.rank === record.awayQualification.rank) fail('主客队不能使用相同晋级名额。')
  }
}
function protectResults(before, after) {
  for (const record of before) {
    if (!['live', 'finished'].includes(record.status) || !record.result) continue
    const next = after.find(match => match._id === record._id)
    if (!next?.result) continue
    if (next.homeTeamId !== record.result.homeTeamId || next.awayTeamId !== record.result.awayTeamId) fail('更改会影响进行中或已有赛果的参赛球队，请先撤销后续比赛赛果，再按轮次更正。', 'CONFLICT')
  }
  for (const match of after) if (match.homeTeamId && match.homeTeamId === match.awayTeamId) fail('晋级后主客队相同，请调整后续对阵来源。', 'CONFLICT')
}
function validateResult(input, match, teams, previousResult) {
  fields(input, ['state', 'minute', 'homeScore', 'awayScore', 'penalties', 'goals', 'cards', 'substitutions', 'stats'])
  if (!match.homeTeamId || !match.awayTeamId || match.homeTeamId === match.awayTeamId) fail('请等待双方参赛球队确定后再录入赛果。')
  const state = input.state == null ? 'finished' : input.state
  if (!['live', 'finished'].includes(state)) fail('比赛状态无效。')
  const currentMinute = input.minute == null ? null : integer(input.minute, 0, 150, '比赛分钟')
  const homeScore = integer(input.homeScore, 0, 99, '主队比分'), awayScore = integer(input.awayScore, 0, 99, '客队比分')
  let penalties = null
  if (input.penalties != null) {
    if (state === 'live' || match.stage === 'group' || homeScore !== awayScore || !Array.isArray(input.penalties) || input.penalties.length !== 2) fail('仅完赛淘汰赛比分相同时可填写点球比分。')
    penalties = input.penalties.map(value => integer(value, 0, 99, '点球比分'))
    if (penalties[0] === penalties[1]) fail('点球比分须确定胜者。')
  }
  if (state === 'finished' && match.stage !== 'group' && homeScore === awayScore && !penalties) fail('淘汰赛平局须填写点球比分以确定胜者。')
  if (!Array.isArray(input.goals) || input.goals.length !== homeScore + awayScore) fail('每粒进球须有一条事件，进球数须与比分一致。')
  const priorPlayers = new Map()
  for (const goal of previousResult?.goals || []) for (const player of [goal.scorer, goal.assist]) if (player) priorPlayers.set(`${goal.teamId}:${player.id}`, player)
  for (const card of previousResult?.cards || []) if (card.player) priorPlayers.set(`${card.teamId}:${card.player.id}`, card.player)
  for (const substitution of previousResult?.substitutions || []) for (const player of [substitution.playerIn, substitution.playerOut]) if (player) priorPlayers.set(`${substitution.teamId}:${player.id}`, player)
  const player = (playerId, teamId, label = '事件球员') => {
    if (typeof playerId !== 'string' || !PLAYER_ID.test(playerId)) fail(`请选择有效的${label}。`)
    const p = teams.get(teamId)?.roster?.find(item => item.id === playerId) || priorPlayers.get(`${teamId}:${playerId}`)
    if (!p) fail(`赛事${label}须属于参赛球队名单；已保存的历史球员可保留。`)
    return { id: p.id, name: p.name, number: p.number }
  }
  const counts = { [match.homeTeamId]: 0, [match.awayTeamId]: 0 }
  const goals = input.goals.map(goal => {
    fields(goal, ['teamId', 'minute', 'scorerId', 'assistId', 'ownGoal'])
    if (![match.homeTeamId, match.awayTeamId].includes(goal.teamId) || typeof goal.ownGoal !== 'boolean') fail('进球事件的球队或类型无效。')
    const minute = integer(goal.minute, 0, 150, '进球分钟')
    counts[goal.teamId]++
    if (goal.ownGoal) {
      if (goal.scorerId != null || goal.assistId != null) fail('乌龙球记入受益球队比分，不计入个人进球或助攻。')
      return { teamId: goal.teamId, minute, ownGoal: true, scorer: null, assist: null }
    }
    if (goal.scorerId === goal.assistId) fail('进球者与助攻者不能相同。')
    return { teamId: goal.teamId, minute, ownGoal: false, scorer: player(goal.scorerId, goal.teamId), assist: goal.assistId == null ? null : player(goal.assistId, goal.teamId) }
  })
  if (counts[match.homeTeamId] !== homeScore || counts[match.awayTeamId] !== awayScore) fail('双方进球事件数量须分别与主客队比分一致。')
  const cardsInput = input.cards == null ? [] : input.cards
  if (!Array.isArray(cardsInput)) fail('红黄牌事件格式不正确。')
  const cards = cardsInput.map(card => {
    fields(card, ['teamId', 'minute', 'kind', 'playerId'])
    if (![match.homeTeamId, match.awayTeamId].includes(card.teamId) || !['yellow', 'red'].includes(card.kind)) fail('红黄牌事件的球队或类型无效。')
    return { teamId: card.teamId, minute: integer(card.minute, 0, 150, '牌面分钟'), kind: card.kind, player: player(card.playerId, card.teamId, '红黄牌球员') }
  })
  const substitutionsInput = input.substitutions == null ? [] : input.substitutions
  if (!Array.isArray(substitutionsInput)) fail('换人事件格式不正确。')
  const substitutions = substitutionsInput.map(change => {
    fields(change, ['teamId', 'minute', 'playerInId', 'playerOutId'])
    if (![match.homeTeamId, match.awayTeamId].includes(change.teamId) || change.playerInId === change.playerOutId) fail('换人事件的球队或球员无效。')
    return { teamId: change.teamId, minute: integer(change.minute, 0, 150, '换人分钟'), playerIn: player(change.playerInId, change.teamId, '换入球员'), playerOut: player(change.playerOutId, change.teamId, '换出球员') }
  })
  let stats = null
  if (input.stats != null) {
    fields(input.stats, ['possession', 'shots', 'shotsOnTarget', 'corners', 'fouls', 'offsides'])
    const pair = (value, label, max) => {
      if (!Array.isArray(value) || value.length !== 2) fail(`${label}须填写主客队两项数据。`)
      return value.map(item => integer(item, 0, max, label))
    }
    stats = { possession: pair(input.stats.possession, '控球率', 100), shots: pair(input.stats.shots, '射门', 99), shotsOnTarget: pair(input.stats.shotsOnTarget, '射正', 99), corners: pair(input.stats.corners, '角球', 99), fouls: pair(input.stats.fouls, '犯规', 99), offsides: pair(input.stats.offsides, '越位', 99) }
  }
  return { state, minute: currentMinute, homeScore, awayScore, penalties, goals, cards, substitutions, stats, homeTeamId: match.homeTeamId, awayTeamId: match.awayTeamId }
}
module.exports = { StandingsError, fail, fields, integer, cleanText, validateRules, qualification, calculateStandings, assertSchedule, protectResults, validateResult, defaults, stages }
