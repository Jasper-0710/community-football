import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createContentStore } = require('../cloudfunctions/adminAuth/content-store.js')
function databaseFixture(count: number) {
  const source = Array.from({ length: count }, (_, i) => ({ _id: `row-${i.toString().padStart(5, '0')}`, matchId: 'match-a' }))
  const cursors: (string | undefined)[] = []
  const db = {
    command: { gt: (value: string) => ({ gt: value }) },
    collection: () => ({
      where(filter: any) {
        cursors.push(filter._id?.gt)
        return {
          orderBy(field: string, direction: string) {
            assert.equal(field, '_id'); assert.equal(direction, 'asc')
            return {
              limit(limit: number) {
                assert.equal(limit, 100)
                return { async get() { return { data: source.filter(r => (!filter._id || r._id > filter._id.gt) && (!filter.matchId || r.matchId === filter.matchId)).slice(0, limit) } } }
              },
            }
          },
        }
      },
    }),
  }
  return { db, cursors }
}
test('cloud content adapter reads past both default 20 and single-query 100 row limits', async () => {
  const f = databaseFixture(205), store = createContentStore(f.db), rows = await store.scan('newsArticles')
  assert.equal(rows.length, 205)
  assert.deepEqual(f.cursors, [undefined, 'row-00099', 'row-00199'])
  assert.equal(new Set(rows.map((r: any) => r._id)).size, 205)
})
test('cloud content adapter refuses incomplete rankings instead of silently truncating beyond its supported bound', async () => {
  const f = databaseFixture(2001)
  await assert.rejects(createContentStore(f.db).scan('teams'), /scan limit/)
})
test('evaluation adapter pages only the selected match and refuses partial or unsupported results', async () => {
  const f = databaseFixture(205), store = createContentStore(f.db)
  assert.equal((await store.evaluationRows('playerRatings', 'match-a')).length, 205)
  assert.equal((await store.evaluationRows('playerComments', 'another-match')).length, 0)
  await assert.rejects(store.evaluationRows('teams', 'match-a'), /Invalid evaluation collection/)
  await assert.rejects(createContentStore(databaseFixture(2001).db).evaluationRows('playerRatings', 'match-a'), /Evaluation limit/)
})
