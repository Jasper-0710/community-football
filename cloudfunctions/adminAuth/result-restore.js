'use strict'

const { createHash } = require('node:crypto')
const { fail, fields, integer, validateResult } = require('./standings-engine')
const REVISION_ID = /^rv_[a-f0-9]{64}$/
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

// Read only server-owned audit data. Never accept a replacement event list from
// the browser, or resolve a historical player through today's roster.
function historicalResult(row, match) {
  const saved = row.result
  if (!saved || row.revoked !== false) fail('该历史版本没有可恢复的赛果。')
  if (saved.homeTeamId !== match.homeTeamId || saved.awayTeamId !== match.awayTeamId || row.homeTeamId !== saved.homeTeamId || row.awayTeamId !== saved.awayTeamId) fail('历史参赛球队与当前对阵不一致，不能恢复。', 'CONFLICT')
  fields(saved, ['state', 'minute', 'homeScore', 'awayScore', 'penalties', 'goals', 'cards', 'substitutions', 'stats', 'homeTeamId', 'awayTeamId'])
  const player = p => {
    fields(p, ['id', 'name', 'number'])
    if (typeof p.id !== 'string' || !/^p_[a-f0-9]{32}$/.test(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80) fail('历史球员记录不完整，不能恢复。')
    integer(p.number, 1, 99, '历史球衣号码')
    return { id: p.id, name: p.name, number: p.number }
  }
  const events = (value, convert) => {
    if (!Array.isArray(value)) fail('历史赛果事件格式无效。')
    return value.map(convert)
  }
  const goals = events(saved.goals, goal => {
    fields(goal, ['teamId', 'minute', 'ownGoal', 'scorer', 'assist'])
    return { teamId: goal.teamId, minute: goal.minute, ownGoal: goal.ownGoal, scorer: goal.scorer == null ? null : player(goal.scorer), assist: goal.assist == null ? null : player(goal.assist) }
  })
  const cards = events(saved.cards ?? [], card => {
    fields(card, ['teamId', 'minute', 'kind', 'player'])
    return { teamId: card.teamId, minute: card.minute, kind: card.kind, player: player(card.player) }
  })
  const substitutions = events(saved.substitutions ?? [], change => {
    fields(change, ['teamId', 'minute', 'playerIn', 'playerOut'])
    return { teamId: change.teamId, minute: change.minute, playerIn: player(change.playerIn), playerOut: player(change.playerOut) }
  })
  const result = validateResult({ state: saved.state ?? 'finished', minute: saved.minute ?? null, homeScore: saved.homeScore, awayScore: saved.awayScore, penalties: saved.penalties ?? null,
    goals: goals.map(g => ({ teamId: g.teamId, minute: g.minute, ownGoal: g.ownGoal, scorerId: g.scorer?.id ?? null, assistId: g.assist?.id ?? null })),
    cards: cards.map(c => ({ teamId: c.teamId, minute: c.minute, kind: c.kind, playerId: c.player.id })),
    substitutions: substitutions.map(c => ({ teamId: c.teamId, minute: c.minute, playerInId: c.playerIn.id, playerOutId: c.playerOut.id })), stats: saved.stats ?? null,
  }, match, new Map(), { goals, cards, substitutions })
  return { ...result, goals, cards, substitutions }
}

module.exports = { REVISION_ID, digest, historicalResult }
