<script setup lang="ts">
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { listPublicCompetitions } from '@/services/competitions'
import { listPublicMatches } from '@/services/matches'
import { filterMatchSchedule, matchDate, matchStageLabels, matchStatusLabels, matchTime, type MatchSchedule, type MatchState } from '@/domain/match'
import type { PublicCompetition } from '@/domain/competition'
import AppIcon from '@/components/AppIcon.vue'

const competitions = ref<PublicCompetition[]>([])
const competitionId = ref('')
const matches = ref<MatchSchedule[]>([])
const selectedDate = ref('')
const selectedTeamId = ref('')
const selectedStatus = ref<MatchState | ''>('')
const loading = ref(false)
const loadingMatches = ref(false)
const error = ref('')
const matchError = ref('')
let competitionRequest = 0, matchRequest = 0
const dates = computed(() => [...new Set(matches.value.map(match => matchDate(match.scheduledAt)))].sort())
const teams = computed(() => {
  const values = new Map<string, string>()
  for (const match of matches.value) {
    if (match.homeTeamId) values.set(match.homeTeamId, match.homeTeamName || `球队 ${match.homeTeamId.slice(-8)}`)
    if (match.awayTeamId) values.set(match.awayTeamId, match.awayTeamName || `球队 ${match.awayTeamId.slice(-8)}`)
  }
  return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'))
})
const visibleMatches = computed(() => filterMatchSchedule(matches.value, { date: selectedDate.value, teamId: selectedTeamId.value, status: selectedStatus.value }))
const competitionName = computed(() => competitions.value.find(item => item.id === competitionId.value)?.name || '公开赛事')
const dateLabel = (date: string) => {
  const value = new Date(`${date}T12:00:00+08:00`)
  return `${value.getUTCMonth() + 1}月${value.getUTCDate()}日`
}
const weekday = (date: string) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${date}T12:00:00+08:00`).getUTCDay()]
const teamLabel = (id: string | null, name?: string | null, source?: string | null) => {
  if (name) return name
  if (id) return '参赛球队'
  if (!source) return '待定'
  const previous = matches.value.find(match => match.id === source)
  return previous ? `${previous.groupId || matchStageLabels[previous.stage]} · 第${previous.slot || previous.round}场胜者` : '前序比赛胜者'
}
const explain = (value: unknown, fallback: string) => value instanceof Error ? value.message : fallback

async function loadMatches() {
  const request = ++matchRequest, id = competitionId.value
  if (!id) { matches.value = []; loadingMatches.value = false; return }
  loadingMatches.value = true; matchError.value = ''
  try {
    const all: MatchSchedule[] = [], seen = new Set<string>(), seenMatches = new Set<string>(); let cursor: string | undefined
    do {
      const page = await listPublicMatches(id, cursor ? { cursor } : {})
      if (request !== matchRequest || id !== competitionId.value) return
      if (page.matches.some(match => match.competitionId !== id || seenMatches.has(match.id)) || page.nextCursor && seen.has(page.nextCursor)) throw new Error('赛程分页返回异常，请重新加载。')
      page.matches.forEach(match => seenMatches.add(match.id))
      if (page.nextCursor) seen.add(page.nextCursor)
      all.push(...page.matches); cursor = page.nextCursor || undefined
    } while (cursor)
    matches.value = all
    if (!teams.value.some(team => team[0] === selectedTeamId.value)) selectedTeamId.value = ''
  } catch (value) {
    if (request === matchRequest) { matches.value = []; matchError.value = explain(value, '暂时无法获取真实赛程，请稍后重试。') }
  } finally { if (request === matchRequest) loadingMatches.value = false }
}
async function loadCompetitions() {
  const request = ++competitionRequest
  ++matchRequest
  loading.value = true; error.value = ''
  try {
    const all: PublicCompetition[] = [], seen = new Set<string>(); let cursor: string | undefined
    do {
      const page = await listPublicCompetitions(cursor)
      if (request !== competitionRequest) return
      if (page.nextCursor && seen.has(page.nextCursor)) throw new Error('赛事分页返回异常，请重新加载。')
      if (page.nextCursor) seen.add(page.nextCursor)
      all.push(...page.competitions); cursor = page.nextCursor || undefined
    } while (cursor)
    competitions.value = all
    if (!all.some(item => item.id === competitionId.value)) { competitionId.value = all[0]?.id || ''; reset() }
    await loadMatches()
  } catch (value) {
    if (request === competitionRequest) { competitions.value = []; matches.value = []; error.value = explain(value, '暂时无法获取公开赛事，请稍后重试。') }
  } finally { if (request === competitionRequest) { loading.value = false; loadingMatches.value = false } }
}
function chooseCompetition(event: { detail: { value: string | number } }) { competitionId.value = competitions.value[Number(event.detail.value)]?.id || ''; matches.value = []; reset(); void loadMatches() }
function chooseTeam(event: { detail: { value: string | number } }) { const index = Number(event.detail.value); selectedTeamId.value = index ? teams.value[index - 1]?.[0] || '' : '' }
function chooseDate(date: string) { selectedDate.value = date }
function today() { selectedDate.value = matchDate(new Date().toISOString()) }
function reset() { selectedTeamId.value = ''; selectedDate.value = ''; selectedStatus.value = '' }
function openMatch(id: string) { uni.navigateTo({ url: `/pages/match/detail?id=${id}` }) }
onMounted(() => { void loadCompetitions() })
onUnmounted(() => { ++competitionRequest; ++matchRequest })
</script>

<template>
  <view class="public-schedule">
    <view class="section-heading section-heading-box"><view><text class="section-title">真实赛程</text><text class="section-subtitle">来自已公开赛事的云端排赛，时间均为北京时间</text></view><button hover-class="none" role="button" tabindex="0" class="ui-button text-button" :disabled="loading || loadingMatches" @click="loadCompetitions">刷新赛程</button></view>
    <view v-if="loading" class="panel competition-empty"><text>正在读取公开赛事…</text></view>
    <view v-else-if="error" class="panel competition-empty" role="alert"><text>{{ error }}</text><button hover-class="none" role="button" tabindex="0" class="ui-button outline-button" @click="loadCompetitions">重新加载</button></view>
    <view v-else-if="!competitions.length" class="panel competition-empty"><text class="h3">暂无公开赛事</text><text class="muted">赛事公开后，真实赛程会显示在这里。</text></view>
    <template v-else>
      <view class="schedule-live-toolbar">
        <view class="schedule-filter-field schedule-filter-field-primary">
          <view class="schedule-filter-heading"><text class="schedule-filter-label">选择赛事</text><text class="schedule-filter-hint">查看公开赛事赛程</text></view>
          <picker class="schedule-picker-control" :disabled="loading || loadingMatches" :range="competitions.map(item => item.name)" :value="Math.max(0, competitions.findIndex(item => item.id === competitionId))" @change="chooseCompetition">
            <view class="schedule-picker"><text class="schedule-picker-value">{{ competitionName }}</text><view class="schedule-picker-icon"><AppIcon name="down" :size="14" /></view></view>
          </picker>
        </view>
        <view class="schedule-filter-field">
          <view class="schedule-filter-heading"><text class="schedule-filter-label">球队筛选</text><text class="schedule-filter-hint">按球队查看</text></view>
          <picker class="schedule-picker-control" :disabled="loadingMatches" :range="['全部球队', ...teams.map(item => item[1])]" :value="selectedTeamId ? Math.max(1, teams.findIndex(item => item[0] === selectedTeamId) + 1) : 0" @change="chooseTeam">
            <view class="schedule-picker"><text class="schedule-picker-value">{{ selectedTeamId ? teams.find(item => item[0] === selectedTeamId)?.[1] : '全部球队' }}</text><view class="schedule-picker-icon"><AppIcon name="down" :size="14" /></view></view>
          </picker>
        </view>
      </view>
      <view class="schedule-filters"><view class="filter-chips"><button hover-class="none" role="button" tabindex="0" class="ui-button filter-chip" :class="{ active: !selectedStatus }" @click="selectedStatus = ''">全部状态</button><button hover-class="none" role="button" tabindex="0" v-for="(label, status) in matchStatusLabels" :key="status" class="ui-button filter-chip" :class="{ active: selectedStatus === status }" @click="selectedStatus = status">{{ label }}</button></view><button hover-class="none" role="button" tabindex="0" class="ui-button text-button" @click="today">定位今天</button></view>
      <view v-if="loadingMatches" class="panel competition-empty"><text>正在读取真实赛程…</text></view>
      <view v-else-if="matchError" class="panel competition-empty" role="alert"><text>{{ matchError }}</text><button hover-class="none" role="button" tabindex="0" class="ui-button outline-button" @click="loadMatches">重新加载赛程</button></view>
      <template v-else>
        <scroll-view v-if="dates.length" scroll-x class="date-scroll" :scroll-into-view="selectedDate ? `schedule-date-${selectedDate}` : 'schedule-date-all'"><view class="date-strip"><button hover-class="none" role="button" tabindex="0" id="schedule-date-all" class="ui-button date-cell" :class="{ active: !selectedDate }" @click="chooseDate('')"><text>完整赛程</text><text class="date-number">全部日期</text><text class="date-indicator">{{ matches.length }} 场比赛</text></button><button hover-class="none" role="button" tabindex="0" v-for="date in dates" :id="`schedule-date-${date}`" :key="date" class="ui-button date-cell" :class="{ active: selectedDate === date }" @click="chooseDate(date)"><text>{{ weekday(date) }}</text><text class="date-number">{{ dateLabel(date) }}</text><text class="date-indicator">{{ matches.filter(match => matchDate(match.scheduledAt) === date).length }} 场比赛</text></button></view></scroll-view>
        <view class="schedule-day-heading"><text>{{ selectedDate ? `${dateLabel(selectedDate)} ${weekday(selectedDate)}` : '全部日期' }}</text><text class="muted small-text">{{ visibleMatches.length }} 场比赛</text></view>
        <view v-if="visibleMatches.length" class="public-schedule-list"><view v-for="match in visibleMatches" :key="match.id" class="panel public-schedule-card" role="button" tabindex="0" @click="openMatch(match.id)"><view class="public-schedule-card-top"><text class="status-badge neutral">{{ matchStageLabels[match.stage] }} · 第{{ match.round }}轮</text><text class="status-badge" :class="{ neutral: match.status === 'postponed' }">{{ matchStatusLabels[match.status] }}</text></view><view class="public-schedule-teams"><view><text>{{ match.homeQualification && !match.homeTeamId ? `${match.homeQualification.groupId} 第${match.homeQualification.rank}名 · 待定` : teamLabel(match.homeTeamId, match.homeTeamName, match.homeFrom) }}</text><text class="muted small-text">主队</text></view><strong>{{ ['live', 'finished'].includes(match.status) ? `${match.homeScore} : ${match.awayScore}` : 'VS' }}</strong><view><text>{{ match.awayQualification && !match.awayTeamId ? `${match.awayQualification.groupId} 第${match.awayQualification.rank}名 · 待定` : teamLabel(match.awayTeamId, match.awayTeamName, match.awayFrom) }}</text><text class="muted small-text">客队</text></view></view><view class="public-schedule-meta"><text>{{ matchTime(match.scheduledAt) }}</text><text>{{ match.venue }}</text><text v-if="match.status === 'live' && match.result?.minute != null">进行中 {{ match.result.minute }}′</text><text v-if="match.penalties">点球 {{ match.penalties[0] }} : {{ match.penalties[1] }}</text><text v-if="match.groupId">{{ match.groupId }}</text></view></view></view>
        <view v-else class="empty-state panel"><AppIcon name="calendar" tone="muted" :size="32" /><text class="h3">{{ matches.length ? '当前筛选下没有比赛' : '赛事尚未排赛' }}</text><text class="muted">{{ matches.length ? '可以切换日期、球队或状态查看其他赛程。' : '赛程发布后可在这里查看比赛安排。' }}</text><button hover-class="none" role="button" tabindex="0" v-if="matches.length" class="ui-button outline-button" @click="reset">清除筛选</button></view>
      </template>
    </template>
  </view>
</template>
