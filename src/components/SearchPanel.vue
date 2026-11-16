<script setup lang="ts">
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { searchPublic, searchSuggestions } from '@/services/content'
import { publicSearchUrl, searchKinds, type SearchPage, type SearchItem, type SearchKind } from '@/domain/content'
import { SEARCH_HISTORY_KEY, cleanSearchHistory, rememberSearch } from '@/domain/search-history'
import AppIcon from './AppIcon.vue'
const emit = defineEmits<{ close: [] }>()
const query = ref(''), kind = ref<'all' | SearchKind>('all'), page = ref<SearchPage | null>(null), words = ref<string[]>([]), history = ref<string[]>([]), busy = ref(false), error = ref(''), suggestionError = ref('')
let generation = 0, timer: ReturnType<typeof setTimeout> | undefined, disposed = false
try { history.value = cleanSearchHistory(uni.getStorageSync(SEARCH_HISTORY_KEY)) } catch { /* Device storage may be disabled. */ }
function remember() { if (!query.value.trim()) return; history.value = rememberSearch(history.value, query.value); try { uni.setStorageSync(SEARCH_HISTORY_KEY, history.value) } catch { /* Search remains available without persistence. */ } }
function clearHistory() { history.value = []; try { uni.removeStorageSync(SEARCH_HISTORY_KEY) } catch {} }
async function suggestions() { suggestionError.value = ''; try { const result = await searchSuggestions(); if (!disposed) words.value = result } catch { if (!disposed) suggestionError.value = '推荐词暂不可用' } }
async function search(more = false) {
  clearTimeout(timer); const serial = ++generation, q = query.value.trim(); error.value = ''
  if (!more) page.value = null
  if (!q) { busy.value = false; return }
  busy.value = true
  try { const r = await searchPublic(q, kind.value, more ? page.value?.nextCursor || undefined : undefined); if (serial === generation) page.value = more && page.value ? { ...r, results: [...page.value.results, ...r.results] } : r }
  catch (e) { if (serial === generation) { page.value = null; error.value = e instanceof Error ? e.message : '暂时无法搜索，请重试。' } }
  finally { if (serial === generation) busy.value = false }
}
function submit() { remember(); void search() }
function choose(word: string) { query.value = word; remember(); void search() }
function open(item: SearchItem) { remember(); emit('close'); uni.navigateTo({ url: publicSearchUrl(item) }) }
watch([query, kind], () => { generation++; page.value = null; error.value = ''; busy.value = !!query.value.trim(); clearTimeout(timer); if (query.value.trim()) timer = setTimeout(() => { void search() }, 280) }, { flush: 'sync' })
onMounted(() => { void suggestions() }); onUnmounted(() => { disposed = true; generation++; clearTimeout(timer) })
// #ifdef H5
const previousFocus = document.activeElement as HTMLElement | null
function handleDialogKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { emit('close'); return }
  if (event.key !== 'Tab') return
  const elements = Array.from(document.querySelectorAll<HTMLElement>('.search-panel input, .search-panel [tabindex="0"]')).filter(element => element.offsetParent !== null && !element.hasAttribute('disabled'))
  const first = elements[0], last = elements[elements.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(() => document.addEventListener('keydown', handleDialogKey))
onUnmounted(() => { document.removeEventListener('keydown', handleDialogKey); if (previousFocus?.isConnected) previousFocus.focus() })
// #endif
</script>
<template>
  <view class="overlay" @click.self="emit('close')"><view class="search-panel" role="dialog" aria-label="搜索赛事" aria-modal="true">
    <view class="section-heading"><text class="h2">发现你的主场</text><button role="button" tabindex="0" hover-class="none" class="ui-button icon-button" aria-label="关闭搜索" @click="emit('close')"><AppIcon name="close" /></button></view>
    <view class="search-input"><AppIcon name="search" tone="muted"/><input v-model="query" :focus="true" :maxlength="40" placeholder="搜索球队、球员、比赛、新闻" confirm-type="search" aria-label="搜索球队、球员、比赛、新闻" @confirm="submit"/><button role="button" tabindex="0" v-if="query" class="ui-button icon-button small" aria-label="清空搜索" @click="query = ''"><AppIcon name="close" :size="16"/></button><button role="button" tabindex="0" class="ui-button text-button" @click="submit">搜索</button></view>
    <view class="category-filters search-kind-filters"><button role="button" tabindex="0" v-for="k in searchKinds" :key="k.id" class="ui-button filter-chip" :class="{ active: kind === k.id }" @click="kind = k.id">{{ k.label }}{{ page && k.id !== 'all' ? ` ${page.counts[k.id]}` : '' }}</button></view>
    <view v-if="!query.trim()" class="search-discovery"><view v-if="history.length" class="search-history"><view class="section-heading"><text class="muted">最近搜索</text><button role="button" tabindex="0" class="ui-button text-button" @click="clearHistory">清空历史</button></view><view class="chip-list"><button role="button" tabindex="0" v-for="word in history" :key="word" class="ui-button chip" @click="choose(word)">{{ word }}</button></view></view><view class="search-popular"><text class="muted">热门搜索</text><view class="chip-list"><button role="button" tabindex="0" v-for="word in words" :key="word" class="ui-button chip" @click="choose(word)">{{ word }}</button></view><button role="button" tabindex="0" v-if="suggestionError" class="ui-button text-button" @click="suggestions">{{ suggestionError }}，点击重试</button></view></view>
    <scroll-view v-else scroll-y class="search-results"><view v-if="error" class="empty-state" role="alert"><text>{{ error }}</text><button role="button" tabindex="0" class="ui-button outline-button" @click="search()">重新搜索</button></view><view v-else-if="busy && !page" class="empty-state"><text>正在搜索…</text></view><view v-else-if="page && !page.results.length" class="empty-state"><AppIcon name="search" tone="muted" :size="36"/><text>没有找到“{{ query }}”</text><text class="muted small-text">试试球员、球队或场地名称</text></view><button role="button" tabindex="0" v-for="result in page?.results || []" :key="`${result.kind}:${result.id}`" class="ui-button search-result" @click="open(result)"><view><text class="category-tag">{{ searchKinds.find(k => k.id === result.kind)?.label }}</text><text class="result-title">{{ result.title }}</text><text class="muted small-text">{{ result.detail }}</text></view><AppIcon name="chevron" :size="17" tone="muted"/></button><button role="button" tabindex="0" v-if="page?.nextCursor" class="ui-button text-button" :disabled="busy" @click="search(true)">加载更多结果</button></scroll-view>
    <text class="search-disclaimer">搜索公开内容。最近搜索仅保存在当前设备。</text>
  </view></view>
</template>
