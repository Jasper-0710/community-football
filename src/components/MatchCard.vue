<script setup lang="ts">
// Remove native component hosts so flex/grid layout matches H5; accept app-level design classes.
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { computed } from 'vue'
import type { Match, Tournament } from '@/domain/types'
import { findTeam, stageNames, statusNames, participantLabel } from '@/domain/tournament'
import TeamBadge from './TeamBadge.vue'
import AppIcon from './AppIcon.vue'
const props = withDefaults(defineProps<{ match: Match; data: Tournament; compact?: boolean }>(), { compact: false })
const home = computed(() => findTeam(props.data, props.match.homeId)), away = computed(() => findTeam(props.data, props.match.awayId))
function open() { uni.navigateTo({ url: `/pages/match/detail?id=${props.match.id}` }) }
</script>
<template>
  <button hover-class="none" role="button" tabindex="0" class="ui-button match-card" :class="{ 'is-live': match.status === 'live', compact }" :aria-label="`${participantLabel(match, 'home', data)}对阵${participantLabel(match, 'away', data)}，查看比赛`" @click="open">
    <view class="match-meta"><text>{{ stageNames[match.stage] }} <text class="meta-divider">/</text> {{ match.time }}</text><view class="status-tag" :class="match.status"><view v-if="match.status === 'live'" class="live-dot" />{{ statusNames[match.status] }}<text v-if="match.status === 'live'"> {{ match.minute }}′</text></view></view>
    <view class="match-teams"><view class="match-team"><TeamBadge :team="home" :size="compact ? 37 : 47" /><text>{{ home?.name || '待定' }}</text></view><view class="match-score"><text v-if="match.homeScore !== null" class="score-number">{{ match.homeScore }}<text class="score-separator">:</text>{{ match.awayScore }}</text><text v-else class="versus">VS</text><text class="score-caption">{{ match.status === 'live' ? '模拟赛况' : match.status === 'finished' ? '全场' : '即将开赛' }}</text></view><view class="match-team"><TeamBadge :team="away" :size="compact ? 37 : 47" /><text>{{ away?.name || '待定' }}</text></view></view>
    <view class="match-bottom"><AppIcon name="pin" tone="muted" :size="13" /><text>{{ match.venue }}</text><AppIcon name="external" tone="muted" :size="14" /></view>
  </button>
</template>
