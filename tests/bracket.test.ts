import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { buildBracket, bracketGeometry as g, knockoutWinner } from '../src/domain/bracket'
import { parseStandings } from '../src/domain/standings'
const { createBracketFixture, mid, tid } = createRequire(import.meta.url)('./helpers/bracket-fixture.cjs')

test('real eight-team graph follows source IDs and sides, independent of array, slot and date order', async () => {
  const f = await createBracketFixture(), snapshot = parseStandings(await f.snapshot())
  const before = structuredClone(snapshot), graph = buildBracket(snapshot)
  assert.deepEqual(graph.columns.map(c => [c.stage, c.count]), [['quarter', 4], ['semi', 2], ['final', 1]])
  assert.deepEqual(graph.nodes.map(n => n.match.id), [14, 12, 13, 11, 22, 21, 23].map(mid))
  assert.deepEqual(graph.edges.filter(e => e.side !== 'champion').map(e => [e.from, e.to, e.side]), [[14, 22, 'home'], [12, 22, 'away'], [13, 21, 'home'], [11, 21, 'away'], [22, 23, 'home'], [21, 23, 'away']].map(([a, b, side]) => [mid(a), mid(b), side]))
  assert.deepEqual(buildBracket({ ...snapshot, matches: [...snapshot.matches].reverse() }), graph)
  assert.deepEqual(snapshot, before)
  assert.equal(graph.champion?.name, null)
  for (const column of graph.columns) {
    const nodes = graph.nodes.filter(n => n.match.stage === column.stage)
    nodes.forEach((node, i) => { if (i) assert.ok(node.y >= nodes[i - 1].y + g.cardHeight + g.rowGap); assert.ok(node.x + g.cardWidth <= graph.width); assert.ok(node.y + g.heading + g.cardHeight <= graph.height) })
  }
  for (const edge of graph.edges) {
    const from = graph.nodes.find(n => n.match.id === edge.from)!, to = graph.nodes.find(n => n.match.id === edge.to)
    assert.equal(edge.segments[0].x, from.x + g.cardWidth)
    if (to) { assert.equal(edge.segments[2].x + edge.segments[2].width, to.x); assert.equal(edge.segments[2].y, to.y + g.heading + (edge.side === 'home' ? g.homeAnchor : g.awayAnchor)) }
    assert.ok(edge.segments.every(s => s.width > 0 && s.height > 0 && s.x >= 0 && s.y >= 0))
  }
})

test('group qualifiers remain pending for incomplete or tied groups, then re-resolve after correction', async () => {
  const f = await createBracketFixture()
  let graph = buildBracket(parseStandings(await f.snapshot()))
  assert.deepEqual(graph.nodes.find(n => n.match.id === mid(11))!.participants.map(p => [p.name, p.source, p.score, p.winner]), [['待定', 'A组 第1名', null, false], ['待定', 'B组 第2名', null, false]])
  await f.result(1, 0, 0); await f.result(2, 1, 0)
  graph = buildBracket(parseStandings(await f.snapshot()))
  assert.equal(graph.nodes.find(n => n.match.id === mid(11))!.participants[0].pending, true)
  await f.result(1, 1, 0)
  graph = buildBracket(parseStandings(await f.snapshot()))
  assert.equal(graph.nodes.find(n => n.match.id === mid(11))!.match.homeTeamId, tid(1))
  await f.result(1, 0, 1)
  graph = buildBracket(parseStandings(await f.snapshot()))
  assert.equal(graph.nodes.find(n => n.match.id === mid(11))!.match.homeTeamId, tid(2))
  await f.revoke(1)
  graph = buildBracket(parseStandings(await f.snapshot()))
  assert.equal(graph.nodes.find(n => n.match.id === mid(11))!.participants[0].pending, true)
})

