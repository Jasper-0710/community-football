<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { matchStageLabels, matchStatusLabels, matchTime, type MatchSchedule, type MatchScheduleForm, type MatchStage, type MatchScheduleStatus } from '../../src/domain/match'
import type { AdminCompetition } from '../../src/domain/competition'
import type { TeamSummary } from '../../src/domain/team'
import type { RegistrationSummary } from '../../src/domain/registration'
import type { createAdminAuth } from './auth'

const props = defineProps<{ auth: ReturnType<typeof createAdminAuth> }>()
const competitions = ref<AdminCompetition[]>([])
const teams = ref<TeamSummary[]>([])
const approvedTeamIds = ref<string[]>([])
const sourceMatches = ref<MatchSchedule[]>([])
const competitionId = ref('')
const records = ref<MatchSchedule[]>([])
const cursor = ref<string | null>(null)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const formOpen = ref(false)
const editing = ref<MatchSchedule | null>(null)
const requestId = ref('')
const stages = Object.entries(matchStageLabels) as [MatchStage, string][]
const statuses: [MatchScheduleStatus, string][] = [['scheduled', '已排赛'], ['postponed', '已延期']]
const activeTeams = computed(() => teams.value.filter(team => team.status === 'active' && approvedTeamIds.value.includes(team.id)))
const sourceOptions = computed(() => sourceMatches.value.filter(match => match.id !== editing.value?.id && stages.findIndex(([stage]) => stage === match.stage) < stages.findIndex(([stage]) => stage === form.stage)))
const teamName = (id: string | null) => id ? teams.value.find(team => team.id === id)?.name || `球队 ${id.slice(-8)}` : '待定'
const opponentName = (id: string | null, source: string | null) => id ? teamName(id) : source ? '前序比赛胜者' : '待定'
const explain = (e: unknown) => e instanceof Error ? e.message : '赛程服务暂不可用，请重试。'
const empty = () => ({ stage: 'group' as MatchStage, roundText: '1', groupId: '', slotText: '', homeTeamId: '', awayTeamId: '', homeFrom: '', awayFrom: '', scheduledAt: '', venue: '', status: 'scheduled' as MatchScheduleStatus })
const form = reactive(empty())

