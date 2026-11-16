'use strict'

const KINDS = ['team', 'player', 'match', 'news']
const normalize = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
function rankSearch(items, query, kind = 'all') {
  const q = normalize(query)
  return items.flatMap(item => {
    if (kind !== 'all' && item.kind !== kind) return []
    const title = normalize(item.title), secondary = normalize(item.searchText || item.detail)
    const rank = title === q ? 0 : title.startsWith(q) ? 1 : title.includes(q) ? 2 : secondary.includes(q) ? 3 : -1
    return rank < 0 ? [] : [{ ...item, rank }]
  }).sort((a, b) => a.rank - b.rank || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || compare(normalize(a.title), normalize(b.title)) || compare(a.id, b.id))
}
module.exports = { KINDS, normalize, rankSearch, compare }
