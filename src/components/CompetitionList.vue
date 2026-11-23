<script setup lang="ts">
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { computed, onMounted } from 'vue'
import { useCompetitions } from '@/composables/useCompetitions'
import { formatLabel, registrationLabels } from '@/domain/competition'
const { competitions, error, loading, cursor, load } = useCompetitions()
const props = defineProps<{ compact?: boolean }>()
const emit = defineEmits<{ explore: [] }>()
const visible = computed(() => props.compact ? competitions.value.slice(0, 3) : competitions.value)
onMounted(() => { void load() })
function open(id: string) { uni.navigateTo({ url: `/pages/competition/detail?id=${encodeURIComponent(id)}` }) }
</script>
<template>
  <view class="public-competitions" :class="{ 'compact-competitions': compact }">
    <view class="section-heading section-heading-box"><view><text class="section-title">{{ compact ? '公开赛事' : '赛事信息' }}</text><text class="section-subtitle">{{ compact ? '找到想看的比赛，了解身边的赛事' : '赛事介绍、参赛要求与报名时间' }}</text></view><button v-if="compact" role="button" tabindex="0" class="ui-button text-button" @click="emit('explore')">全部赛事 →</button><button v-else class="ui-button text-button" :disabled="loading" @click="load()">刷新赛事</button></view>
    <view v-if="error" class="panel competition-empty" role="alert"><text>{{ error }}</text><button class="ui-button outline-button" @click="load()">重新加载赛事</button></view>
    <view v-else-if="loading && !competitions.length" class="panel competition-empty"><text>正在加载赛事…</text></view>
    <view v-else-if="!competitions.length" class="panel competition-empty"><text class="h3">暂无公开赛事</text><text class="muted">赛事发布后会在这里展示。</text></view>
    <view v-else class="public-competition-grid"><button v-for="item in visible" :key="item.id" class="ui-button panel public-competition-card" :data-competition-id="item.id" @click="open(item.id)"><view class="competition-meta"><text>{{ formatLabel(item.format) }}</text><text class="registration-status" :class="item.registrationStatus">{{ registrationLabels[item.registrationStatus] }}</text></view><text class="competition-name">{{ item.name }}</text><text v-if="compact" class="muted small-text">{{ item.startDate }} — {{ item.endDate }}</text><template v-else><text class="competition-summary">{{ item.description }}</text><view class="competition-facts"><view><text class="fact-label">赛事日期</text><text>{{ item.startDate }} — {{ item.endDate }}</text></view><view><text class="fact-label">比赛地点</text><text>{{ item.venue }}</text></view></view><text class="competition-link">查看赛事详情 →</text></template></button></view>
    <button v-if="cursor && !compact" class="ui-button outline-button competition-more" :disabled="loading" @click="load(true)">{{ loading ? '正在加载…' : '加载更多赛事' }}</button>
  </view>
</template>
<style scoped>
.compact-competitions { margin:28px 0; }
.compact-competitions .section-heading { gap:12px; flex-wrap:wrap; }
.compact-competitions .public-competition-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
.compact-competitions .public-competition-card { padding:18px; min-width:0; }
.compact-competitions .competition-name { margin:10px 0 6px; font-size:18px; }
@media(max-width:760px) { .compact-competitions .public-competition-grid { grid-template-columns:minmax(0,1fr); } .compact-competitions .public-competition-card { padding:16px; } }
</style>
