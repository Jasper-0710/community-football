<script setup lang="ts">
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import type { DirectoryMatch } from '@/domain/directory'
import { matchStageLabels, matchStatusLabels, matchTime } from '@/domain/match'
import AppIcon from './AppIcon.vue'
defineProps<{ entry: DirectoryMatch }>()
function open(id: string) { uni.navigateTo({ url: `/pages/match/detail?id=${id}` }) }
</script>
<template>
  <button role="button" tabindex="0" hover-class="none" class="ui-button panel directory-match-card" :aria-label="`${entry.match.homeTeamName || '待定球队'} 对 ${entry.match.awayTeamName || '待定球队'}，查看比赛详情`" @click="open(entry.match.id)">
    <view class="directory-match-top"><text class="directory-competition">{{ entry.competitionName }}</text><text class="directory-match-status" :class="{ 'is-live': entry.match.status === 'live' }">{{ matchStatusLabels[entry.match.status] }}</text></view>
    <view class="directory-match-teams"><text>{{ entry.match.homeTeamName || '待定球队' }}</text><text class="directory-match-score">{{ ['live', 'finished'].includes(entry.match.status) ? `${entry.match.homeScore} : ${entry.match.awayScore}` : 'VS' }}</text><text>{{ entry.match.awayTeamName || '待定球队' }}</text></view>
    <view class="directory-match-meta"><text>{{ matchStageLabels[entry.match.stage] }} · 第{{ entry.match.round }}轮</text><text>{{ matchTime(entry.match.scheduledAt) }} 北京时间</text><text>{{ entry.match.venue }}</text><text v-if="entry.match.penalties">点球 {{ entry.match.penalties[0] }} : {{ entry.match.penalties[1] }}</text></view>
    <view class="directory-match-link"><text>比赛详情</text><AppIcon name="arrow" :size="15" tone="green"/></view>
  </button>
</template>
<style scoped>
.directory-match-card { display:flex; flex-direction:column; align-items:stretch; width:100%; height:100%; padding:20px; border-radius:14px; text-align:left; white-space:normal; color:var(--ink); gap:18px; }
.directory-match-top { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; font-size:13px; }
.directory-competition { min-width:0; color:var(--muted); overflow-wrap:anywhere; }
.directory-match-status { flex:none; color:var(--green); background:var(--surface-soft, #eef3e9); border-radius:6px; padding:3px 7px; font-size:12px; }
.directory-match-status.is-live { color:#9c3d20; background:#fff0e7; }
.directory-match-teams { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; gap:12px; font-size:16px; font-weight:600; line-height:1.5; }
.directory-match-teams > text { overflow-wrap:anywhere; }
.directory-match-teams > text:last-child { text-align:right; }
.directory-match-score { font-size:24px; font-weight:600; font-variant-numeric:tabular-nums; white-space:nowrap; }
.directory-match-meta { display:flex; flex-direction:column; gap:5px; color:var(--muted); font-size:13px; line-height:1.6; overflow-wrap:anywhere; }
.directory-match-link { display:flex; align-items:center; justify-content:flex-end; gap:7px; margin-top:auto; font-size:13px; color:var(--green); }
@media(max-width:360px) { .directory-match-card { padding:16px; } .directory-match-teams { font-size:14px; gap:8px; } .directory-match-score { font-size:22px; } }
</style>
