import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const { createCompetitionService } = require('../cloudfunctions/adminAuth/competitions.js')
const { createMatchService } = require('../cloudfunctions/adminAuth/matches.js')
const source = JSON.parse(await readFile(new URL('../config/demo-competitions.json', import.meta.url), 'utf8'))
const key = (kind, value) => createHash('sha256').update(`${source.dataset}:${kind}:${value}`).digest('hex')
const competitionId = value => `c_${key('competition', value).slice(0, 32)}`
const matchId = value => `m_${key('match', value).slice(0, 32)}`
const competitions = new Map(), matches = new Map(), teams = new Map()
const now = () => Date.parse(source.createdAt)
const authorize = async () => ({ ok: true }) // This generator operates only on the local maps below.
const competitionService = createCompetitionService({ now, authorize, store: {
  async transaction(id, callback) { return callback(competitions.get(id), async record => competitions.set(id, record)) },
} })
for (const item of source.competitions) {
  const result = await competitionService({ action: 'competitions.create', requestId: key('competition', item.key).slice(0, 32), form: item.form })
  assert.equal(result.ok, true, JSON.stringify(result.error))
  const published = await competitionService({ action: 'competitions.visibility', id: result.competition.id, expectedVersion: result.competition.version, enabled: true })
  assert.equal(published.ok, true, JSON.stringify(published.error))
}
const teamSeeds = [
  ['jiangwan', '江湾联队', '虹口区'], ['xuhui', '徐汇星火', '徐汇区'],
  ['pudong', '浦东锋芒', '浦东新区'], ['putuo', '普陀追风', '普陀区'],
  ['songjiang', '松江山鹰', '松江区'], ['yangpu', '杨浦青年', '杨浦区'],
  ['minhang', '闵行飞翼', '闵行区'], ['jingan', '静安远航', '静安区'],
]
const teamId = value => `t_${key('team', value)}`
for (const [slug, name, district] of teamSeeds) {
  const id = teamId(slug)
  teams.set(id, { _id: id, name: `模拟·${name}`, district, description: '虚构演示球队，仅用于模拟赛事与赛程。',
    contactPhone: '模拟资料，无真实联系电话', leaderUserId: key('unbound-demo-leader', slug),
    status: 'active', version: 1, roster: [], createdAt: source.createdAt, updatedAt: source.createdAt, demoDataset: source.dataset })
}
const matchService = createMatchService({ now, authorize, store: {
  async competition(id) { return competitions.get(id) }, async team(id) { return teams.get(id) },
  // Eligibility here is a local fixture, not a cloud registration or approval.
  async registration(competitionId, teamId) { return { competitionId, teamId, status: 'approved' } },
  async read(id) { return matches.get(id) },
  async dependents(id, competitionId) { return [...matches.values()].filter(match => match.competitionId === competitionId && (match.homeFrom === id || match.awayFrom === id)) },
  async transaction(id, callback) { return callback(matches.get(id), async (record, related) => {
    matches.set(id, record)
    for (const team of related.teams) teams.set(team._id, { ...team, version: team.version + 1 })
    competitions.set(related.competition._id, { ...related.competition, scheduleMutationVersion: (related.competition.scheduleMutationVersion || 0) + 1 })
  }) },
} })
async function schedule(event, label, date, time, home, away, options = {}) {
  const form = { competitionId: competitionId(event), stage: 'group', round: 1, groupId: null, slot: null,
    homeTeamId: home ? teamId(home) : null, awayTeamId: away ? teamId(away) : null,
    homeFrom: null, awayFrom: null, scheduledAt: new Date(`${date}T${time}:00+08:00`).toISOString(),
    venue: '上海社区示范球场A场（模拟场地）', status: 'scheduled', ...options }
  const result = await matchService({ action: 'matches.create', requestId: key('match', `${event}-${label}`).slice(0, 32), form })
  assert.equal(result.ok, true, JSON.stringify(result.error))
  const eventInfo = source.competitions.find(item => item.key === event).form
  assert.ok(date >= eventInfo.startDate && date <= eventInfo.endDate)
  return result.match.id
}
const rounds = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]]
for (const [round, pairs] of rounds.entries()) {
  for (const [group, offset] of [['A组', 0], ['B组', 4]]) {
    for (const [slot, [home, away]] of pairs.entries()) {
      await schedule('autumn', `g-${group}-${round}-${slot}`, ['2026-11-21', '2026-11-22', '2026-11-28'][round],
        slot ? '15:30' : '13:30', teamSeeds[offset + home][0], teamSeeds[offset + away][0],
        { round: round + 1, groupId: group, slot: slot + 1, venue: `上海社区示范球场${offset ? 'B' : 'A'}场（模拟场地）`,
          status: round === 1 && group === 'B组' && slot === 1 ? 'postponed' : 'scheduled' })
    }
  }
}
for (const [index, pair] of [['jiangwan', 'jingan'], ['xuhui', 'minhang'], ['pudong', 'yangpu'], ['putuo', 'songjiang']].entries()) {
  await schedule('autumn', `q${index + 1}`, '2026-11-29', index % 2 ? '15:30' : '13:30', ...pair,
    { stage: 'quarter', slot: index + 1, venue: `上海社区示范球场${index < 2 ? 'A' : 'B'}场（模拟场地）` })
}
for (let index = 0; index < 2; index++) {
  await schedule('autumn', `s${index + 1}`, '2026-12-05', index ? '15:30' : '13:30', null, null,
    { stage: 'semi', slot: index + 1, homeFrom: matchId(`autumn-q${index * 2 + 1}`), awayFrom: matchId(`autumn-q${index * 2 + 2}`) })
}
await schedule('autumn', 'final', '2026-12-06', '15:00', null, null,
  { stage: 'final', slot: 1, homeFrom: matchId('autumn-s1'), awayFrom: matchId('autumn-s2') })
