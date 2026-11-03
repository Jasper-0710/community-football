<script setup lang="ts">
// Remove native component hosts so flex/grid layout matches H5; accept app-level design classes.
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useTournament } from '@/composables/useTournament'
import { participantLabel, dateLabel } from '@/domain/tournament'
import AppIcon from './AppIcon.vue'
const emit = defineEmits<{ close: [] }>()
const query = ref('')
const { data, matches } = useTournament()
const results = computed(() => {
  if (!data.value || !query.value.trim()) return []
  const d = data.value, q = query.value.trim().toLowerCase()
  const items = [
    ...d.teams.map(t => ({ id: t.id, type: '球队', text: t.name, detail: t.district, url: `/pages/team/detail?id=${t.id}` })),
    ...matches.value.map(m => ({ id: m.id, type: '比赛', text: `${participantLabel(m, 'home', d)} vs ${participantLabel(m, 'away', d)}`, detail: `${dateLabel(m.date)} · ${m.venue}`, url: `/pages/match/detail?id=${m.id}` })),
    ...d.articles.map(a => ({ id: a.id, type: a.category, text: a.title, detail: a.date, url: `/pages/article/detail?id=${a.id}` })),
  ]
  const rank = (text: string) => text === q ? 0 : text.startsWith(q) ? 1 : text.includes(q) ? 2 : 3
  return items.filter(i => `${i.type} ${i.text} ${i.detail}`.toLowerCase().includes(q)).sort((a, b) => rank(a.text.toLowerCase()) - rank(b.text.toLowerCase()))
})
function open(url: string) { emit('close'); uni.navigateTo({ url }) }
// #ifdef H5
const previousFocus = document.activeElement as HTMLElement | null
function handleDialogKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { emit('close'); return }
  if (event.key !== 'Tab') return
  const elements = Array.from(document.querySelectorAll<HTMLElement>('.search-panel input, .search-panel [tabindex="0"]')).filter(element => element.offsetParent !== null)
  const first = elements[0], last = elements[elements.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(() => document.addEventListener('keydown', handleDialogKey))
onUnmounted(() => { document.removeEventListener('keydown', handleDialogKey); if (previousFocus?.isConnected) previousFocus.focus() })
// #endif
</script>
<template>
  <view class="overlay" @click.self="emit('close')">
    <view class="search-panel" role="dialog" aria-label="搜索赛事" aria-modal="true">
      <view class="section-heading"><text class="h2">发现你的主场</text><button hover-class="none" role="button" tabindex="0" class="ui-button icon-button" aria-label="关闭搜索" @click="emit('close')"><AppIcon name="close" /></button></view>
      <view class="search-input"><AppIcon name="search" tone="muted" /><input v-model="query" :focus="true" placeholder="搜索球队、比赛、新闻" confirm-type="search" aria-label="搜索球队、比赛、新闻" /><button hover-class="none" role="button" tabindex="0" v-if="query" class="ui-button icon-button small" aria-label="清空搜索" @click="query = ''"><AppIcon name="close" :size="16" /></button></view>
      <view v-if="!query.trim()" class="search-popular"><text class="muted">大家都在看</text><view class="chip-list"><button hover-class="none" role="button" tabindex="0" v-for="word in ['江湾联队', '徐汇星火', '淘汰赛', '公告']" :key="word" class="ui-button chip" @click="query = word">{{ word }}</button></view></view>
      <scroll-view v-else scroll-y class="search-results">
        <view v-if="!results.length" class="empty-state"><AppIcon name="search" tone="muted" :size="36" /><text>没有找到“{{ query }}”</text><text class="muted small-text">试试球队名称或场地名称</text></view>
        <button hover-class="none" role="button" tabindex="0" v-for="result in results" :key="`${result.type}-${result.id}`" class="ui-button search-result" @click="open(result.url)"><view><text class="category-tag">{{ result.type }}</text><text class="result-title">{{ result.text }}</text><text class="muted small-text">{{ result.detail }}</text></view><AppIcon name="chevron" :size="17" tone="muted" /></button>
      </scroll-view>
      <text class="search-disclaimer">当前仅搜索本地演示资料，不含真实个人信息。</text>
    </view>
  </view>
</template>
