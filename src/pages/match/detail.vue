<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useTournament } from '@/composables/useTournament'
import { getPublicMatch } from '@/services/matches'
import { findTeam, participantLabel, stageNames, statusNames, dateLabel } from '@/domain/tournament'
import { matchTime, type MatchSchedule } from '@/domain/match'
import type { Match, MatchEvent, Player, Team, Tournament } from '@/domain/types'
import AppShell from '@/components/AppShell.vue'
import AppIcon from '@/components/AppIcon.vue'
import TeamBadge from '@/components/TeamBadge.vue'

const { data, matches, error, load } = useTournament()
const id = ref(''), tab = ref('overview'), realMatch = ref<MatchSchedule | null>(null), realError = ref('')
onLoad(query => { id.value = query?.id || ''; void loadRealMatch() })

async function loadRealMatch() {
  if (!id.value) return
  try { realMatch.value = await getPublicMatch(id.value); realError.value = '' }
  catch (value) { realMatch.value = null; realError.value = value instanceof Error ? value.message : '暂时无法读取真实比赛详情。' }
}
function realTeam(id: string, name: string | null | undefined): Team {
  return { id, name: name || '参赛球队', shortName: name || '球队', district: '', group: 'A', color: '#2c7a56', badge: '', founded: 0, description: '' }
}
const realEvents = computed<MatchEvent[]>(() => {
  const result = realMatch.value?.result
  if (!result || !realMatch.value) return []
  const events: MatchEvent[] = []
  result.goals.forEach((goal, index) => events.push({ id: `${realMatch.value!.id}-goal-${index}`, minute: goal.minute, kind: 'goal', teamId: goal.teamId, playerId: goal.scorer?.id, assistPlayerId: goal.assist?.id, label: goal.ownGoal ? '乌龙球' : undefined }))
  result.cards.forEach((card, index) => events.push({ id: `${realMatch.value!.id}-card-${index}`, minute: card.minute, kind: card.kind, teamId: card.teamId, playerId: card.player.id }))
  result.substitutions.forEach((change, index) => events.push({ id: `${realMatch.value!.id}-sub-${index}`, minute: change.minute, kind: 'substitution', teamId: change.teamId, playerId: change.playerIn.id, playerOutId: change.playerOut.id }))
  return events.sort((a, b) => a.minute - b.minute || a.id.localeCompare(b.id))
})
const realData = computed<Tournament | null>(() => {
  if (!data.value || !realMatch.value) return data.value
  const source = realMatch.value, teams = [...data.value.teams]
  for (const [teamId, teamName] of [[source.homeTeamId, source.homeTeamName], [source.awayTeamId, source.awayTeamName]] as const) if (teamId && !teams.some(team => team.id === teamId)) teams.push(realTeam(teamId, teamName))
  const players = [...data.value.players]
  const allPlayers = source.result ? source.result.goals.flatMap(goal => [goal.scorer, goal.assist]).concat(source.result.cards.map(card => card.player), source.result.substitutions.flatMap(change => [change.playerIn, change.playerOut])).filter(Boolean) : []
  for (const player of allPlayers) {
    const playerValue = player!
    const teamId = source.result?.goals.find(goal => goal.scorer?.id === playerValue.id || goal.assist?.id === playerValue.id)?.teamId || source.result?.cards.find(card => card.player.id === playerValue.id)?.teamId || source.result?.substitutions.find(change => change.playerIn.id === playerValue.id || change.playerOut.id === playerValue.id)?.teamId
    if (teamId && !players.some(item => item.id === playerValue.id)) players.push({ id: playerValue.id, teamId, name: playerValue.name, number: playerValue.number, position: '' })
  }
  return { ...data.value, teams, players }
})
const realPageMatch = computed<Match | null>(() => {
  const source = realMatch.value
  if (!source) return null
  const [date, time] = matchTime(source.scheduledAt).split(' ')
  return { id: source.id, stage: source.stage, date, time, venue: source.venue, status: source.status, homeId: source.homeTeamId, awayId: source.awayTeamId, homeFrom: source.homeFrom || undefined, awayFrom: source.awayFrom || undefined, homeScore: source.homeScore, awayScore: source.awayScore, minute: source.result?.minute ?? undefined, penalties: source.penalties || undefined, events: realEvents.value, stats: source.result?.stats || undefined }
})
const pageData = computed(() => realData.value)
const match = computed(() => realPageMatch.value || matches.value.find(item => item.id === id.value))
const isReal = computed(() => !!realMatch.value)
const statRows = computed(() => {
  const s = match.value?.stats
  return s ? [{ label: '控球率', values: s.possession, suffix: '%' }, { label: '射门', values: s.shots, suffix: '' }, { label: '射正', values: s.shotsOnTarget, suffix: '' }, { label: '角球', values: s.corners, suffix: '' }, ...(s.fouls ? [{ label: '犯规', values: s.fouls, suffix: '' }] : []), ...(s.offsides ? [{ label: '越位', values: s.offsides, suffix: '' }] : [])] : []
})
const eventLabels = { goal: '进球', yellow: '黄牌', red: '红牌', substitution: '换人' } as const
function playerName(playerId?: string) { return pageData.value?.players.find(player => player.id === playerId)?.name || '未记录球员' }
function eventTitle(event: MatchEvent) { return event.label || (event.kind === 'substitution' ? `${playerName(event.playerId)} 换入` : playerName(event.playerId)) }
function team(teamId: string | null) { if (teamId) uni.navigateTo({ url: `/pages/team/detail?id=${teamId}` }) }
function back() { uni.navigateBack({ fail: () => uni.reLaunch({ url: '/pages/index/index?tab=tournament' }) }) }
</script>

