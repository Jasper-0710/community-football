<script setup lang="ts">
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { listPublicCompetitions } from '@/services/competitions'
import { getPublicStandings } from '@/services/standings'
import { matchStageLabels, matchStatusLabels, matchTime, type MatchSchedule } from '@/domain/match'
import type { StandingsSnapshot } from '@/domain/standings'
import type { PublicCompetition } from '@/domain/competition'
import AppIcon from './AppIcon.vue'
const props = defineProps<{ compact?: boolean; advancementOnly?: boolean }>()
const competitions = ref<PublicCompetition[]>([]), competitionId = ref('')
const snapshot = ref<StandingsSnapshot | null>(null)
const loading = ref(false), error = ref('')
const active = ref(props.advancementOnly ? 'advancement' : 'standings')
const groupId = ref('')
let request = 0
const tabs = [{ id: 'standings', label: '积分榜' }, { id: 'goals', label: '射手榜' }, { id: 'assists', label: '助攻榜' }, { id: 'advancement', label: '晋级对阵' }]
const title = computed(() => props.advancementOnly ? '晋级对阵' : props.compact ? '赛事积分榜' : '赛事榜单')
const groups = computed(() => props.compact ? snapshot.value?.groups.filter(g => g.id === groupId.value) || [] : snapshot.value?.groups || [])
const ranks = computed(() => active.value === 'assists' ? snapshot.value?.assists || [] : snapshot.value?.goals || [])
const stages = computed(() => (['quarter', 'semi', 'final'] as const).map(stage => ({ stage, label: matchStageLabels[stage], matches: snapshot.value?.matches.filter(match => match.stage === stage).sort((a, b) => (a.slot || a.round) - (b.slot || b.round) || a.scheduledAt.localeCompare(b.scheduledAt)) || [] })).filter(item => item.matches.length))
const champion = computed(() => {
  const id = snapshot.value?.championTeamId
  const match = snapshot.value?.matches.find(m => m.stage === 'final')
  return id && match ? id === match.homeTeamId ? match.homeTeamName : match.awayTeamName : null
})
function source(match: MatchSchedule, side: 'home' | 'away') {
  const q = match[`${side}Qualification`], from = match[`${side}From`]
  if (q) return `${q.groupId} 第${q.rank}名`
  const previous = snapshot.value?.matches.find(m => m.id === from)
  return previous ? `${matchStageLabels[previous.stage]} 第${previous.slot || previous.round}场胜者` : from ? '前序比赛胜者' : ''
}
async function load(refresh = true) {
  const serial = ++request
  loading.value = true; error.value = ''; snapshot.value = null
  try {
    if (refresh || !competitions.value.length) {
      const all: PublicCompetition[] = [], seen = new Set<string>(); let cursor: string | undefined
      do {
        const page = await listPublicCompetitions(cursor)
        if (serial !== request) return
        if (page.nextCursor && seen.has(page.nextCursor) || page.competitions.some(c => all.some(item => item.id === c.id))) throw new Error('赛事分页异常，请重新加载。')
        if (page.nextCursor) seen.add(page.nextCursor)
        all.push(...page.competitions); cursor = page.nextCursor || undefined
      } while (cursor)
      competitions.value = all
      if (!all.some(c => c.id === competitionId.value)) competitionId.value = all[0]?.id || ''
    }
    if (!competitionId.value) return
    const id = competitionId.value, result = await getPublicStandings(id)
    if (serial !== request) return
    if (result.competitionId !== id) throw new Error('榜单赛事不匹配，请重新加载。')
    snapshot.value = result
    if (!result.groups.some(g => g.id === groupId.value)) groupId.value = result.groups[0]?.id || ''
  } catch (e) { if (serial === request) { snapshot.value = null; error.value = e instanceof Error ? e.message : '暂时无法读取榜单，请稍后重试。' } }
  finally { if (serial === request) loading.value = false }
}
function chooseCompetition(event: { detail: { value: string | number } }) { competitionId.value = competitions.value[Number(event.detail.value)]?.id || ''; groupId.value = ''; void load(false) }
onMounted(() => { void load() })
onUnmounted(() => { ++request })
</script>

