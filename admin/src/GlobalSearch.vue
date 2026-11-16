<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { searchKinds, type SearchItem, type SearchKind, type SearchPage } from '../../src/domain/content'
import type { createAdminAuth } from './auth'
const props = defineProps<{ auth: ReturnType<typeof createAdminAuth> }>()
const emit = defineEmits<{ open: [item: SearchItem] }>()
const query = ref(''), kind = ref<'all' | SearchKind>('all'), page = ref<SearchPage | null>(null), busy = ref(false), error = ref('')
let generation = 0
async function search(more = false) {
  const q = query.value.trim(), serial = ++generation; if (!more) page.value = null; error.value = ''
  if (!q) { busy.value = false; return }
  busy.value = true
  try { const r = await props.auth.authorized((api, token) => api.search(token, q, kind.value, more ? page.value?.nextCursor || undefined : undefined)); if (serial === generation) page.value = more && page.value ? { ...r, results: [...page.value.results, ...r.results] } : r }
  catch (e) { if (serial === generation) { page.value = null; error.value = e instanceof Error ? e.message : '搜索暂不可用。' } }
  finally { if (serial === generation) busy.value = false }
}
function change() { generation++; page.value = null; busy.value = false; error.value = '' }
onUnmounted(() => { generation++ })
</script>
<template><section class="global-search"><div class="workspace-heading"><div><span class="eyebrow">管理检索</span><h1>全局搜索</h1><p class="muted">搜索球队、球员、比赛和新闻，进入对应管理记录。</p></div></div><form class="account-card content-search-form" @submit.prevent="search()"><label>搜索关键词<input v-model="query" maxlength="40" placeholder="输入名称、场地或内容关键词" @input="change" /></label><button class="primary-button" :disabled="busy || !query.trim()">搜索</button></form><div class="content-actions search-kind-tabs"><button v-for="k in searchKinds" :key="k.id" class="secondary-button" :aria-pressed="kind === k.id" @click="kind = k.id; search()">{{ k.label }}{{ page && k.id !== 'all' ? ` ${page.counts[k.id]}` : '' }}</button></div><p v-if="error" class="notice" role="alert">{{ error }}</p><p v-if="busy" role="status">正在搜索…</p><p v-if="page && !page.results.length" class="account-card">没有找到相关内容。</p><div v-if="page" class="account-card"><button v-for="r in page.results" :key="`${r.kind}:${r.id}`" class="overview-recent admin-search-result" @click="emit('open', r)"><span><small>{{ searchKinds.find(k => k.id === r.kind)?.label }}</small><strong>{{ r.title }}</strong><small>{{ r.detail }}</small></span><span>查看记录 →</span></button><button v-if="page.nextCursor" class="secondary-button" :disabled="busy" @click="search(true)">加载更多结果</button></div></section></template>