<template>
  <AppShell active="tournament" detail>
    <view v-if="pageData && match" class="inner-page match-detail-page">
      <button hover-class="none" role="button" tabindex="0" class="ui-button breadcrumb" @click="back"><AppIcon name="back" :size="15"/>返回赛事<text>/ 比赛详情</text></button>
      <view class="match-detail-hero">
        <view class="detail-match-top"><text>{{ pageData.name }} · {{ stageNames[match.stage] }}</text><view class="detail-status"><view v-if="match.status === 'live'" class="live-dot"/>{{ statusNames[match.status] }} {{ match.minute != null ? `${match.minute}′` : '' }}</view></view>
        <view class="detail-scoreboard">
          <button hover-class="none" role="button" tabindex="0" class="ui-button detail-team" @click="team(match.homeId)"><TeamBadge :team="findTeam(pageData, match.homeId)" :size="82"/><text>{{ participantLabel(match, 'home', pageData) }}</text><text class="team-detail-link">{{ match.homeId ? '球队主页 →' : '晋级结果待定' }}</text></button>
          <view class="detail-score"><text v-if="match.homeScore !== null">{{ match.homeScore }}<text class="detail-score-colon">:</text>{{ match.awayScore }}</text><text v-else class="detail-vs">VS</text><text class="detail-score-label">{{ match.status === 'live' ? '当前比分 · 进行中' : match.status === 'finished' ? `全场比分${isReal ? '' : ' · 演示数据'}` : '等待开场' }}</text><text v-if="match.penalties" class="detail-penalties">点球 {{ match.penalties[0] }} : {{ match.penalties[1] }}</text></view>
          <button hover-class="none" role="button" tabindex="0" class="ui-button detail-team" @click="team(match.awayId)"><TeamBadge :team="findTeam(pageData, match.awayId)" :size="82"/><text>{{ participantLabel(match, 'away', pageData) }}</text><text class="team-detail-link">{{ match.awayId ? '球队主页 →' : '晋级结果待定' }}</text></button>
        </view>
        <view class="detail-match-bottom"><view><AppIcon name="calendar" :size="15" tone="white"/>{{ dateLabel(match.date) }} {{ match.time }}</view><view><AppIcon name="pin" :size="15" tone="white"/>{{ match.venue }}</view></view>
      </view>
      <view class="page-tabs"><button hover-class="none" role="button" tabindex="0" class="ui-button" :class="{ active: tab === 'overview' }" @click="tab = 'overview'">比赛概况</button><button hover-class="none" role="button" tabindex="0" class="ui-button" :class="{ active: tab === 'stats' }" @click="tab = 'stats'">技术统计</button><button hover-class="none" role="button" tabindex="0" class="ui-button" :class="{ active: tab === 'events' }" @click="tab = 'events'">赛场事件</button></view>
      <view class="match-detail-grid">
        <view v-if="tab !== 'events'" class="panel detail-stat-panel"><view class="section-heading"><text class="h2">技术统计</text><text class="muted small-text">{{ isReal ? '官方赛果数据' : '演示统计' }}</text></view><view v-if="statRows.length" class="stat-bars"><view v-for="row in statRows" :key="row.label" class="stat-bar-row"><view><text>{{ row.values[0] }}{{ row.suffix }}</text><text class="muted">{{ row.label }}</text><text>{{ row.values[1] }}{{ row.suffix }}</text></view><view class="stat-track"><view :style="{ width: `${row.values[0] / (row.values[0] + row.values[1] || 1) * 100}%` }"/><view :style="{ width: `${row.values[1] / (row.values[0] + row.values[1] || 1) * 100}%` }"/></view></view></view><view v-else class="empty-state"><AppIcon name="clock" :size="35" tone="muted"/><text>比赛尚未开始</text><text class="muted small-text">开赛后，技术统计会出现在这里</text></view></view>
        <view v-if="tab !== 'stats'" class="panel timeline-panel"><view class="section-heading"><text class="h2">赛场时间轴</text><text class="muted small-text">{{ match.events.length }} 条事件</text></view><view v-if="match.events.length" class="event-timeline"><view v-for="event in match.events" :key="event.id" class="timeline-event"><text class="event-minute">{{ event.minute }}′</text><view class="event-marker"><AppIcon :name="event.kind === 'goal' ? 'ball' : 'flag'" :tone="event.kind === 'red' ? 'gold' : 'green'" :size="19"/></view><view class="event-copy"><text class="h3">{{ eventTitle(event) }}<text class="event-kind">{{ eventLabels[event.kind] }}</text></text><text class="muted small-text">{{ findTeam(pageData, event.teamId)?.name }}<text v-if="event.kind === 'goal' && event.assistPlayerId"> · {{ playerName(event.assistPlayerId) }} 助攻</text><text v-if="event.kind === 'substitution' && event.playerOutId"> · {{ playerName(event.playerOutId) }} 换下</text></text></view></view></view><view v-else class="empty-state"><AppIcon name="ball" :size="35" tone="muted"/><text>精彩，等待开场</text><text class="muted small-text">暂无已记录的比赛事件</text></view></view>
      </view>
      <view class="inline-note"><AppIcon name="info" tone="muted" :size="16"/><text>{{ isReal ? '本场详情来自公开赛事的真实赛果，赛程、榜单与事件使用同一份云端记录。' : '本场比赛为虚构演示。比分、事件与球队数据来自同一份本地资料，不提供实时直播或实际场地导航。' }}</text></view>
    </view>
    <view v-else-if="error && !realError" class="empty-state"><text>{{ error }}</text><button hover-class="none" role="button" tabindex="0" class="ui-button primary-button" @click="load">重新加载</button></view>
    <view v-else-if="pageData" class="empty-state"><text class="h2">没有找到这场比赛</text><button hover-class="none" role="button" tabindex="0" class="ui-button primary-button" @click="back">返回赛事</button></view>
    <view v-else class="loading-state">正在加载比赛…</view>
  </AppShell>
</template>
