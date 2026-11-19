<script setup lang="ts">
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { searchPublic, searchSuggestions } from '@/services/content'
import { newsCategories, type SearchItem } from '@/domain/content'
import AppIcon from './AppIcon.vue'
const query = ref(''), teams = ref<SearchItem[]>([]), words = ref<string[]>([]), cursor = ref<string | null>(null), loading = ref(false), error = ref('')
let generation = 0, timer: ReturnType<typeof setTimeout> | undefined, disposed = false
async function search(more = false) {
  clearTimeout(timer)
  const serial = ++generation, q = query.value.trim()
  error.value = ''
  if (!more) { teams.value = []; cursor.value = null }
  if (!q) { loading.value = false; return }
  loading.value = true
  try {
    const page = await searchPublic(q, 'team', more ? cursor.value || undefined : undefined)
    if (serial === generation) { teams.value = more ? [...teams.value, ...page.results] : page.results; cursor.value = page.nextCursor }
  } catch (failure) { if (serial === generation) error.value = failure instanceof Error ? failure.message : '球队暂时无法读取，请重试。' }
  finally { if (serial === generation) loading.value = false }
}
async function suggestions() {
  try { const result = await searchSuggestions(); if (!disposed) words.value = result.filter(w => !(newsCategories as readonly string[]).includes(w)) }
  catch { /* Manual searches remain available. */ }
}
watch(query, () => { ++generation; clearTimeout(timer); teams.value = []; cursor.value = null; error.value = ''; loading.value = !!query.value.trim(); timer = setTimeout(() => { void search() }, 280) }, { flush: 'sync' })
function open(id: string) { uni.navigateTo({ url: `/pages/team/detail?id=${encodeURIComponent(id)}` }) }
onMounted(() => { void suggestions() })
onUnmounted(() => { disposed = true; ++generation; clearTimeout(timer) })
</script>
<template>
  <view class="public-team-finder"><view class="section-heading"><view><text class="section-title">发现参赛球队</text><text class="section-subtitle">查找已公开的真实球队，进入主页关注</text></view></view>
    <view class="team-finder-search"><AppIcon name="search" :size="20" tone="muted"/><input v-model="query" :maxlength="40" placeholder="输入球队名称或地区" aria-label="查找参赛球队" confirm-type="search" @confirm="search()"/><button role="button" tabindex="0" class="ui-button text-button" @click="search()">查找球队</button></view>
    <view v-if="!query.trim()" class="panel team-finder-empty"><text class="h3">从这里找到你的主队</text><text class="muted">按球队名称、地区搜索，或从真实比赛详情进入球队主页。</text><view class="chip-list"><button v-for="word in words" :key="word" role="button" tabindex="0" class="ui-button chip" @click="query = word">{{ word }}</button></view></view>
    <view v-else-if="error" class="panel team-finder-empty" role="alert"><text>{{ error }}</text><button role="button" tabindex="0" class="ui-button outline-button" :disabled="loading" @click="search()">重新查找球队</button></view>
    <view v-else-if="!teams.length" class="panel team-finder-empty"><text>{{ loading ? '正在查找球队…' : '暂无符合条件的公开球队' }}</text><text class="muted">只有已审核参赛且赛事公开的球队会出现在这里。</text></view>
    <view class="public-team-results"><button v-for="team in teams" :key="team.id" role="button" tabindex="0" class="ui-button panel public-team-result" :data-team-id="team.id" @click="open(team.id)"><view class="favorite-initial">{{ team.title.slice(0, 1) }}</view><view class="favorite-team-copy"><text class="h3">{{ team.title }}</text><text class="muted small-text">{{ team.detail }}</text><text class="team-finder-link">查看球队并关注 →</text></view></button></view>
    <button v-if="cursor" role="button" tabindex="0" class="ui-button outline-button" :disabled="loading" @click="search(true)">{{ loading ? '读取中…' : '加载更多球队' }}</button>
  </view>
</template>
