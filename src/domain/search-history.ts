export const SEARCH_HISTORY_KEY = 'community-football.search.history.v1'
export function cleanSearchHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((s): s is string => typeof s === 'string').map(s => s.trim().replace(/\s+/g, ' ')).filter(s => !!s && Array.from(s).length <= 40))].slice(0, 10)
}
export function rememberSearch(history: unknown, query: string) { return cleanSearchHistory([query, ...cleanSearchHistory(history)]) }