function makeRequestId() {
  requestId.value = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('')
}
function inputTime(value: string) {
  return new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16)
}
function isoTime(value: string) {
  return value ? new Date(value + ':00+08:00').toISOString() : ''
}
async function prepareSources() {
  busy.value = true; error.value = ''
  try {
    const all: MatchSchedule[] = [], seen = new Set<string>(); let next: string | undefined
    do {
      const page = await props.auth.authorized((api, token) => api.matches(token, competitionId.value, next))
      if (page.nextCursor && seen.has(page.nextCursor)) throw new Error('赛程分页返回异常，请刷新后重试。')
      if (page.nextCursor) seen.add(page.nextCursor)
      all.push(...page.matches); next = page.nextCursor || undefined
    } while (next)
    sourceMatches.value = all
    return true
  } catch (e) { error.value = explain(e); return false } finally { busy.value = false }
}
async function newForm() {
  if (busy.value) return
  if (!competitionId.value) { error.value = '请先选择赛事。'; return }
  if (!await prepareSources()) return
  makeRequestId(); editing.value = null; Object.assign(form, empty()); formOpen.value = true; error.value = ''; notice.value = ''
}
async function edit(record: MatchSchedule) {
  if (['live', 'finished'].includes(record.status) || record.result) { error.value = '比赛进行中或已有赛果，请在“榜单与晋级”撤销赛果后再编辑赛程。'; return }
  if (busy.value || !await prepareSources()) return
  editing.value = record
  Object.assign(form, { stage: record.stage, roundText: String(record.round), groupId: record.groupId || '', slotText: record.slot == null ? '' : String(record.slot), homeTeamId: record.homeTeamId || '', awayTeamId: record.awayTeamId || '', homeFrom: record.homeFrom || '', awayFrom: record.awayFrom || '', scheduledAt: inputTime(record.scheduledAt), venue: record.venue, status: record.status })
  formOpen.value = true; error.value = ''; notice.value = ''
}
function sourceLabel(match: MatchSchedule) { return `${matchStageLabels[match.stage]}${match.slot ? ` · 第${match.slot}场` : ` · 第${match.round}轮`} · ${teamName(match.homeTeamId)} vs ${teamName(match.awayTeamId)} · ${matchTime(match.scheduledAt)}` }
function chooseStage() {
  const available = new Set(sourceOptions.value.map(match => match.id))
  if (!available.has(form.homeFrom)) form.homeFrom = ''
  if (!available.has(form.awayFrom)) form.awayFrom = ''
}
function payload(): MatchScheduleForm {
  return { competitionId: competitionId.value, stage: form.stage, round: Number(form.roundText), groupId: form.groupId.trim() || null, slot: form.slotText.trim() ? Number(form.slotText) : null, homeTeamId: form.homeTeamId || null, awayTeamId: form.awayTeamId || null, homeFrom: form.homeFrom.trim() || null, awayFrom: form.awayFrom.trim() || null, scheduledAt: isoTime(form.scheduledAt), venue: form.venue, status: form.status }
}
async function loadCompetitions() {
  const all: AdminCompetition[] = []; let next: string | undefined
  do { const page = await props.auth.authorized((api, token) => api.competitions(token, next)); all.push(...page.competitions); next = page.nextCursor || undefined } while (next)
  competitions.value = all
  if (!competitionId.value || !all.some(item => item.id === competitionId.value)) competitionId.value = all[0]?.id || ''
}
async function loadTeams() {
  const all: TeamSummary[] = []; let next: string | undefined
  do { const page = await props.auth.authorized((api, token) => api.teams(token, next)); all.push(...page.teams); next = page.nextCursor || undefined } while (next)
  teams.value = all
}
async function loadEntrants() {
  const ids: string[] = []; let next: string | undefined
  do { const page = await props.auth.authorized((api, token) => api.registrations(token, competitionId.value, 'approved', next)); ids.push(...page.registrations.map((item: RegistrationSummary) => item.teamId)); next = page.nextCursor || undefined } while (next)
  approvedTeamIds.value = ids
}
async function load(more = false) {
  if (busy.value || !competitionId.value) return
  busy.value = true; error.value = ''; if (!more) { records.value = []; cursor.value = null }
  try {
    const [page] = await Promise.all([props.auth.authorized((api, token) => api.matches(token, competitionId.value, more ? cursor.value || undefined : undefined)), loadEntrants()])
    records.value = more ? [...new Map([...records.value, ...page.matches].map(record => [record.id, record])).values()] : page.matches; cursor.value = page.nextCursor
  } catch (e) { error.value = explain(e); if (!more) { records.value = []; cursor.value = null } } finally { busy.value = false }
}
function changeCompetition() { formOpen.value = false; editing.value = null; sourceMatches.value = []; approvedTeamIds.value = []; notice.value = ''; void load() }
async function refresh() {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await Promise.all([loadCompetitions(), loadTeams()]) } catch (e) { error.value = explain(e) } finally { busy.value = false }
  if (!error.value) await load()
}
async function save() {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const result = editing.value
      ? await props.auth.authorized((api, token) => api.updateMatch(token, editing.value!.id, editing.value!.version!, payload()))
      : await props.auth.authorized((api, token) => api.createMatch(token, requestId.value, payload()))
    formOpen.value = false; notice.value = editing.value ? '赛程已保存。' : '比赛已排入赛程。'
    records.value = editing.value ? records.value.map(item => item.id === result.id ? result : item) : [result, ...records.value]
  } catch (e) { error.value = explain(e) } finally { busy.value = false }
}
onMounted(() => { void refresh() })
</script>

