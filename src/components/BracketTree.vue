<script setup lang="ts">
// Remove native component hosts so flex/grid layout matches H5; accept app-level design classes.
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { computed } from 'vue'
import type { Match, Tournament } from '@/domain/types'
import { findTeam, participantLabel, winnerId } from '@/domain/tournament'
import TeamBadge from './TeamBadge.vue'
import AppIcon from './AppIcon.vue'
const props = defineProps<{ data: Tournament; matches: Match[] }>()
const rounds = computed(() => [
  { name: '四分之一决赛', date: '10 月 25 日', className: 'quarters', pairs: [props.matches.filter(m => m.stage === 'quarter').slice(0, 2), props.matches.filter(m => m.stage === 'quarter').slice(2, 4)] },
  { name: '半决赛', date: '11 月 01 日', className: 'semis', pairs: [props.matches.filter(m => m.stage === 'semi')] },
  { name: '决赛', date: '11 月 08 日', className: 'final', pairs: [props.matches.filter(m => m.stage === 'final')] },
])
function open(id: string) { uni.navigateTo({ url: `/pages/match/detail?id=${id}` }) }
</script>
<template>
  <view class="bracket-panel"><view class="bracket-toolbar"><view><AppIcon name="trophy" tone="gold" :size="21" /><text>通往冠军的每一步</text></view><text class="muted small-text">横向滑动查看完整签位 · 点击查看比赛</text></view><scroll-view scroll-x class="bracket-scroll"><view class="bracket-tree"><view v-for="round in rounds" :key="round.className" class="bracket-column" :class="round.className"><view class="bracket-round-heading"><text>{{ round.name }}</text><text>{{ round.date }}</text></view><view class="bracket-round-body"><view v-for="(pair, pairIndex) in round.pairs" :key="pairIndex" class="bracket-pair"><button hover-class="none" role="button" tabindex="0" v-for="match in pair" :key="match.id" class="ui-button bracket-match" :class="{ live: match.status === 'live', 'final-match': match.stage === 'final' }" :aria-label="`${match.id.toUpperCase()} ${participantLabel(match, 'home', data)}对阵${participantLabel(match, 'away', data)}`" @click="open(match.id)"><view class="bracket-node-meta"><text>{{ match.id.toUpperCase() }} · {{ match.time }}</text><text :class="{ 'green-text': match.status === 'live' }">{{ match.status === 'finished' ? '已结束' : match.status === 'live' ? `模拟进行中 ${match.minute}′` : '未开始' }}</text></view><view class="bracket-team" :class="{ winner: winnerId(match) === match.homeId && match.homeId }"><TeamBadge :team="findTeam(data, match.homeId)" :size="25" /><text class="bracket-team-name">{{ participantLabel(match, 'home', data) }}</text><text class="bracket-score">{{ match.homeScore ?? '–' }}</text></view><view class="bracket-team" :class="{ winner: winnerId(match) === match.awayId && match.awayId }"><TeamBadge :team="findTeam(data, match.awayId)" :size="25" /><text class="bracket-team-name">{{ participantLabel(match, 'away', data) }}</text><text class="bracket-score">{{ match.awayScore ?? '–' }}</text></view></button></view></view></view></view></scroll-view><view class="bracket-legend"><view><view class="legend-winner"/>已晋级球队</view><view><view class="live-dot"/>模拟进行中</view><view><text class="muted">?</text>签位待定</view><text>晋级结果与赛程、比赛详情使用同一份数据</text></view></view>
</template>
