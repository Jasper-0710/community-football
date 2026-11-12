import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createDemoCompetitions } from '../admin/src/demo-competitions'
import { AdminApiError, type AdminApi } from '../admin/src/api'
import { parseCompetition } from '../src/domain/competition'

const require = createRequire(import.meta.url)
const { createCompetitionService } = require('../cloudfunctions/adminAuth/competitions.js')
const { createCompetitionMemoryStore } = require('./helpers/competition-store.cjs')
const token = 'demo-test-session'
function setup() {
  const memory = createCompetitionMemoryStore()
  const service = createCompetitionService({ store: memory.store, authorize: async (value: string) => ({ ok: value === token }), now: () => Date.parse('2026-11-11T00:00:00.000Z') })
  async function call(action: string, fields: Record<string, unknown>) {
    const result = await service({ action, token, ...fields })
    if (!result.ok) throw new AdminApiError(result.error.code, result.error.message)
    return parseCompetition(result.competition, true)
  }
  const api = {
    createCompetition: async (_: string, requestId: string, form: unknown) => call('competitions.create', { requestId, form }),
    competitionSwitch: async (_: string, id: string, expectedVersion: number, kind: string, enabled: boolean) => call(`competitions.${kind}`, { id, expectedVersion, enabled }),
  } as AdminApi
  return { ...memory, api }
}

test('demo batch publishes three marked competitions without opening registration or duplicating records on retry', async () => {
  const s = setup()
  const first = await createDemoCompetitions(s.api, token)
  const second = await createDemoCompetitions(s.api, token)
  assert.equal(s.records.size, 3)
  assert.deepEqual(second, first)
  assert.deepEqual(new Set(first.map(record => record.format)), new Set(['group_knockout', 'round_robin', 'knockout']))
  for (const record of first) {
    assert.ok(record.name.startsWith('【模拟】'))
    assert.equal(record.displayEnabled, true)
    assert.equal(record.registrationEnabled, false)
    assert.equal(record.registrationStats.occupied, 0)
  }
})

test('retry after a partially published demo batch reuses the saved competition', async () => {
  const s = setup()
  const failingApi = { ...s.api, competitionSwitch: async () => { throw new Error('network interrupted') } }
  await assert.rejects(createDemoCompetitions(failingApi, token), /network interrupted/)
  assert.equal(s.records.size, 1)
  const savedId = [...s.records.keys()][0]
  const result = await createDemoCompetitions(s.api, token)
  assert.equal(s.records.size, 3)
  assert.ok(result.some(record => record.id === savedId && record.displayEnabled))
})

test('demo generation preserves unrelated events and administrator changes to an existing demo', async () => {
  const s = setup()
  const result = await createDemoCompetitions(s.api, token)
  const existing = s.records.get(result[0].id)
  s.records.set(result[0].id, { ...existing, name: '管理员编辑的模拟赛事', registrationEnabled: true, version: existing.version + 1 })
  const unrelatedId = `c_${'0'.repeat(32)}`
  s.records.set(unrelatedId, { ...existing, _id: unrelatedId, name: '已有正式赛事', displayEnabled: false })
  const before = structuredClone([...s.records])
  await createDemoCompetitions(s.api, token)
  assert.deepEqual([...s.records], before)
})