<template>
  <section class="matches-admin">
    <div class="workspace-heading"><div><span class="eyebrow">赛事运营</span><h1>赛程与对阵</h1><p class="muted">安排赛事轮次、对阵、开赛时间与场地。</p></div><div class="competition-actions"><button class="secondary-button" :disabled="busy" @click="refresh">刷新赛程</button><button class="primary-button" :disabled="busy || !competitionId" @click="newForm">新增比赛</button></div></div>
    <div class="section-guide"><strong>排赛流程</strong><p>选择赛事 → 填写轮次、双方、时间与场地 → 保存后同步小程序已公开赛事的赛程。淘汰赛待定方可选择前序比赛胜者。</p></div>
    <p v-if="error" class="notice" role="alert">{{ error }}</p><p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <div v-if="competitions.length" class="account-card registration-filters"><div><label for="match-competition">选择赛事</label><select id="match-competition" v-model="competitionId" :disabled="busy" @change="changeCompetition"><option v-for="item in competitions" :key="item.id" :value="item.id">{{ item.name }}</option></select></div><p class="muted">{{ records.length }} 场已加载 · {{ activeTeams.length }} 支已审核参赛球队</p></div>
    <div v-if="formOpen" class="competition-form account-card"><div class="card-heading"><div><h2>{{ editing ? '编辑比赛' : '新增比赛' }}</h2><p class="muted">时间按北京时间填写，保存后以服务器时间记录。</p></div><button class="secondary-button" type="button" :disabled="busy" @click="formOpen = false">取消</button></div>
      <fieldset :disabled="busy"><section class="form-section"><div class="form-section-heading"><span class="step-number">01</span><div><h3>轮次与签位</h3><p>小组赛填写分组；淘汰赛可用来源比赛表达待定对阵。</p></div></div><div class="form-grid"><div><label for="match-stage">比赛阶段 *</label><select id="match-stage" v-model="form.stage" @change="chooseStage"><option v-for="[value, label] in stages" :key="value" :value="value">{{ label }}</option></select></div><div><label for="match-round">轮次 *</label><input id="match-round" v-model="form.roundText" type="number" min="1" max="128" step="1" required /></div><div><label for="match-group">分组</label><input id="match-group" v-model="form.groupId" maxlength="40" placeholder="例如 A 组" /></div><div><label for="match-slot">签位</label><input id="match-slot" v-model="form.slotText" type="number" min="1" max="128" step="1" placeholder="可留空" /></div></div></section>
        <section class="form-section"><div class="form-section-heading"><span class="step-number">02</span><div><h3>比赛双方</h3><p>仅可选择本赛事报名已通过的有效球队；淘汰赛也可选择前序比赛的胜者。</p></div></div><div class="form-grid"><div><label for="match-home">主队</label><select id="match-home" v-model="form.homeTeamId" @change="form.homeFrom = ''"><option value="">待定</option><option v-for="team in activeTeams" :key="team.id" :value="team.id">{{ team.name }}（{{ team.district }}）</option></select></div><div><label for="match-away">客队</label><select id="match-away" v-model="form.awayTeamId" @change="form.awayFrom = ''"><option value="">待定</option><option v-for="team in activeTeams" :key="team.id" :value="team.id">{{ team.name }}（{{ team.district }}）</option></select></div><div><label for="match-home-from">主队晋级来源</label><select id="match-home-from" v-model="form.homeFrom" :disabled="form.stage === 'group'" @change="form.homeTeamId = ''"><option value="">待定</option><option v-for="match in sourceOptions" :key="match.id" :value="match.id">{{ sourceLabel(match) }} 胜者</option></select></div><div><label for="match-away-from">客队晋级来源</label><select id="match-away-from" v-model="form.awayFrom" :disabled="form.stage === 'group'" @change="form.awayTeamId = ''"><option value="">待定</option><option v-for="match in sourceOptions" :key="match.id" :value="match.id">{{ sourceLabel(match) }} 胜者</option></select></div></div></section>
        <section class="form-section"><div class="form-section-heading"><span class="step-number">03</span><div><h3>时间与状态</h3><p>延期比赛保留原排赛资料，修改时间后再标记为已排赛。</p></div></div><div class="form-grid"><div><label for="match-time">开赛时间（北京时间） *</label><input id="match-time" v-model="form.scheduledAt" type="datetime-local" required /></div><div><label for="match-venue">比赛场地 *</label><input id="match-venue" v-model="form.venue" maxlength="120" required placeholder="填写球场名称或地址" /></div><div><label for="match-status">比赛状态 *</label><select id="match-status" v-model="form.status"><option v-for="[value, label] in statuses" :key="value" :value="value">{{ label }}</option></select></div></div></section>
        <div class="form-footer"><p class="muted">保存后，已公开赛事的赛程会同步展示。</p><button class="primary-button" type="button" @click="save">{{ busy ? '正在保存…' : '保存比赛' }}</button></div>
      </fieldset>
    </div>
    <p v-if="busy && !records.length" class="account-card competition-empty" role="status">正在读取赛程…</p>
    <div v-else-if="!records.length && !error" class="account-card competition-empty"><h2>还没有排赛</h2><p class="muted">选择赛事后点击“新增比赛”，录入线下抽签和赛程。</p></div>
    <section v-else class="account-card match-admin-list"><div class="card-heading"><div><h2>{{ competitions.find(item => item.id === competitionId)?.name || '当前赛事' }}</h2><p class="muted">查看已保存的对阵安排；修改后可在小程序刷新查看。</p></div><span class="status-badge">{{ records.length }} 场</span></div>
      <div v-for="record in records" :key="record.id" class="match-admin-row"><div class="match-admin-main"><span class="status-badge neutral">{{ matchStageLabels[record.stage] }} · 第{{ record.round }}轮</span><h3>{{ opponentName(record.homeTeamId, record.homeFrom) }} <span class="muted">vs</span> {{ opponentName(record.awayTeamId, record.awayFrom) }}</h3><p class="muted">{{ matchTime(record.scheduledAt) }} · {{ record.venue }}<template v-if="record.groupId"> · {{ record.groupId }}</template></p></div><div class="match-admin-meta"><span class="status-badge" :class="{ neutral: record.status === 'postponed' }">{{ matchStatusLabels[record.status] }}</span><button class="secondary-button" :disabled="busy" @click="edit(record)">编辑</button></div></div>
    </section>
    <button v-if="cursor" class="secondary-button" :disabled="busy" @click="load(true)">加载更多比赛</button>
  </section>
</template>
