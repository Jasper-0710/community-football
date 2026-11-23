import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { parsePublicHome, parseTeamProfile, parseFullPlayerProfile } from '../src/domain/directory'
const require = createRequire(import.meta.url)
const { createDirectoryFixture, cid, tid, pid, mid } = require('./helpers/directory-fixture.cjs')
const { PUBLIC_ACTIONS } = require('../cloudfunctions/adminAuth/content')
const { createHttpHandler } = require('../cloudfunctions/adminAuth/http')
const { ACTIONS, query } = require('../cloudfunctions/adminAuth/public-cache')
const teamQuery = { action: 'directory.teamProfilePublic', id: tid(1) }, playerQuery = { action: 'directory.playerProfilePublic', id: pid(1), teamId: tid(1) }

test('home uses visible approved data, Beijing matchday, bounded previews and current names', async () => {
  const f = await createDirectoryFixture(), home = parsePublicHome((await f.content({ action: 'directory.homePublic' })).home)
  assert.deepEqual(home.counts, { competitions: 2, teams: 3, matches: 6, finished: 3 })
  assert.equal(home.today, '2026-11-23'); assert.equal(home.matchday.date, '2026-11-23'); assert.equal(home.matchday.live, 1)
  assert.equal(home.matchday.matches[0].match.id, mid(4))
  f.collections.teams.get(tid(1)).name = '【验收】修改后的主队'
  const changed = parsePublicHome((await f.content({ action: 'directory.homePublic' })).home)
  assert.equal(changed.teams[0].name, '【验收】修改后的主队'); assert.equal(changed.matchday.matches[0].match.homeTeamName, changed.teams[0].name)
  // Home advances to the next public date, then the most recent finished date.
  await f.result(4, null, true); f.clock.value = Date.parse('2026-11-24T16:01:00Z')
  assert.equal((await f.content({ action: 'directory.homePublic' })).home.matchday.date, '2026-11-30')
  f.clock.value = Date.parse('2027-01-01T00:00:00Z')
  assert.equal((await f.content({ action: 'directory.homePublic' })).home.matchday.date, '2026-11-30')
})
test('full team and player profiles aggregate all finished results, exclude live, own goals and shootouts correctly', async () => {
  const f = await createDirectoryFixture()
  const team = parseTeamProfile(await f.content(teamQuery), tid(1)), player = parseFullPlayerProfile(await f.content(playerQuery), pid(1), tid(1))
  assert.deepEqual(team.record.summary, { played: 3, won: 2, drawn: 1, lost: 0, goalsFor: 4, goalsAgainst: 2, difference: 2 })
  assert.equal(team.record.total, 6)
  assert.deepEqual(player.record.summary, { goals: 2, assists: 1, yellow: 1, red: 1, eventMatches: 3 })
  assert.equal(player.record.matches.length, 3)
  assert.ok((player.record.matches.find(r => r.match.id === mid(1)) as any).events.some(e => e.kind === 'subOut'))
  assert.equal('appearances' in player.record.summary, false); assert.equal('minutes' in player.record.summary, false)
  const filtered = parseFullPlayerProfile(await f.content({ ...playerQuery, competitionId: cid(2) }), pid(1), tid(1), cid(2))
  assert.deepEqual(filtered.record.summary, { goals: 0, assists: 1, yellow: 0, red: 0, eventMatches: 1 })
  const related = parseTeamProfile(await f.content({ ...teamQuery, competitionId: cid(2) }), tid(1), cid(2))
  assert.equal(related.record.summary.played, 1); assert.equal(related.record.summary.goalsFor, 1)
})
test('real result correction, revoke and republish recalculate profiles and qualification-dependent schedules', async () => {
  const f = await createDirectoryFixture()
  await f.result(1, { homeScore: 0, awayScore: 1, goals: [f.goal(2, 2)] })
  let team = parseTeamProfile(await f.content(teamQuery), tid(1)), p = parseFullPlayerProfile(await f.content(playerQuery), pid(1), tid(1))
  assert.equal(team.record.summary.goalsFor, 2); assert.equal(team.record.summary.lost, 1)
  assert.deepEqual(p.record.summary, { goals: 1, assists: 1, yellow: 0, red: 0, eventMatches: 2 })
  await f.result(5, null, true)
  team = parseTeamProfile(await f.content(teamQuery), tid(1)); p = parseFullPlayerProfile(await f.content(playerQuery), pid(1), tid(1))
  assert.equal(team.record.summary.played, 2); assert.equal(team.record.total, 5)
  assert.equal(team.record.matches.some(r => r.match.id === mid(7)), false)
  assert.equal(p.record.summary.goals, 0)
  await f.result(5, { homeScore: 0, awayScore: 1, goals: [f.goal(2, 2)] })
  const away = parseTeamProfile(await f.content({ ...teamQuery, id: tid(2) }), tid(2))
  assert.equal(away.record.matches.find(r => r.match.id === mid(7))?.match.homeTeamId, tid(2))
})
test('hidden competitions, cross-competition pending enrollments, dissolved teams and private fields are excluded', async () => {
  const f = await createDirectoryFixture()
  f.collections.matches.set(mid(8), { ...f.collections.matches.get(mid(3)), _id: mid(8), competitionId: cid(2), awayTeamId: tid(3) })
  for (const q of [{ action: 'directory.homePublic' }, teamQuery, playerQuery]) {
    const raw = JSON.stringify(await f.content(q))
    for (const secret of ['private-phone', 'private-owner', 'private-player-note', 'private-attachment', cid(3), tid(4), mid(8)]) assert.equal(raw.includes(secret), false, secret)
  }
  for (const q of [teamQuery, playerQuery]) assert.equal((await f.content({ ...q, competitionId: cid(3) })).error.code, 'NOT_FOUND')
  assert.equal((await f.content({ ...playerQuery, teamId: tid(2) })).error.code, 'NOT_FOUND')
  // Same player ID in another team's events must not count for this team.
  f.collections.matches.get(mid(2)).result.cards.push({ teamId: tid(2), minute: 5, kind: 'red', player: { id: pid(1), name: '同名历史记录', number: 7 } })
  assert.equal((await f.content(playerQuery)).record.summary.red, 1)
  f.collections.competitions.get(cid(1)).displayEnabled = false
  assert.equal((await f.content(teamQuery)).record.summary.played, 1)
  f.collections.competitions.get(cid(2)).displayEnabled = false
  assert.equal((await f.content(teamQuery)).error.code, 'NOT_FOUND'); assert.equal((await f.content(playerQuery)).error.code, 'NOT_FOUND')
  f.collections.competitions.get(cid(2)).displayEnabled = true; f.collections.teams.get(tid(1)).status = 'dissolved'
  assert.equal((await f.content(teamQuery)).error.code, 'NOT_FOUND')
})
test('current roster identity retains historical event facts; removed players are no longer public profiles', async () => {
  const f = await createDirectoryFixture(), p = f.collections.teams.get(tid(1)).roster[0]
  p.name = '【验收】球员新名称'; p.number = 19
  const result = parseFullPlayerProfile(await f.content(playerQuery), pid(1), tid(1))
  assert.equal(result.player.name, p.name); assert.equal(result.player.number, 19); assert.equal(result.record.summary.goals, 2)
  f.collections.teams.get(tid(1)).roster.shift()
  assert.equal((await f.content(playerQuery)).error.code, 'NOT_FOUND')
})
test('a no-longer-approved source match cannot leave a stale team in a subsequent profile schedule', async () => {
  const f = await createDirectoryFixture()
  f.enroll(1, 2, 'pending')
  const team = parseTeamProfile(await f.content(teamQuery), tid(1))
  assert.equal(team.record.summary.played, 1)
  assert.equal(team.record.matches.some(r => r.match.id === mid(7)), false)
  // An unrelated eligible opponent can still see the pending final slot.
  const opponent = parseTeamProfile(await f.content({ ...teamQuery, id: tid(3) }), tid(3))
  assert.equal(opponent.record.matches[0].match.homeTeamId, null)
})
test('home caps six previews without truncating totals and handles an empty public directory', async () => {
  const f = await createDirectoryFixture()
  for (let n = 5; n <= 9; n++) {
    f.collections.teams.set(tid(n), { ...f.collections.teams.get(tid(3)), _id: tid(n), name: `【验收】队伍${n}` }); f.enroll(1, n)
  }
  for (let n = 8; n <= 16; n++) await f.create(n, { scheduledAt: '2026-11-23T10:00:00.000Z' })
  const home = parsePublicHome((await f.content({ action: 'directory.homePublic' })).home)
  assert.equal(home.counts.teams, 8); assert.equal(home.teams.length, 6)
  assert.equal(home.matchday.total, 10); assert.equal(home.matchday.matches.length, 6)
  assert.throws(() => parsePublicHome({ ...home, matchday: { ...home.matchday, date: '2026-11-24' } }))
  for (const c of f.collections.competitions.values()) c.displayEnabled = false
  const empty = parsePublicHome((await f.content({ action: 'directory.homePublic' })).home)
  assert.deepEqual(empty.counts, { competitions: 0, teams: 0, matches: 0, finished: 0 }); assert.equal(empty.matchday.date, null)
})
test('profile pagination is bounded, scope-bound and rejects old cursors after result corrections', async () => {
  const f = await createDirectoryFixture()
  for (let n = 8; n <= 35; n++) {
    await f.create(n, { scheduledAt: `2026-12-${String(n - 7).padStart(2, '0')}T08:00:00.000Z` })
    await f.result(n, { homeScore: 1, awayScore: 0, goals: [f.goal(1, 1)] })
  }
  for (const q of [teamQuery, playerQuery]) {
    let cursor: string | undefined, rows: string[] = []
    do { const r = await f.content({ ...q, ...(cursor ? { cursor } : {}) }); assert.equal(r.ok, true); assert.ok(r.record.matches.length <= 20); rows.push(...r.record.matches.map(row => row.match.id)); cursor = r.record.nextCursor || undefined } while (cursor)
    assert.equal(new Set(rows).size, rows.length); assert.ok(rows.length > 20)
    const first = await f.content(q)
    assert.equal((await f.content({ ...q, competitionId: cid(2), cursor: first.record.nextCursor })).error.code, 'CONFLICT')
    await f.result(35, { homeScore: 2, awayScore: 0, goals: [f.goal(1, 1), f.goal(1, 1, 20)] })
    assert.equal((await f.content({ ...q, cursor: first.record.nextCursor })).error.code, 'CONFLICT')
  }
  const home = parsePublicHome((await f.content({ action: 'directory.homePublic' })).home)
  assert.ok(home.matchday.matches.length <= 6)
})
test('empty, failure and request/response validation never fabricate mock profile data', async () => {
  const f = await createDirectoryFixture()
  f.collections.matches.clear()
  const team = parseTeamProfile(await f.content(teamQuery), tid(1)), p = parseFullPlayerProfile(await f.content(playerQuery), pid(1), tid(1))
  assert.equal(team.record.summary.played, 0); assert.equal(p.record.total, 0)
  assert.equal(parsePublicHome((await f.content({ action: 'directory.homePublic' })).home).matchday.date, null)
  assert.throws(() => parseTeamProfile({ ok: true, team: team.team }, tid(1)))
  assert.throws(() => parseTeamProfile({ ok: true, ...team }, tid(2)))
  assert.throws(() => parseTeamProfile({ ok: true, ...team }, tid(1), cid(2)))
  const injected = { ok: true, ...team, secret: 'discard', team: { ...team.team, contactPhone: 'discard' }, record: { ...team.record, summary: { ...team.record.summary, secret: 'discard' } } }
  assert.equal(JSON.stringify(parseTeamProfile(injected, tid(1))).includes('discard'), false)
  assert.throws(() => parseFullPlayerProfile({ ok: true, ...p }, pid(2), tid(1)))
  f.failures.scan = true
  assert.equal((await f.content(teamQuery)).error.code, 'SERVICE_UNAVAILABLE')
})
test('public HTTP and recovery allowlists include new read-only projections and bind cache keys to filters', async () => {
  const f = await createDirectoryFixture(), http = createHttpHandler(f.content, ['https://example.test'], PUBLIC_ACTIONS)
  for (const q of [{ action: 'directory.homePublic' }, teamQuery, playerQuery]) {
    assert.equal(ACTIONS.includes(q.action), true); assert.deepEqual(query(q), Object.fromEntries(Object.entries(q).sort(([a], [b]) => a.localeCompare(b))))
    const r = await http({ httpMethod: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(q) })
    assert.equal(r.statusCode, 200); assert.equal(JSON.parse(r.body).ok, true)
    assert.equal((await f.content({ ...q, contactPhone: 'forged' })).error.code, 'INVALID_ARGUMENT')
  }
  assert.notDeepEqual(query(teamQuery), query({ ...teamQuery, competitionId: cid(2) }))
})
