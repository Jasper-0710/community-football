import test from 'node:test'
import assert from 'node:assert/strict'
import { mockTournament } from '../src/data/mock'
import { tournamentRepository } from '../src/data/repository'
import { standings, resolvedMatches, filterMatches, winnerId, playerRanking, weekday, dateLabel, participantLabel, findTeam } from '../src/domain/tournament'
const clone = () => JSON.parse(JSON.stringify(mockTournament)) as typeof mockTournament

test('eight unique community teams, twelve group matches, and seven knockout slots', () => {
  assert.equal(mockTournament.teams.length, 8)
  assert.equal(new Set(mockTournament.teams.map(t => t.id)).size, 8)
  assert.equal(mockTournament.matches.filter(m => m.stage === 'group').length, 12)
  assert.equal(mockTournament.matches.filter(m => m.stage !== 'group').length, 7)
  assert.equal(new Set(mockTournament.matches.map(m => m.id)).size, mockTournament.matches.length)
})
test('finished group games calculate reproducible standings', () => {
  const a = standings(mockTournament, 'A'), b = standings(mockTournament, 'B')
  assert.deepEqual(a.map(r => [r.team.id, r.points]), [['jiangwan', 7], ['xuhui', 6], ['pudong', 4], ['putuo', 0]])
  assert.deepEqual(b.map(r => [r.team.id, r.points]), [['songjiang', 7], ['yangpu', 6], ['minhang', 2], ['jingan', 1]])
  for (const row of [...a, ...b]) { assert.equal(row.played, 3); assert.equal(row.won + row.drawn + row.lost, row.played); assert.equal(row.difference, row.goalsFor - row.goalsAgainst) }
})
test('knockout scores never leak into group standings', () => {
  const data = clone(); const q1 = data.matches.find(m => m.id === 'q1')!; q1.homeScore = 99
  assert.deepEqual(standings(data), standings(mockTournament))
})
test('in-progress group matches are excluded, including their provisional scores', () => {
  const data = clone(); data.matches.find(m => m.id === 'g1')!.status = 'live'
  assert.equal(standings(data).find(r => r.team.id === 'jiangwan')?.points, 4)
})
test('completed quarterfinal winner advances; unfinished opponent remains pending', () => {
  const semi = resolvedMatches(mockTournament).find(m => m.id === 's1')!
  assert.equal(semi.homeId, 'jiangwan'); assert.equal(semi.awayId, null)
  assert.equal(participantLabel(semi, 'away', mockTournament), 'Q2 胜者 · 待定')
})
test('finishing a game updates the bracket without altering the original fixture', () => {
  const data = clone(); data.matches.find(m => m.id === 'q2')!.status = 'finished'
  assert.equal(resolvedMatches(data).find(m => m.id === 's1')!.awayId, 'xuhui')
  assert.equal(data.matches.find(m => m.id === 's1')!.awayId, null)
  assert.equal(mockTournament.matches.find(m => m.id === 'q2')!.status, 'live')
})
test('advancement resolves recursively even if fixtures arrive out of order', () => {
  const data = clone(); const semi = data.matches.find(m => m.id === 's1')!
  data.matches.find(m => m.id === 'q2')!.status = 'finished'
  Object.assign(semi, { status: 'finished', homeScore: 0, awayScore: 1 }); data.matches.reverse()
  assert.equal(resolvedMatches(data).find(m => m.id === 'f1')!.homeId, 'xuhui')
})
test('a draw without a shootout does not invent a winner', () => {
  const match = { ...mockTournament.matches[0], homeScore: 1, awayScore: 1 }
  assert.equal(winnerId(match), null)
  assert.equal(winnerId({ ...match, penalties: [4, 3] }), match.homeId)
  assert.equal(winnerId({ ...match, penalties: [3, 4] }), match.awayId)
  assert.equal(winnerId({ ...match, penalties: [4, 4] }), null)
})
test('an ongoing match never produces a knockout winner', () => { assert.equal(winnerId(mockTournament.matches.find(m => m.id === 'q2')!), null) })
test('cyclic bracket references fail explicitly', () => {
  const data = clone(); data.matches.find(m => m.id === 'q1')!.homeFrom = 's1'
  assert.throws(() => resolvedMatches(data), /循环引用/)
})
test('null scores remain null, while completed zero scores remain zero', () => {
  const games = resolvedMatches(mockTournament)
  assert.equal(games.find(m => m.id === 'q3')!.homeScore, null)
  assert.equal(games.find(m => m.id === 'q2')!.awayScore, 0)
})
test('the demonstration day contains four games sorted by kick-off', () => {
  const games = filterMatches(resolvedMatches(mockTournament), { date: mockTournament.demoDate })
  assert.deepEqual(games.map(m => m.id), ['q1', 'q2', 'q3', 'q4'])
})
test('date, state, and team filters combine rather than overwrite', () => {
  const games = resolvedMatches(mockTournament)
  assert.deepEqual(filterMatches(games, { date: mockTournament.demoDate, status: 'live', teamId: 'xuhui' }).map(m => m.id), ['q2'])
  assert.equal(filterMatches(games, { date: mockTournament.demoDate, status: 'scheduled', teamId: 'xuhui' }).length, 0)
  assert.equal(filterMatches(games, { date: '2026-10-24' }).length, 0)
})
test('every recorded demo goal reconciles with its game score and scorer', () => {
  for (const match of mockTournament.matches) {
    const goals = match.events.filter(e => e.kind === 'goal')
    if (match.homeScore !== null) {
      assert.equal(goals.filter(e => e.teamId === match.homeId).length, match.homeScore, match.id)
      assert.equal(goals.filter(e => e.teamId === match.awayId).length, match.awayScore, match.id)
    }
    for (const goal of goals) {
      assert.equal(mockTournament.players.find(p => p.id === goal.playerId)?.teamId, goal.teamId)
      assert.equal(mockTournament.players.find(p => p.id === goal.assistPlayerId)?.teamId, goal.teamId)
      if (match.status === 'live') assert.ok(goal.minute <= match.minute!)
    }
  }
})
test('scorer and assist tables only count completed matches', () => {
  const goals = mockTournament.matches.filter(m => m.status === 'finished').reduce((n, m) => n + m.events.filter(e => e.kind === 'goal').length, 0)
  assert.equal(playerRanking(mockTournament, 'goals').reduce((n, r) => n + r.value, 0), goals)
  assert.equal(playerRanking(mockTournament, 'assists').reduce((n, r) => n + r.value, 0), goals)
})
test('dates are parsed explicitly and rendered consistently', () => {
  assert.equal(weekday('2026-10-25'), '周日'); assert.equal(weekday('2026-10-26'), '周一')
  assert.equal(dateLabel('2026-11-01'), '11 月 1 日'); assert.equal(dateLabel('2026-11-01', true), '2026 年 11 月 1 日')
})
test('unknown team identifiers are safe', () => { assert.equal(findTeam(mockTournament, 'missing'), undefined); assert.equal(findTeam(mockTournament, null), undefined) })
test('repository returns independent snapshots for later adapter substitution', async () => {
  const first = await tournamentRepository.load(), second = await tournamentRepository.load()
  first.teams[0].name = 'changed'; assert.notEqual(first.teams[0].name, second.teams[0].name)
  assert.equal(second.teams[0].name, '江湾联队')
})
