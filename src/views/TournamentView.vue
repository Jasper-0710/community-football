<script setup lang="ts">
// Remove native component hosts so flex/grid layout matches H5; accept app-level design classes.
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { ref, computed, watch } from 'vue'
import type { Tournament, Match } from '@/domain/types'
import { filterMatches, dateLabel, weekday } from '@/domain/tournament'
import { useFavorites } from '@/composables/useFavorites'
import AppIcon from '@/components/AppIcon.vue'
import CompetitionList from '@/components/CompetitionList.vue'
import MatchCard from '@/components/MatchCard.vue'
import BracketTree from '@/components/BracketTree.vue'
import TeamBadge from '@/components/TeamBadge.vue'
const props = defineProps<{ data: Tournament; matches: Match[]; initialView?: string }>()
const mode = ref(props.initialView || 'competitions')
watch(() => props.initialView, v => { if (v) mode.value = v })
const selectedDate = ref(props.data.demoDate), status = ref('all'), teamId = ref('')
const dates = computed(() => [...new Set(['2026-10-18', '2026-10-24', props.data.demoDate, '2026-10-26', '2026-11-01', '2026-11-08'])].sort())
const teamOptions = computed(() => ['全部球队', ...props.data.teams.map(t => t.name)])
const selectedTeamIndex = computed(() => props.data.teams.findIndex(t => t.id === teamId.value) + 1)
const teamName = computed(() => props.data.teams.find(t => t.id === teamId.value)?.name || '全部球队')
const visibleMatches = computed(() => filterMatches(props.matches, { date: selectedDate.value, status: status.value, teamId: teamId.value }))
const filters = [{ id: 'all', label: '全部比赛' }, { id: 'live', label: '进行中' }, { id: 'scheduled', label: '未开始' }, { id: 'finished', label: '已结束' }]
const { favoriteIds, toggle } = useFavorites()
function selectTeam(event: { detail: { value: string | number } }) { const index = Number(event.detail.value); teamId.value = index ? props.data.teams[index - 1].id : '' }
function reset() { selectedDate.value = props.data.demoDate; status.value = 'all'; teamId.value = '' }
function openTeam(id: string) { uni.navigateTo({ url: `/pages/team/detail?id=${id}` }) }
</script>
<template>
  <view class="inner-page"><view class="page-heading"><view><text class="eyebrow">THE MATCHDAY</text><text class="page-title">每一场，都为热爱。</text><text class="page-description">赛事信息实时读取；赛程、对阵图及球队为示例预览</text></view><view class="page-emblem"><AppIcon name="ball" :size="46" tone="green" /></view></view>
    <view class="page-tabs"><button class="ui-button" :class="{ active: mode === 'competitions' }" @click="mode = 'competitions'">赛事信息</button><button hover-class="none" role="button" tabindex="0" class="ui-button" :class="{ active: mode === 'schedule' }" @click="mode = 'schedule'"><AppIcon name="calendar" :tone="mode === 'schedule' ? 'green' : 'muted'" :size="18" />示例赛程</button><button hover-class="none" role="button" tabindex="0" class="ui-button" :class="{ active: mode === 'bracket' }" @click="mode = 'bracket'"><AppIcon name="bracket" :tone="mode === 'bracket' ? 'green' : 'muted'" :size="18" />示例对阵图</button><button hover-class="none" role="button" tabindex="0" class="ui-button" :class="{ active: mode === 'teams' }" @click="mode = 'teams'"><AppIcon name="users" :tone="mode === 'teams' ? 'green' : 'muted'" :size="18" />示例球队</button></view>
    <CompetitionList v-if="mode === 'competitions'" />
    <view v-else-if="mode === 'schedule'" class="schedule-layout"><view class="schedule-main"><scroll-view scroll-x class="date-scroll"><view class="date-strip"><button hover-class="none" role="button" tabindex="0" v-for="date in dates" :key="date" class="ui-button date-cell" :class="{ active: selectedDate === date }" :aria-label="`选择${date}`" @click="selectedDate = date"><text>{{ weekday(date) }}</text><text class="date-number">{{ date.slice(5).replace('-', '.') }}</text><text class="date-indicator">{{ date === data.demoDate ? '演示日' : matches.some(m => m.date === date) ? `${matches.filter(m => m.date === date).length} 场比赛` : '休赛日' }}</text></button></view></scroll-view>
      <view class="schedule-filters"><view class="filter-chips"><button hover-class="none" role="button" tabindex="0" v-for="filter in filters" :key="filter.id" class="ui-button filter-chip" :class="{ active: status === filter.id }" @click="status = filter.id">{{ filter.label }}</button></view><picker :range="teamOptions" :value="selectedTeamIndex" @change="selectTeam"><view class="team-picker">{{ teamName }}<AppIcon name="down" :size="14" /></view></picker></view>
      <view class="schedule-day-heading"><text>{{ dateLabel(selectedDate) }} <text class="muted">{{ weekday(selectedDate) }}</text></text><text class="muted small-text">{{ visibleMatches.length }} 场比赛</text></view>
      <view v-if="visibleMatches.length" class="schedule-grid"><MatchCard v-for="match in visibleMatches" :key="match.id" :match="match" :data="data" /></view>
      <view v-else class="empty-state panel"><view class="empty-icon"><AppIcon name="calendar" tone="muted" :size="32" /></view><text class="h3">这一天，球场休息一下</text><text class="muted">当前日期或筛选条件下没有比赛</text><button hover-class="none" role="button" tabindex="0" class="ui-button outline-button" @click="reset">回到演示比赛日</button></view>
      <view class="inline-note"><AppIcon name="info" :size="16" tone="muted"/><text>所有时间为北京时间。当前展示固定的演示赛况，不代表真实直播。</text></view>
    </view><view class="schedule-sidebar"><view class="tournament-progress"><view class="progress-trophy"><AppIcon name="trophy" :size="36" tone="green" /></view><text class="eyebrow">ROAD TO THE FINAL</text><text class="h2">冠军之路，正在上演</text><text class="muted small-text">每一次晋级，都有整个社区的期待。</text><view class="progress-step completed"><view class="step-dot"><AppIcon name="check" tone="white" :size="12" /></view><view><text>小组赛</text><text>10.04 — 10.18</text></view><text class="step-state">已结束</text></view><view class="progress-step current"><view class="step-dot"/><view><text>四分之一决赛</text><text>10.25</text></view><text class="step-state">演示日</text></view><view class="progress-step"><view class="step-dot"/><view><text>半决赛</text><text>11.01</text></view></view><view class="progress-step"><view class="step-dot"/><view><text>决赛</text><text>11.08</text></view></view><button hover-class="none" role="button" tabindex="0" class="ui-button outline-button" @click="mode = 'bracket'">查看完整对阵<AppIcon name="arrow" :size="16" /></button></view><view class="supporter-note"><text>不只是球员的比赛，</text><text>也是邻里共同的周末。</text><AppIcon name="heart" tone="green" :size="23" /></view></view></view>
    <BracketTree v-else-if="mode === 'bracket'" :data="data" :matches="matches" />
    <view v-else class="teams-section"><view class="section-heading"><text class="h2">八支球队，同一座城</text><text class="muted small-text">关注仅保存在本机</text></view><view class="team-grid"><view v-for="team in data.teams" :key="team.id" class="team-card"><button hover-class="none" role="button" tabindex="0" class="ui-button team-card-main" @click="openTeam(team.id)"><TeamBadge :team="team" :size="67" /><text class="h3">{{ team.name }}</text><text class="muted small-text">{{ team.district }} · {{ team.group }} 组</text><text class="team-founded">EST. {{ team.founded }}</text></button><button hover-class="none" role="button" tabindex="0" class="ui-button follow-button" :class="{ followed: favoriteIds.includes(team.id) }" @click="toggle(team.id)"><AppIcon :name="favoriteIds.includes(team.id) ? 'check' : 'heart'" tone="green" :size="15" />{{ favoriteIds.includes(team.id) ? '已关注' : '关注球队' }}</button></view></view></view>
  </view>
</template>
