<script setup lang="ts">
// Remove native component hosts so flex/grid layout matches H5; accept app-level design classes.
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { computed } from 'vue'
import type { Tournament } from '@/domain/types'
import { standings } from '@/domain/tournament'
import TeamBadge from './TeamBadge.vue'
const props = withDefaults(defineProps<{ data: Tournament; group?: 'A' | 'B'; compact?: boolean }>(), { compact: false })
const rows = computed(() => standings(props.data, props.group))
function open(id: string) { uni.navigateTo({ url: `/pages/team/detail?id=${id}` }) }
</script>
<template>
  <scroll-view scroll-x class="standings-scroll"><view class="standings-table" :class="{ compact }"><view class="standing-row table-header"><text class="rank-col">排名</text><text class="team-col">球队</text><text>赛</text><text v-if="!compact">胜/平/负</text><text v-if="!compact">净胜球</text><text class="points-col">积分</text></view><button hover-class="none" role="button" tabindex="0" v-for="(row, index) in rows" :key="row.team.id" class="ui-button standing-row" @click="open(row.team.id)"><text class="rank-col" :class="{ 'top-rank': index < 2 }">{{ String(index + 1).padStart(2, '0') }}</text><view class="team-col"><TeamBadge :team="row.team" :size="25" /><text>{{ row.team.name }}</text></view><text class="table-number">{{ row.played }}</text><text v-if="!compact" class="table-number">{{ row.won }}/{{ row.drawn }}/{{ row.lost }}</text><text v-if="!compact" class="table-number">{{ row.difference > 0 ? '+' : '' }}{{ row.difference }}</text><text class="points-col">{{ row.points }}</text></button></view></scroll-view><text v-if="!compact" class="table-scroll-hint">左右滑动查看完整积分数据</text>
</template>