for (const [round, pairs] of rounds.entries()) for (const [slot, [home, away]] of pairs.entries()) {
  await schedule('weekend', `r${round + 1}-${slot}`, ['2026-12-12', '2026-12-13', '2026-12-19'][round], slot ? '15:00' : '14:00',
    teamSeeds[home][0], teamSeeds[away][0], { round: round + 1, slot: slot + 1, venue: '上海邻里运动中心五人制1号场（模拟场地）' })
}
for (const [index, pair] of [['songjiang', 'yangpu'], ['minhang', 'jingan']].entries()) {
  await schedule('winter', `s${index + 1}`, '2026-12-26', index ? '15:30' : '13:30', ...pair,
    { stage: 'semi', slot: index + 1, venue: '上海社区示范球场C场（模拟场地）' })
}
await schedule('winter', 'final', '2026-12-27', '15:00', null, null,
  { stage: 'final', slot: 1, homeFrom: matchId('winter-s1'), awayFrom: matchId('winter-s2'), venue: '上海社区示范球场C场（模拟场地）' })

const occupied = new Set()
for (const match of matches.values()) {
  for (const reference of [match.homeFrom, match.awayFrom].filter(Boolean)) {
    assert.equal(matches.get(reference)?.competitionId, match.competitionId)
    assert.ok(matches.get(reference).scheduledAt < match.scheduledAt)
  }
  for (const id of [match.homeTeamId, match.awayTeamId].filter(Boolean)) {
    const slot = `${id}:${match.scheduledAt}`
    assert.ok(!occupied.has(slot), 'A demo team cannot play two games at the same time')
    occupied.add(slot)
  }
}
assert.equal(competitions.size, 3); assert.equal(teams.size, 8); assert.equal(matches.size, 28)
const out = new URL('../artifacts/demo-events/', import.meta.url)
await mkdir(out, { recursive: true })
const data = Object.fromEntries([['competitions', competitions], ['teams', teams], ['matches', matches]].map(([name, rows]) =>
  [name, [...rows.values()].map(record => ({ ...record, demoDataset: source.dataset }))]))
for (const [name, rows] of Object.entries(data)) await writeFile(new URL(`${name}.jsonl`, out), rows.map(row => JSON.stringify(row)).join('\n') + '\n')
await writeFile(new URL('dataset.json', out), JSON.stringify({ dataset: source.dataset, ...data }, null, 2) + '\n')
console.log(`已生成 ${competitions.size} 个赛事、${teams.size} 支虚构球队、${matches.size} 场比赛：artifacts/demo-events/。仅生成本地文件，未写入云端。`)