test('live scores never qualify; penalties, downstream revocation, correction and republication update all graph states', async () => {
  const f = await createBracketFixture()
  for (const n of [1, 2, 3, 4]) await f.result(n, 1, 0)
  await f.result(11, 2, 0, { state: 'live', minute: 40 })
  let graph = buildBracket(parseStandings(await f.snapshot()))
  assert.equal(graph.nodes.find(n => n.match.id === mid(11))!.winnerId, null)
  assert.equal(graph.edges.find(e => e.from === mid(11))!.confirmed, false)
  await f.result(11, 1, 1, { penalties: [3, 4] })
  for (const n of [12, 13, 14, 21, 22]) await f.result(n, 1, 0)
  await f.result(23, 0, 0, { penalties: [4, 5] })
  graph = buildBracket(parseStandings(await f.snapshot()))
  const final = graph.nodes.find(n => n.match.id === mid(23))!
  assert.equal(final.winnerId, final.match.awayTeamId)
  assert.equal(graph.champion?.name, final.match.awayTeamName)
  assert.equal(graph.edges.every(e => e.confirmed), true)
  await f.revoke(23); await f.revoke(21); await f.result(11, 2, 0)
  graph = buildBracket(parseStandings(await f.snapshot()))
  assert.equal(graph.champion?.name, null)
  assert.equal(graph.nodes.find(n => n.match.id === mid(21))!.match.awayTeamId, tid(1))
  assert.equal(graph.nodes.find(n => n.match.id === mid(23))!.participants[1].pending, true)
  await f.result(21, 0, 1); await f.result(23, 0, 1)
  graph = buildBracket(parseStandings(await f.snapshot()))
  assert.equal(graph.champion?.name, '【模拟】社区球队1')
})

test('partial schedules, missing sources and empty competitions never fabricate matches or connections', async () => {
  const f = await createBracketFixture(), snapshot = parseStandings(await f.snapshot(2))
  const partial = buildBracket(snapshot)
  assert.deepEqual(partial.columns.map(c => c.stage), ['semi', 'final'])
  assert.equal(partial.nodes.length, 3); assert.equal(partial.edges.length, 3)
  const missing = buildBracket({ ...snapshot, matches: snapshot.matches.filter(m => m.id !== mid(31)) })
  assert.equal(missing.edges.some(e => e.from === mid(31)), false)
  assert.equal(missing.nodes.find(n => n.match.id === mid(33))!.participants[0].source, '前序比赛胜者（来源未公开）')
  const only = buildBracket({ ...snapshot, matches: snapshot.matches.filter(m => m.stage === 'final') })
  assert.equal(only.nodes.length, 1); assert.equal(only.edges.length, 1)
  const empty = buildBracket(parseStandings(await f.snapshot(3)))
  assert.equal(empty.width, 0); assert.equal(empty.height, 0); assert.equal(empty.champion, null)
  const multiple = buildBracket({ ...snapshot, matches: [...snapshot.matches, { ...snapshot.matches.find(m => m.stage === 'final')!, id: mid(99) }] })
  assert.equal(multiple.champion, null)
})

test('winner and champion rendering requires complete participants and an authoritative, matching champion', async () => {
  const f = await createBracketFixture(), snapshot = parseStandings(await f.snapshot(2))
  await f.result(31, 1, 0); await f.result(32, 0, 1); await f.result(33, 1, 0)
  const finished = parseStandings(await f.snapshot(2)), final = finished.matches.find(m => m.id === mid(33))!
  assert.equal(knockoutWinner(final), tid(1))
  assert.equal(knockoutWinner({ ...final, status: 'live' }), null)
  assert.equal(knockoutWinner({ ...final, homeTeamId: null }), null)
  assert.equal(knockoutWinner({ ...final, homeScore: null }), null)
  assert.equal(knockoutWinner({ ...final, homeScore: 0, awayScore: 0, penalties: null }), null)
  assert.equal(buildBracket({ ...finished, championTeamId: tid(8) }).champion?.name, null)
  assert.equal(buildBracket(snapshot).champion?.name, null)
})


test('matches without slot numbers retain their real round instead of fabricating a numbered bracket slot', async () => {
  const f = await createBracketFixture(), snapshot = parseStandings(await f.snapshot(2))
  const graph = buildBracket({ ...snapshot, matches: snapshot.matches.map(m => m.id === mid(31) ? { ...m, slot: null, round: 3 } : m) })
  assert.equal(graph.nodes.find(n => n.match.id === mid(33))!.participants[0].source, '半决赛 第3轮胜者')
  assert.equal(graph.nodes.find(n => n.match.id === mid(31))!.match.slot, null)
})