<template>
  <view class="public-standings" :class="{ 'standings-compact': compact }">
    <view class="section-heading section-heading-box"><view><text class="section-title">{{ title }}</text><text class="section-subtitle">仅统计正式录入的已完赛结果</text></view><button hover-class="none" role="button" tabindex="0" class="ui-button text-button" :disabled="loading" @click="load()">刷新榜单</button></view>
    <view v-if="competitions.length" class="ranking-competition panel"><text class="schedule-filter-label">选择赛事</text><picker class="ranking-competition-picker" :disabled="loading" :range="competitions.map(c => c.name)" :value="Math.max(0, competitions.findIndex(c => c.id === competitionId))" @change="chooseCompetition"><view class="schedule-picker"><text>{{ competitions.find(c => c.id === competitionId)?.name }}</text><AppIcon name="down" :size="16" /></view></picker></view>
    <view v-if="loading" class="panel competition-empty"><text>正在读取榜单与晋级对阵…</text></view>
    <view v-else-if="error" class="panel competition-empty" role="alert"><text>{{ error }}</text><button hover-class="none" role="button" tabindex="0" class="ui-button outline-button" @click="load()">重新加载榜单</button></view>
    <view v-else-if="!competitions.length" class="panel competition-empty"><text class="h3">暂无公开赛事</text><text class="muted">赛事公开后可在这里查看榜单。</text></view>
    <template v-else-if="snapshot">
      <view v-if="!compact && !advancementOnly" class="page-tabs stats-tabs"><button hover-class="none" role="button" tabindex="0" v-for="tab in tabs" :key="tab.id" class="ui-button" :class="{ active: active === tab.id }" @click="active = tab.id">{{ tab.label }}</button></view>
      <template v-if="active === 'standings'">
        <view v-if="!snapshot.configured" class="panel competition-empty"><text class="h3">积分规则尚未设置</text><text class="muted">运营设置参赛分组后，积分榜将在这里显示。</text></view>
        <view v-if="compact && snapshot.groups.length > 1" class="filter-chips"><button hover-class="none" role="button" tabindex="0" v-for="group in snapshot.groups" :key="group.id" class="ui-button filter-chip" :class="{ active: groupId === group.id }" @click="groupId = group.id">{{ group.id }}</button></view>
        <view v-for="group in groups" :key="group.id" class="panel live-standing-group">
          <view class="section-heading"><text class="h2">{{ group.id }}</text><text class="status-badge" :class="{ neutral: !group.complete }">{{ group.complete ? '本组已完赛' : `已完赛 ${group.finishedMatches}/${group.expectedMatches}` }}</text></view>
          <text class="muted small-text standing-scroll-hint">左右滑动查看全部数据</text>
          <scroll-view scroll-x class="live-table-scroll"><view class="live-standing-table"><view class="live-standing-row live-table-head"><text>排名</text><text>球队</text><text>赛</text><text>胜</text><text>平</text><text>负</text><text>进/失</text><text>净胜</text><text>积分</text></view><view v-for="row in group.rows" :key="row.teamId" class="live-standing-row"><text class="ranking-index">{{ row.rank }}</text><text class="live-standing-name">{{ row.teamName }}</text><text>{{ row.played }}</text><text>{{ row.won }}</text><text>{{ row.drawn }}</text><text>{{ row.lost }}</text><text>{{ row.goalsFor }}/{{ row.goalsAgainst }}</text><text>{{ row.difference > 0 ? '+' : '' }}{{ row.difference }}</text><text class="ranking-value">{{ row.points }}</text></view></view></scroll-view>
        </view>
        <view class="inline-note"><AppIcon name="info" :size="16" tone="muted" /><text>胜 {{ snapshot.rules.winPoints }} 分，平 {{ snapshot.rules.drawPoints }} 分，负 {{ snapshot.rules.lossPoints }} 分。依次比较积分、净胜球、进球数；仍相同则并列。晋级需该组完整赛程结束且名次唯一。</text></view>
      </template>
      <template v-else-if="active === 'goals' || active === 'assists'">
        <view v-if="!ranks.length" class="panel competition-empty"><text class="h3">暂无{{ active === 'goals' ? '进球' : '助攻' }}记录</text><text class="muted">完赛并录入比赛事件后自动统计。</text></view>
        <view v-else class="panel live-player-ranking"><view class="live-player-row live-table-head"><text>排名</text><text>球员 / 球队</text><text>{{ active === 'goals' ? '进球' : '助攻' }}</text></view><view v-for="row in ranks" :key="`${row.teamId}:${row.playerId}`" class="live-player-row"><text class="ranking-index" :class="{ 'top-rank': row.rank <= 3 }">{{ row.rank }}</text><view><text class="h3">{{ row.playerName }}</text><text class="muted small-text">{{ row.teamName }} · {{ row.number }}号</text></view><text class="ranking-value">{{ row.value }}</text></view></view>
        <view class="inline-note"><AppIcon name="info" :size="16" tone="muted" /><text>统计本赛事所有已完赛阶段的有效进球事件，数量相同则并列。乌龙球及点球大战不计个人进球与助攻；比赛内点球进球照常计入。</text></view>
      </template>
      <template v-else>
        <view v-if="champion" class="panel live-champion"><AppIcon name="trophy" tone="gold" :size="34" /><view><text class="muted small-text">本届冠军</text><text class="h2">{{ champion }}</text></view></view>
        <view v-if="!stages.length" class="panel competition-empty"><text class="h3">尚无淘汰赛对阵</text><text class="muted">循环赛可查看积分榜；淘汰赛排赛后在这里显示。</text></view>
        <view class="live-bracket"><view v-for="stage in stages" :key="stage.stage" class="live-bracket-stage"><view class="section-heading"><text class="h2">{{ stage.label }}</text><text class="muted small-text">{{ stage.matches.length }} 场</text></view><view v-for="match in stage.matches" :key="match.id" class="panel live-bracket-match"><view class="public-schedule-card-top"><text class="muted small-text">第{{ match.slot || match.round }}场</text><text class="status-badge">{{ matchStatusLabels[match.status] }}</text></view><view class="live-bracket-side"><view><text>{{ match.homeTeamName || '待定' }}</text><text v-if="source(match, 'home')" class="muted small-text">{{ source(match, 'home') }}{{ !match.homeTeamId ? ' · 等待确定' : '' }}</text></view><text class="ranking-value">{{ match.homeScore ?? '—' }}</text></view><view class="live-bracket-side"><view><text>{{ match.awayTeamName || '待定' }}</text><text v-if="source(match, 'away')" class="muted small-text">{{ source(match, 'away') }}{{ !match.awayTeamId ? ' · 等待确定' : '' }}</text></view><text class="ranking-value">{{ match.awayScore ?? '—' }}</text></view><text v-if="match.penalties" class="small-text">点球 {{ match.penalties[0] }} : {{ match.penalties[1] }}</text><text class="muted small-text">{{ matchTime(match.scheduledAt) }} · {{ match.venue }}</text></view></view></view>
        <view class="inline-note"><AppIcon name="info" :size="16" tone="muted" /><text>对阵由分组名次或前序比赛胜者自动确定；小组未完赛或名次并列时保留待定。</text></view>
      </template>
    </template>
  </view>
</template>
