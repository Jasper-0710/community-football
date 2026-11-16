import { onMounted, onUnmounted, ref } from 'vue'
import { listPublicNews } from '@/services/content'
import type { ContentCategory, NewsArticle } from '@/domain/content'

export function useNews(initialCategory?: ContentCategory) {
  const articles = ref<NewsArticle[]>([]), cursor = ref<string | null>(null), category = ref<ContentCategory | undefined>(initialCategory), busy = ref(false), error = ref('')
  let generation = 0
  async function load(more = false) {
    const serial = ++generation, currentCategory = category.value
    busy.value = true; error.value = ''
    if (!more) { articles.value = []; cursor.value = null }
    try {
      const p = await listPublicNews(currentCategory, more ? cursor.value || undefined : undefined)
      if (serial !== generation) return
      articles.value = more ? [...articles.value, ...p.articles] : p.articles; cursor.value = p.nextCursor
    } catch (e) { if (serial === generation) { articles.value = []; cursor.value = null; error.value = e instanceof Error ? e.message : '内容暂不可用。' } }
    finally { if (serial === generation) busy.value = false }
  }
  onMounted(() => { void load() }); onUnmounted(() => { generation++ })
  return { articles, cursor, category, busy, error, load }
}
