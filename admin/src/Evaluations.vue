<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import type { createAdminAuth } from './auth'
import type { AdminCompetition } from '../../src/domain/competition'
import type { MatchSchedule } from '../../src/domain/match'
import { evaluationBeijingTime, evaluationUtcTime, type EvaluationAdmin } from '../../src/domain/evaluation'
const props = defineProps<{ auth: ReturnType<typeof createAdminAuth> }>()
const competitions = ref<AdminCompetition[]>([]), matches = ref<MatchSchedule[]>([]), data = ref<EvaluationAdmin | null>(null)
const competitionId = ref(''), matchId = ref(''), busy = ref(false), error = ref(''), notice = ref(''), needsReload = ref(false), mvpId = ref(''), lineupIds = ref<string[]>([])
const positions = reactive<Record<string, string>>({})
const config = reactive({ enabled: false, commentsEnabled: false, scoreMin: 1, scoreMax: 10, openedAt: '', closedAt: '' })
const finishedMatches = computed(() => matches.value.filter(match => match.status === 'finished'))
const allComments = computed(() => data.value ? [...data.value.comments.map(comment => ({ ...comment, hidden: false })), ...data.value.hiddenComments] : [])
const makeId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('')
const explain = (value: unknown) => value instanceof Error ? value.message : '评分服务暂不可用，请重试。'
let generation = 0
async function pages<T>(read: (cursor?: string) => Promise<{ rows: T[]; nextCursor: string | null }>) {
  const rows: T[] = [], seen = new Set<string>(); let cursor: string | undefined
  do { const page = await read(cursor); rows.push(...page.rows); cursor = page.nextCursor || undefined; if (cursor && seen.has(cursor)) throw new Error('分页返回异常，请重新读取。'); if (cursor) seen.add(cursor) } while (cursor)
  return rows
}
function apply(value: EvaluationAdmin) {
  data.value = value
  Object.assign(config, { ...value.config, openedAt: evaluationBeijingTime(value.config.openedAt), closedAt: evaluationBeijingTime(value.config.closedAt) })
  mvpId.value = value.awards.find(award => award.type === 'mvp')?.playerId || ''
  lineupIds.value = value.awards.filter(award => award.type === 'lineup').sort((a, b) => a.rank - b.rank).map(award => award.playerId)
  Object.keys(positions).forEach(key => delete positions[key]); value.awards.forEach(award => { positions[award.playerId] = award.position || '' })
  needsReload.value = false
}
async function load(level: 'competitions' | 'matches' | 'current' = 'current') {
  const request = ++generation; busy.value = true; error.value = ''; data.value = null
  try {
    if (level === 'competitions') {
      const rows = await pages(async cursor => { const page = await props.auth.authorized((api, token) => api.competitions(token, cursor)); return { rows: page.competitions, nextCursor: page.nextCursor } })
      if (request !== generation) return
      competitions.value = rows; if (!rows.some(row => row.id === competitionId.value)) competitionId.value = rows[0]?.id || ''
    }
    if (level !== 'current') {
      matches.value = []
      if (!competitionId.value) { matchId.value = ''; return }
      const rows = await pages(async cursor => { const page = await props.auth.authorized((api, token) => api.matches(token, competitionId.value, cursor)); return { rows: page.matches, nextCursor: page.nextCursor } })
      if (request !== generation) return
      matches.value = rows; if (!finishedMatches.value.some(row => row.id === matchId.value)) matchId.value = finishedMatches.value[0]?.id || ''
    }
    if (!matchId.value) return
    const value = await props.auth.authorized((api, token) => api.evaluation(token, matchId.value))
    if (request === generation) apply(value)
  } catch (value) { if (request === generation) error.value = explain(value) }
  finally { if (request === generation) busy.value = false }
}
async function mutate(operation: () => Promise<unknown>, message: string) {
  if (!data.value || busy.value || needsReload.value) return
  const request = ++generation; busy.value = true; error.value = ''; notice.value = ''
  try {
    await operation()
    const value = await props.auth.authorized((api, token) => api.evaluation(token, matchId.value))
    if (request === generation) { apply(value); notice.value = message }
  } catch (value) { if (request === generation) { error.value = explain(value); needsReload.value = true } }
  finally { if (request === generation) busy.value = false }
}
function saveConfig() {
  let payload: { enabled: boolean; commentsEnabled: boolean; scoreMin: number; scoreMax: number; openedAt: string | null; closedAt: string | null }
  try { payload = { enabled: config.enabled, commentsEnabled: config.commentsEnabled, scoreMin: Number(config.scoreMin), scoreMax: Number(config.scoreMax), openedAt: evaluationUtcTime(config.openedAt), closedAt: evaluationUtcTime(config.closedAt) } } catch { error.value = '请选择有效的北京时间。'; return }
  if (!Number.isInteger(payload.scoreMin) || !Number.isInteger(payload.scoreMax) || payload.scoreMin < 1 || payload.scoreMax > 10 || payload.scoreMin >= payload.scoreMax || payload.openedAt && payload.closedAt && payload.openedAt >= payload.closedAt) { error.value = '请检查评分范围和起止时间。'; return }
  const version = data.value!.config.version
  void mutate(() => props.auth.authorized((api, token) => api.configureEvaluation(token, competitionId.value, version, makeId(), payload)), '本赛事评分窗口已保存。')
}
function publishAwards() {
  const awards = [...(mvpId.value ? [{ type: 'mvp' as const, playerId: mvpId.value, position: null, rank: 1 }] : []), ...lineupIds.value.map((playerId, index) => ({ type: 'lineup' as const, playerId, position: positions[playerId]?.trim() || null, rank: index + 1 }))]
  const version = data.value!.awardsVersion
  void mutate(() => props.auth.authorized((api, token) => api.publishEvaluationAwards(token, matchId.value, version, makeId(), awards)), '本场评选结果已发布。')
}
function moderate(id: string, hidden: boolean) {
  const version = data.value!.commentVersions[id]
  void mutate(() => props.auth.authorized((api, token) => api.moderateEvaluationComment(token, id, hidden, version)), hidden ? '评论已隐藏。' : '评论已审核并公开。')
}
onMounted(() => { void load('competitions') })
onUnmounted(() => { ++generation })
</script>
<template>
  <div class="evaluation-admin">
    <div class="workspace-heading"><div><span class="eyebrow">赛事互动</span><h1>球员评分与评选</h1><p class="muted">管理赛后评分、审核评论，并发布本场 MVP 与最佳阵容。</p></div><button class="secondary-button" :disabled="busy" @click="load('competitions')">重新读取评分</button></div>
    <p v-if="error" class="notice" role="alert">{{ error }}</p><p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <p v-if="needsReload" class="notice">请先点击“重新读取评分”核对最新结果，再继续操作。</p>
    <section class="account-card evaluation-admin-filters">
      <label>选择评分赛事<select v-model="competitionId" aria-label="选择评分赛事" :disabled="busy" @change="load('matches')"><option value="">请选择赛事</option><option v-for="item in competitions" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
      <label>选择已完赛比赛<select v-model="matchId" aria-label="选择已完赛比赛" :disabled="busy" @change="load()"><option value="">请选择比赛</option><option v-for="item in finishedMatches" :key="item.id" :value="item.id">{{ item.homeTeamName || '待定' }} vs {{ item.awayTeamName || '待定' }} · {{ item.scheduledAt.slice(0, 10) }}</option></select></label>
    </section>
    <template v-if="data">
      <form class="account-card" @submit.prevent="saveConfig"><fieldset :disabled="busy || needsReload"><div class="card-heading"><div><h2>本赛事统一评分窗口</h2><p class="muted">对本赛事所有已完赛比赛生效；时间均为北京时间。当前版本 {{ data.config.version }}。</p></div><button class="primary-button" type="submit">保存窗口</button></div>
        <div class="evaluation-config-grid"><label class="checkbox-line"><input v-model="config.enabled" type="checkbox" />开放评分</label><label class="checkbox-line"><input v-model="config.commentsEnabled" type="checkbox" />开放评论</label><label>最低分<input v-model.number="config.scoreMin" type="number" min="1" max="9" required /></label><label>最高分<input v-model.number="config.scoreMax" type="number" min="2" max="10" required /></label><label>开始时间（北京时间）<input v-model="config.openedAt" type="datetime-local" /></label><label>结束时间（北京时间）<input v-model="config.closedAt" type="datetime-local" /></label></div>
      </fieldset></form>
      <section class="account-card"><div class="card-heading"><div><h2>本场球员评分</h2><p class="muted">平均分按本场每个微信账号保留的最新评分计算。</p></div></div><div class="evaluation-admin-scores"><div v-for="player in data.players" :key="player.playerId"><span>{{ player.number }}号 {{ player.playerName }} · {{ player.teamName }}</span><strong>{{ player.ratingAverage === null ? '暂无评分' : player.ratingAverage.toFixed(2) + '分' }}</strong><small class="muted">{{ player.ratingCount }}人评分</small></div></div></section>
      <section class="account-card"><fieldset :disabled="busy || needsReload"><div class="card-heading"><div><h2>本场 MVP 与最佳阵容</h2><p class="muted">候选来自本场已通过报名的球队。发布仅影响本场比赛；清空后发布可撤下评选。</p></div><button class="primary-button" @click="publishAwards">发布评选结果</button></div>
        <label>本场 MVP<select v-model="mvpId" aria-label="本场 MVP"><option value="">暂不选择</option><option v-for="player in data.players" :key="player.playerId" :value="player.playerId">{{ player.playerName }} · {{ player.teamName }}</option></select></label>
        <div class="evaluation-lineup-list"><div v-for="player in data.players" :key="player.playerId"><label class="checkbox-line"><input v-model="lineupIds" type="checkbox" :value="player.playerId" />{{ player.playerName }} · {{ player.teamName }}</label><label v-if="lineupIds.includes(player.playerId)" class="evaluation-position">{{ player.playerName }}的位置（选填）<input v-model="positions[player.playerId]" maxlength="40" placeholder="例如：前锋" /></label></div></div>
      </fieldset></section>
      <section class="account-card"><div class="card-heading"><div><h2>评论审核</h2><p class="muted">新评论及修改后的评论需审核后展示；隐藏内容不对外公开。</p></div><span class="status-badge">{{ allComments.length }}条</span></div>
        <div v-if="allComments.length" class="evaluation-admin-comments"><div v-for="comment in allComments" :key="comment.id" class="evaluation-admin-comment" :data-comment-id="comment.id"><div><strong>{{ comment.playerName }}</strong><p>{{ comment.content }}</p><small class="muted">{{ comment.hidden ? '待展示 / 已隐藏' : '公开中' }} · {{ evaluationBeijingTime(comment.updatedAt).replace('T', ' ') }}</small></div><button class="secondary-button" :disabled="busy || needsReload" @click="moderate(comment.id, !comment.hidden)">{{ comment.hidden ? '审核并展示' : '隐藏评论' }}</button></div></div><div v-else class="empty-state">暂无评论</div>
      </section>
    </template><div v-else class="account-card empty-state">{{ busy ? '正在读取评分…' : '请选择一场已完赛比赛读取评分数据。' }}</div>
  </div>
</template>
