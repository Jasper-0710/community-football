<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { getPublicEvaluation, submitPlayerComment, submitPlayerRating } from '@/services/evaluations'
import { evaluationRequestId, type EvaluationPublic } from '@/domain/evaluation'
import { useUserProfile } from '@/composables/useUserProfile'
import AppIcon from '@/components/AppIcon.vue'
import {publicRecovery,useRecoveryRefresh} from '@/services/public-data'
useRecoveryRefresh(()=>load())
const props = defineProps<{ matchId: string; matchStatus: string }>()
const account = useUserProfile()
const data = ref<EvaluationPublic | null>(null), loading = ref(false), error = ref(''), notice = ref(''), selected = ref(''), score = ref(0), comment = ref(''), saving = ref(false), needsReload = ref(false)
let generation = 0, saveGeneration = 0
const selectedPlayer = computed(() => data.value?.players.find(player => player.playerId === selected.value) || null)
const mvpAwards = computed(() => data.value?.awards.filter(award => award.type === 'mvp') || [])
const lineupAwards = computed(() => data.value?.awards.filter(award => award.type === 'lineup').sort((a, b) => a.rank - b.rank) || [])
const comments = computed(() => data.value?.comments.filter(item => item.playerId === selected.value) || [])
const canSubmit = computed(() => !publicRecovery.readOnly.value && !!account.profile.value && account.supported && props.matchStatus === 'finished' && !saving.value && !loading.value && !needsReload.value)
async function load() {
  const request = ++generation, matchId = props.matchId
  if (!matchId) { data.value = null; loading.value = false; return }
  loading.value = true; error.value = ''
  try {
    const value = await getPublicEvaluation(matchId)
    if (request !== generation) return
    data.value = value
    if (!value.players.some(player => player.playerId === selected.value)) selected.value = value.players[0]?.playerId || ''
    score.value = value.players.find(player => player.playerId === selected.value)?.viewerScore || 0
    needsReload.value = false
  } catch (value) {
    if (request !== generation) return
    data.value = null; error.value = value instanceof Error ? value.message : '暂时无法读取评分。'
  } finally { if (request === generation) loading.value = false }
}
function choosePlayer(playerId: string) { if (saving.value) return; selected.value = playerId; score.value = selectedPlayer.value?.viewerScore || 0; comment.value = ''; notice.value = '' }
async function save(kind: 'rating' | 'comment') {
  if (!canSubmit.value || !selectedPlayer.value || !data.value) return
  if (kind === 'rating' && (!data.value.canRate || !Number.isInteger(score.value) || score.value < data.value.config.scoreMin || score.value > data.value.config.scoreMax)) return
  if (kind === 'comment' && (!data.value.canComment || !comment.value.trim())) return
  const request = generation, saveRequest = ++saveGeneration, matchId = props.matchId, playerId = selected.value
  saving.value = true; error.value = ''; notice.value = ''
  try {
    if (kind === 'rating') await submitPlayerRating(matchId, playerId, score.value, evaluationRequestId())
    else await submitPlayerComment(matchId, playerId, comment.value, evaluationRequestId())
    if (request !== generation) return
    if (kind === 'comment') comment.value = ''
    await load()
    if (saveRequest !== saveGeneration) return
    notice.value = kind === 'rating' ? '评分已保存。' : '评论已提交，审核后展示。'
  } catch (value) { if (request === generation) { error.value = value instanceof Error ? value.message : '评价提交失败。'; needsReload.value = true } }
  finally { if (saveRequest === saveGeneration) saving.value = false }
}
watch([() => props.matchId, () => props.matchStatus, () => account.profile.value?.id], () => { ++generation; ++saveGeneration; saving.value = false; data.value = null; selected.value = ''; score.value = 0; comment.value = ''; notice.value = ''; needsReload.value = false; void load() }, { immediate: true })
onUnmounted(() => { ++generation; ++saveGeneration })
</script>
<template>
  <view class="panel evaluation-panel">
    <view class="section-heading"><view><text class="h2">评分与评论</text><text class="muted small-text">{{ data?.canRate ? `评分范围 ${data.config.scoreMin}–${data.config.scoreMax} 分` : data?.closedReason || '正在读取评分窗口' }}</text></view><button hover-class="none" role="button" tabindex="0" class="ui-button text-button" :disabled="loading || saving" @click="load">{{ loading ? '读取中…' : '刷新评分' }}</button></view>
    <text v-if="error" class="account-error" role="alert">{{ error }}</text><text v-if="notice" class="account-success" role="status">{{ notice }}</text>
    <text v-if="needsReload" class="muted small-text">请先刷新评分确认保存结果，再继续操作。</text>
    <view v-if="data && data.awards.length" class="evaluation-awards">
      <view v-if="mvpAwards.length" class="evaluation-award-group"><text class="evaluation-award-title">本场 MVP</text><view v-for="award in mvpAwards" :key="award.playerId" class="evaluation-award"><text class="evaluation-award-rank">MVP</text><view><text class="h3">{{ award.playerName }}</text><text class="muted small-text">{{ award.teamName }} · {{ award.number }}号</text></view></view></view>
      <view v-if="lineupAwards.length" class="evaluation-award-group"><text class="evaluation-award-title">本场最佳阵容</text><view v-for="award in lineupAwards" :key="award.playerId" class="evaluation-award"><text class="evaluation-award-rank">{{ award.rank }}</text><view><text class="h3">{{ award.playerName }}</text><text class="muted small-text">{{ award.position || '入选' }} · {{ award.teamName }} · {{ award.number }}号</text></view></view></view>
    </view>
    <view v-if="data && data.players.length" class="evaluation-layout">
      <view class="evaluation-players"><button hover-class="none" role="button" tabindex="0" v-for="player in data.players" :key="player.playerId" class="ui-button evaluation-player" :class="{ selected: selected === player.playerId }" :aria-pressed="selected === player.playerId" :disabled="saving" @click="choosePlayer(player.playerId)"><view class="evaluation-player-main"><text class="jersey-number">{{ player.number }}</text><view><text class="h3">{{ player.playerName }}</text><text class="muted small-text">{{ player.teamName }}</text></view></view><view class="evaluation-player-score"><text>{{ player.ratingAverage === null ? '—' : player.ratingAverage.toFixed(2) }}</text><text class="muted small-text">{{ player.ratingCount }}人评分</text></view></button></view>
      <view v-if="selectedPlayer" class="evaluation-editor"><text class="h3">评价 {{ selectedPlayer.playerName }}</text><text class="muted small-text">每个微信账号对本场每名球员保留一份评分，可在开放时段修改。</text>
        <text v-if="!account.supported" class="muted small-text">请在微信小程序中登录后评分或评论。</text>
        <view v-else-if="!account.profile.value"><button hover-class="none" role="button" tabindex="0" class="ui-button outline-button" :disabled="account.busy.value" @click="account.login">{{ account.loading.value ? '登录中…' : '微信登录后评价' }}</button><text v-if="account.error.value" class="account-error">{{ account.error.value }}</text></view>
        <template v-if="account.supported && account.profile.value && data.canRate"><view class="evaluation-score-picker"><button hover-class="none" role="button" tabindex="0" v-for="n in (data.config.scoreMax - data.config.scoreMin + 1)" :key="n" class="ui-button score-button" :class="{ active: score === data.config.scoreMin + n - 1 }" :aria-pressed="score === data.config.scoreMin + n - 1" :disabled="!canSubmit" @click="score = data.config.scoreMin + n - 1">{{ data.config.scoreMin + n - 1 }}</button></view><button hover-class="none" role="button" tabindex="0" class="ui-button primary-button" :disabled="!canSubmit || !score" @click="save('rating')">{{ saving ? '保存中…' : '保存评分' }}</button>
          <template v-if="data.canComment"><textarea v-model="comment" class="evaluation-comment-input" maxlength="300" :disabled="!canSubmit" placeholder="写下鼓励或建议，审核后展示（最多300字）" /><button hover-class="none" role="button" tabindex="0" class="ui-button outline-button" :disabled="!canSubmit || !comment.trim()" @click="save('comment')">发表评论</button></template>
        </template>
        <view v-if="comments.length" class="evaluation-comments"><text class="h3">公开评论</text><view v-for="item in comments" :key="item.id" class="evaluation-comment"><text>{{ item.content }}</text><text class="muted small-text">{{ item.updatedAt.slice(0, 10) }}</text></view></view>
      </view>
    </view><view v-else-if="!loading && !error" class="empty-state"><AppIcon name="star" tone="muted" :size="30"/><text>暂无可评价球员</text></view>
  </view>
</template>
