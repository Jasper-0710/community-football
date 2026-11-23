<script setup lang="ts">
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { computed } from 'vue'
import type { ProfileRecord, TeamRecordSummary, PlayerRecordSummary, PlayerMatch } from '@/domain/directory'
import { playerEventLabels } from '@/domain/directory'
import AppIcon from './AppIcon.vue'
import PublicMatchCard from './PublicMatchCard.vue'
const props = defineProps<{ record: ProfileRecord; busy: boolean; error: string; selected: string; player?: boolean }>()
const emit = defineEmits<{ select: [id: string]; more: []; refresh: [] }>()
const scopeName = computed(() => props.record.competitions.find(c => c.id === props.selected)?.name || '全部公开参赛赛事')
const metrics = computed(() => {
  if (props.player) {
    const s = props.record.summary as PlayerRecordSummary
    return [{ label:'进球', value:s.goals }, { label:'助攻', value:s.assists }, { label:'黄牌', value:s.yellow }, { label:'红牌', value:s.red }]
  }
  const s = props.record.summary as TeamRecordSummary
  return [{ label:'已赛', value:s.played }, { label:'胜', value:s.won }, { label:'平', value:s.drawn }, { label:'负', value:s.lost }, { label:'进球', value:s.goalsFor }, { label:'失球', value:s.goalsAgainst }, { label:'净胜球', value:s.difference }]
})
function choose(event: { detail: { value: string | number } }) { const index = Number(event.detail.value); emit('select', index ? props.record.competitions[index - 1]?.id || '' : '') }
function chooseNative(event: Event) { emit('select', (event.target as HTMLSelectElement).value) }
const events = (row: ProfileRecord['matches'][number]) => (row as PlayerMatch).events || []
</script>
<template>
  <view class="public-profile-records">
    <view class="section-heading record-heading"><view><text class="section-title">{{ player ? '球员表现' : '球队战绩' }}</text><text class="section-subtitle">{{ scopeName }}</text></view><button role="button" tabindex="0" class="ui-button text-button" :disabled="busy" @click="emit('refresh')">刷新档案</button></view>
    <view class="record-scope-field"><text class="schedule-filter-label">统计范围</text>
      <!-- H5 uses the browser control: a uni picker has a delayed close callback
           that cannot survive this profile's loading/error branch unmount. -->
      <!-- #ifdef H5 -->
      <view class="schedule-picker record-native-wrap"><select class="record-native-select" aria-label="统计范围" :value="selected" :disabled="busy" @change="chooseNative"><option value="">全部公开参赛赛事</option><option v-for="competition in record.competitions" :key="competition.id" :value="competition.id">{{ competition.name }}</option></select><view class="schedule-picker-icon"><AppIcon name="down" :size="14"/></view></view>
      <!-- #endif -->
      <!-- #ifndef H5 -->
      <picker class="schedule-picker-control" :range="['全部公开参赛赛事', ...record.competitions.map(c => c.name)]" :value="selected ? record.competitions.findIndex(c => c.id === selected) + 1 : 0" :disabled="busy" @change="choose"><view class="schedule-picker"><text class="schedule-picker-value">{{ scopeName }}</text><view class="schedule-picker-icon"><AppIcon name="down" :size="14"/></view></view></picker>
      <!-- #endif -->
    </view>
    <view class="record-metrics"><view v-for="metric in metrics" :key="metric.label" class="panel record-metric"><text class="record-metric-value">{{ metric.value }}</text><text class="muted">{{ metric.label }}</text></view></view>
    <text class="record-explanation">{{ player ? '仅统计已完赛的有效个人事件；乌龙球、点球大战不计入个人进球。事件记录不等于出场次数，未记录上场时间。' : '仅统计已完赛的有效赛果；平局后的点球大战单独展示，不计入进失球或胜平负。' }} 隐藏赛事不计入本页。</text>
    <view class="section-heading record-list-heading"><text class="h3">{{ player ? '相关比赛与事件' : '球队赛程与赛果' }}</text><text class="muted small-text">{{ record.total }} 场{{ player ? '有事件记录' : '比赛' }}</text></view>
    <view v-if="error" class="panel empty-state record-error" role="alert"><text>{{ error }}</text><button role="button" tabindex="0" class="ui-button outline-button" :disabled="busy" @click="emit('refresh')">重新读取档案</button></view>
    <view v-if="!record.matches.length && !error" class="panel empty-state"><AppIcon name="calendar" tone="muted" :size="28"/><text>{{ busy ? '正在读取比赛记录…' : player ? '当前范围暂无个人事件记录' : '当前范围尚未排赛' }}</text><text class="muted small-text">{{ player ? '赛果记录个人事件后，会自动显示在这里。' : '公开赛程发布后，会自动显示在这里。' }}</text></view>
    <view class="record-match-grid"><view v-for="row in record.matches" :key="row.match.id" class="record-match-entry"><PublicMatchCard :entry="row"/><view v-if="player" class="record-events"><text v-for="(event,index) in events(row)" :key="index" class="record-event" :class="`event-${event.kind}`">{{ event.minute }}′ {{ playerEventLabels[event.kind] }}</text></view></view></view>
    <button v-if="record.nextCursor && !error" role="button" tabindex="0" class="ui-button outline-button record-more" :disabled="busy" @click="emit('more')">{{ busy ? '正在读取…' : '加载更多比赛' }}</button>
  </view>
</template>
<style scoped>
.public-profile-records { margin:30px 0; }
.record-heading { gap:12px; flex-wrap:wrap; }
.record-scope-field { display:flex; flex-direction:column; gap:10px; max-width:520px; margin-bottom:20px; }
.record-native-wrap { gap:12px; }
.record-native-wrap:focus-within { outline:2px solid var(--green); outline-offset:2px; }
.record-native-select { min-width:0; width:100%; flex:1; appearance:none; border:0; outline:0; border-radius:0; background:transparent; color:var(--ink); font:inherit; cursor:pointer; }
.record-native-select option { color:var(--ink); background:var(--surface); }
.record-native-wrap .schedule-picker-icon { pointer-events:none; }
.record-metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(90px,1fr)); gap:10px; }
.record-metric { padding:20px 12px; display:flex; flex-direction:column; align-items:center; gap:7px; font-size:13px; border-radius:12px; }
.record-metric-value { font-size:28px; line-height:1.2; font-weight:600; color:var(--green); font-variant-numeric:tabular-nums; }
.record-explanation { display:block; color:var(--muted); font-size:13px; line-height:1.9; margin:16px 0 26px; }
.record-list-heading { flex-wrap:wrap; gap:8px; }
.record-match-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
.record-match-entry { min-width:0; display:flex; flex-direction:column; }
.record-match-entry :deep(.directory-match-card) { height:auto; flex:1; }
.record-events { display:flex; flex-wrap:wrap; gap:8px; padding:12px 2px 6px; }
.record-event { font-size:13px; padding:4px 8px; background:#eaf1e6; border-radius:6px; color:#2c593e; }
.event-yellow { background:#fff3cc; color:#7f610d; }
.event-red { background:#ffe8e0; color:#96381f; }
.record-more { margin:22px auto 0; }
.record-error { margin-bottom:18px; }
@media(max-width:600px) { .record-match-grid { grid-template-columns:minmax(0,1fr); } .record-metrics { grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; } .record-metric { padding:16px 4px; } .record-metric-value { font-size:24px; } }
@media(max-width:360px) { .record-heading .section-title { font-size:23px; } .record-heading .text-button { font-size:13px; } }
</style>
