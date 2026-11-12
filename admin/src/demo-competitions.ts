import type { AdminApi } from './api'
import type { CompetitionForm, AdminCompetition } from '../../src/domain/competition'
import demo from '../../config/demo-competitions.json'

export async function createDemoCompetitions(api: AdminApi, token: string): Promise<AdminCompetition[]> {
  const results: AdminCompetition[] = []
  for (const item of demo.competitions) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${demo.dataset}:competition:${item.key}`))
    const requestId = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32)
    // A stable request ID makes retries safe after a timeout or a partially completed batch.
    const created = await api.createCompetition(token, requestId, item.form as CompetitionForm)
    const published = created.displayEnabled ? created : await api.competitionSwitch(token, created.id, created.version, 'visibility', true)
    results.push(published)
  }
  return results
}
