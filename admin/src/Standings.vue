<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import type { createAdminAuth } from './auth'
import type { AdminCompetition } from '../../src/domain/competition'
import type { ManagedTeam, TeamSummary } from '../../src/domain/team'
import type { RegistrationSummary } from '../../src/domain/registration'
import type { GroupQualification } from '../../src/domain/match'
import { matchStageLabels, matchStatusLabels, matchTime } from '../../src/domain/match'
import type { RankedMatch, ResultHistory, ResultInput, ResultPlayer, StandingsRules, StandingsSnapshot } from '../../src/domain/standings'
const props = defineProps<{ auth: ReturnType<typeof createAdminAuth> }>()
const competitions = ref<AdminCompetition[]>([]), teams = ref<TeamSummary[]>([]), approvedIds = ref<string[]>([])
const competitionId = ref(''), snapshot = ref<StandingsSnapshot | null>(null)
const busy = ref(false), error = ref(''), notice = ref(''), active = ref('results')
const tabs = [{ id: 'results', label: '赛果与事件' }, { id: 'rules', label: '积分与分组' }, { id: 'rankings', label: '榜单预览' }, { id: 'advancement', label: '晋级来源' }]
const draft = reactive<StandingsRules>({ winPoints: 3, drawPoints: 1, lossPoints: 0, legs: 1, groups: [] })
const entrants = computed(() => teams.value.filter(team => approvedIds.value.includes(team.id) && team.status === 'active'))
const matches = computed(() => [...(snapshot.value?.matches || [])].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id)))
const editor = ref<RankedMatch | null>(null), editorMode = ref<'result' | 'revoke' | 'qualification' | 'history'>('result')
const roster = ref<ManagedTeam[]>([]), history = ref<ResultHistory>({ revisions: [], nextVersion: null })
const homeQualification = ref(''), awayQualification = ref('')
const resultForm = reactive({ homeScore: '0', awayScore: '0', homePenalty: '', awayPenalty: '', reason: '' })
const goalRows = ref<{ teamId: string; minute: string; ownGoal: boolean; scorerId: string; assistId: string }[]>([])
const requestId = ref('')
let generation = 0
const explain = (e: unknown) => e instanceof Error ? e.message : '赛事数据暂不可用，请重试。'
const teamName = (id: string | null) => teams.value.find(team => team.id === id)?.name || '待定'
const pairing = (match: RankedMatch) => `${match.homeTeamName || '待定'} vs ${match.awayTeamName || '待定'}`
const makeId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), v => v.toString(16).padStart(2, '0')).join('')
const qualificationOptions = computed(() => snapshot.value?.rules.groups.flatMap(group => group.teamIds.map((_, index) => ({ value: JSON.stringify({ groupId: group.id, rank: index + 1 }), label: `${group.id} 第${index + 1}名` }))) || [])
const sourceText = (match: RankedMatch, side: 'home' | 'away') => {
  const q = match[`${side}Qualification`]
  if (q) return `${q.groupId} 第${q.rank}名`
  const from = match[`${side}From`]
  const previous = snapshot.value?.matches.find(m => m.id === from)
  return from ? previous ? `${matchStageLabels[previous.stage]} 第${previous.slot || previous.round}场胜者` : '前序比赛胜者' : '固定球队 / 待定'
}
async function pages<T>(read: (cursor?: string) => Promise<{ rows: T[]; nextCursor: string | null }>) {
  const rows: T[] = [], seen = new Set<string>(); let cursor: string | undefined
  do { const page = await read(cursor); if (page.nextCursor && seen.has(page.nextCursor)) throw new Error('分页异常，请重新加载。'); if (page.nextCursor) seen.add(page.nextCursor); rows.push(...page.rows); cursor = page.nextCursor || undefined } while (cursor)
  return rows
}
async function loadCurrent() {
  const serial = ++generation, id = competitionId.value
  snapshot.value = null; editor.value = null; busy.value = true; error.value = ''
  try {
    if (!id) { approvedIds.value = []; return }
    const [data, registrations] = await Promise.all([
      props.auth.authorized((api, token) => api.standings(token, id)),
      pages<RegistrationSummary>(async cursor => { const r = await props.auth.authorized((api, token) => api.registrations(token, id, 'approved', cursor)); return { rows: r.registrations, nextCursor: r.nextCursor } }),
    ])
    if (serial !== generation) return
    if (data.competitionId !== id) throw new Error('返回赛事不匹配，请刷新。')
    snapshot.value = data; approvedIds.value = registrations.map(r => r.teamId)
    Object.assign(draft, JSON.parse(JSON.stringify(data.rules)))
  } catch (e) { if (serial === generation) error.value = explain(e) }
  finally { if (serial === generation) busy.value = false }
}
async function refresh() {
  if (busy.value) return
  const serial = ++generation
  busy.value = true; error.value = ''; notice.value = ''; snapshot.value = null; editor.value = null
  try {
    const [allCompetitions, allTeams] = await Promise.all([
      pages(async cursor => { const r = await props.auth.authorized((api, token) => api.competitions(token, cursor)); return { rows: r.competitions, nextCursor: r.nextCursor } }),
      pages(async cursor => { const r = await props.auth.authorized((api, token) => api.teams(token, cursor)); return { rows: r.teams, nextCursor: r.nextCursor } }),
    ])
    if (serial !== generation) return
    competitions.value = allCompetitions; teams.value = allTeams
    if (!allCompetitions.some(c => c.id === competitionId.value)) competitionId.value = allCompetitions[0]?.id || ''
  } catch (e) { if (serial === generation) error.value = explain(e) }
  finally { if (serial === generation) busy.value = false }
  if (serial === generation && !error.value) await loadCurrent()
}
function addGroup() { draft.groups.push({ id: '', teamIds: [] }) }
function assignedElsewhere(id: string, index: number) { return draft.groups.some((group, i) => i !== index && group.teamIds.includes(id)) }
async function saveRules() {
  if (busy.value || !snapshot.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    await props.auth.authorized((api, token) => api.updateStandingsRules(token, competitionId.value, snapshot.value!.revision, JSON.parse(JSON.stringify(draft))))
    notice.value = '积分与分组已保存，榜单和晋级对阵已重新计算。'; await loadCurrent()
  } catch (e) { error.value = explain(e) } finally { busy.value = false }
}
function players(teamId: string): ResultPlayer[] {
  const current = roster.value.find(team => team.id === teamId)?.players || []
  const historical = (editor.value?.result?.goals || []).filter(goal => goal.teamId === teamId).flatMap(goal => [goal.scorer, goal.assist]).filter(Boolean).map(p => ({ ...p!, position: '' }))
  return [...new Map([...historical, ...current].map(p => [p.id, p])).values()].sort((a, b) => a.number - b.number)
}
async function open(match: RankedMatch, mode: typeof editorMode.value) {
  if (busy.value) return
  const serial = generation
  editor.value = null; error.value = ''; notice.value = ''; busy.value = true
  try {
    roster.value = []
    if (mode === 'result') {
      const ids = [...new Set([match.homeTeamId, match.awayTeamId].filter((id): id is string => !!id))]
      if (ids.length !== 2) throw new Error('请等待双方参赛球队确定后再录入赛果。')
      const records = await Promise.all(ids.map(id => props.auth.authorized((api, token) => api.team(token, id))))
      if (serial !== generation) return
      roster.value = records
    }
    if (mode === 'history') {
      const data = await props.auth.authorized((api, token) => api.resultHistory(token, competitionId.value, match.id))
      if (serial !== generation) return
      history.value = data
    }
    if (serial !== generation) return
    editor.value = match; editorMode.value = mode; requestId.value = makeId()
    Object.assign(resultForm, { homeScore: String(match.homeScore ?? 0), awayScore: String(match.awayScore ?? 0), homePenalty: match.penalties ? String(match.penalties[0]) : '', awayPenalty: match.penalties ? String(match.penalties[1]) : '', reason: '' })
    goalRows.value = (match.result?.goals || []).map(goal => ({ teamId: goal.teamId, minute: String(goal.minute), ownGoal: goal.ownGoal, scorerId: goal.scorer?.id || '', assistId: goal.assist?.id || '' }))
    homeQualification.value = match.homeQualification ? JSON.stringify(match.homeQualification) : ''
    awayQualification.value = match.awayQualification ? JSON.stringify(match.awayQualification) : ''
  } catch (e) { if (serial === generation) error.value = explain(e) } finally { if (serial === generation) busy.value = false }
}
function buildGoals() {
  if (!editor.value) return
  const score = [resultForm.homeScore, resultForm.awayScore].map(v => String(v ?? '').trim() ? Number(v) : NaN)
  if (score.some(v => !Number.isInteger(v) || v < 0 || v > 99)) { error.value = '请先填写0–99的双方比分。'; return }
  goalRows.value = [editor.value.homeTeamId!, editor.value.awayTeamId!].flatMap((teamId, i) => {
    const previous = goalRows.value.filter(goal => goal.teamId === teamId)
    return Array.from({ length: score[i] }, (_, index) => previous[index] || { teamId, minute: '', ownGoal: false, scorerId: '', assistId: '' })
  })
  error.value = ''
}
function inputResult(): ResultInput {
  if (goalRows.value.some(goal => !String(goal.minute ?? '').trim() || !goal.ownGoal && !goal.scorerId)) throw new Error('请填写每粒进球的分钟和进球者，或标记为乌龙球。')
  if (!String(resultForm.homeScore ?? '').trim() || !String(resultForm.awayScore ?? '').trim()) throw new Error('请填写双方比分。')
  return { homeScore: Number(resultForm.homeScore), awayScore: Number(resultForm.awayScore), penalties: String(resultForm.homePenalty ?? '').trim() !== '' || String(resultForm.awayPenalty ?? '').trim() !== '' ? [String(resultForm.homePenalty ?? '').trim() ? Number(resultForm.homePenalty) : NaN, String(resultForm.awayPenalty ?? '').trim() ? Number(resultForm.awayPenalty) : NaN] : null,
    goals: goalRows.value.map(goal => ({ teamId: goal.teamId, minute: Number(goal.minute), ownGoal: goal.ownGoal, scorerId: goal.ownGoal ? null : goal.scorerId || null, assistId: goal.ownGoal ? null : goal.assistId || null })) }
}
async function submit() {
  if (busy.value || !snapshot.value || !editor.value) return
  const match = editor.value, revision = snapshot.value.revision
  busy.value = true; error.value = ''; notice.value = ''
  try {
    if (editorMode.value === 'qualification') {
      const q = (value: string) => value ? JSON.parse(value) as GroupQualification : null
      await props.auth.authorized((api, token) => api.bindQualification(token, competitionId.value, match.id, match.version!, revision, q(homeQualification.value), q(awayQualification.value)))
      notice.value = '晋级来源已保存，待定对阵已更新。'
    } else if (editorMode.value === 'revoke') {
      await props.auth.authorized((api, token) => api.revokeResult(token, competitionId.value, match.id, match.version!, revision, requestId.value, resultForm.reason))
      notice.value = '赛果已撤销，榜单和晋级对阵已重新计算。'
    } else {
      const payload = inputResult()
      await props.auth.authorized((api, token) => api.saveResult(token, competitionId.value, match.id, match.version!, revision, requestId.value, resultForm.reason, payload))
      notice.value = '赛果已保存，榜单和晋级对阵已同步更新。'
    }
    editor.value = null; await loadCurrent()
  } catch (e) { error.value = explain(e) } finally { busy.value = false }
}
async function moreHistory() {
  if (busy.value || !editor.value || !history.value.nextVersion) return
  busy.value = true; error.value = ''
  try { const page = await props.auth.authorized((api, token) => api.resultHistory(token, competitionId.value, editor.value!.id, history.value.nextVersion!)); history.value = { revisions: [...history.value.revisions, ...page.revisions], nextVersion: page.nextVersion } }
  catch (e) { error.value = explain(e) } finally { busy.value = false }
}
onMounted(() => { void refresh() })
onUnmounted(() => { ++generation })
</script>

<template>
  <section class="standings-admin">
    <div class="workspace-heading"><div><span class="eyebrow">赛事运营</span><h1>榜单与晋级</h1><p class="muted">从同一份赛果计算积分、射手、助攻和晋级对阵。</p></div><button class="secondary-button" :disabled="busy" @click="refresh">刷新数据</button></div>
    <div class="section-guide"><strong>赛果发布后自动联动</strong><p>先设置分组并排赛，再录入完赛比分与进球事件。更正、撤销会同步重算；影响已有赛果的后轮球队时，须先撤销后轮赛果。</p></div>
    <p v-if="error" class="notice" role="alert">{{ error }}</p><p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <div v-if="competitions.length" class="account-card registration-filters"><div><label for="standings-competition">选择赛事</label><select id="standings-competition" v-model="competitionId" :disabled="busy" @change="notice = ''; loadCurrent()"><option v-for="item in competitions" :key="item.id" :value="item.id">{{ item.name }}</option></select></div><p class="muted">{{ entrants.length }} 支已审核球队 · {{ snapshot?.matches.filter(m => m.status === 'finished').length || 0 }} 场已完赛</p></div>
    <div class="standings-admin-tabs"><button v-for="tab in tabs" :key="tab.id" class="secondary-button" :class="{ selected: active === tab.id }" :disabled="busy" @click="active = tab.id; editor = null">{{ tab.label }}</button></div>
    <p v-if="busy && !snapshot" class="account-card competition-empty" role="status">正在读取赛事数据…</p>
    <div v-else-if="!competitions.length && !busy && !error" class="account-card competition-empty">请先创建赛事，再设置榜单与晋级。</div>
    <template v-if="snapshot">
      <form v-if="active === 'rules'" class="account-card competition-form standings-rules" @submit.prevent="saveRules"><div class="card-heading"><div><h2>积分与分组规则</h2><p class="muted">排序依次为积分、净胜球、进球数；仍相同则并列，不自动选出晋级球队。</p></div></div><fieldset :disabled="busy"><div class="form-grid"><div><label for="rules-win">胜场积分</label><input id="rules-win" v-model.number="draft.winPoints" type="number" min="0" max="10" required /></div><div><label for="rules-draw">平场积分</label><input id="rules-draw" v-model.number="draft.drawPoints" type="number" min="0" max="10" required /></div><div><label for="rules-loss">负场积分</label><input id="rules-loss" v-model.number="draft.lossPoints" type="number" min="0" max="10" required /></div><div><label for="rules-legs">组内循环轮数</label><select id="rules-legs" v-model.number="draft.legs"><option :value="1">单循环（每两队1场）</option><option :value="2">双循环（每两队2场）</option></select></div></div><p class="field-note">循环赛请将全部参赛球队放入同一组。纯淘汰赛可不设分组。只有组内完整赛程全部完赛后才确定分组晋级名次。</p>
      <section v-for="(group, index) in draft.groups" :key="index" class="form-section standings-group-editor"><div class="card-heading"><h3>分组 {{ index + 1 }}</h3><button class="secondary-button" type="button" @click="draft.groups.splice(index, 1)">移除分组</button></div><label :for="`rules-group-${index}`">分组名称</label><input :id="`rules-group-${index}`" v-model="group.id" maxlength="40" required placeholder="须与赛程分组名称一致，如 A组" /><p class="muted">选择本组球队，一支球队只可进入一个分组。</p><div class="standings-team-checks"><label v-for="team in entrants" :key="team.id"><input v-model="group.teamIds" type="checkbox" :value="team.id" :disabled="assignedElsewhere(team.id, index)" /><span>{{ team.name }}</span></label></div><p v-if="!entrants.length" class="muted">暂无已审核参赛球队，请先处理报名审核。</p></section><div class="form-footer"><button class="secondary-button" type="button" :disabled="draft.groups.length >= 16" @click="addGroup">添加分组</button><button class="primary-button" type="submit">保存积分与分组</button></div></fieldset></form>
      <template v-if="active === 'results' || active === 'advancement'">
        <form v-if="editor" class="account-card competition-form result-editor" @submit.prevent="submit"><div class="card-heading"><div><h2>{{ editorMode === 'result' ? (editor.status === 'finished' ? '更正赛果' : '录入赛果') : editorMode === 'revoke' ? '撤销赛果' : editorMode === 'history' ? '更正历史' : '设置分组晋级来源' }}</h2><p class="muted">{{ pairing(editor) }} · {{ matchTime(editor.scheduledAt) }}</p></div><button class="secondary-button" type="button" :disabled="busy" @click="editor = null">关闭</button></div>
          <fieldset v-if="editorMode !== 'history'" :disabled="busy">
            <template v-if="editorMode === 'qualification'"><p class="field-note">固定球队和前序比赛来源请在“赛程与对阵”中维护。改为分组名次前，先将该方固定球队和比赛来源清空。</p><div class="form-grid"><div><label for="qualification-home">主队分组来源</label><select id="qualification-home" v-model="homeQualification"><option value="">不使用分组名次</option><option v-for="option in qualificationOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></div><div><label for="qualification-away">客队分组来源</label><select id="qualification-away" v-model="awayQualification"><option value="">不使用分组名次</option><option v-for="option in qualificationOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></div></div></template>
            <template v-else-if="editorMode === 'result'"><div class="form-grid"><div><label for="result-home">主队比分 · {{ editor.homeTeamName }}</label><input id="result-home" v-model="resultForm.homeScore" type="number" min="0" max="99" step="1" required /></div><div><label for="result-away">客队比分 · {{ editor.awayTeamName }}</label><input id="result-away" v-model="resultForm.awayScore" type="number" min="0" max="99" step="1" required /></div><template v-if="editor.stage !== 'group'"><div><label for="result-home-penalty">主队点球比分（平局时填写）</label><input id="result-home-penalty" v-model="resultForm.homePenalty" type="number" min="0" max="99" step="1" /></div><div><label for="result-away-penalty">客队点球比分（平局时填写）</label><input id="result-away-penalty" v-model="resultForm.awayPenalty" type="number" min="0" max="99" step="1" /></div></template></div><div class="result-event-heading"><div><h3>进球事件</h3><p class="muted">每粒进球录入一条事件；点球大战不计入。乌龙球选择比分受益方。</p></div><button type="button" class="secondary-button" @click="buildGoals">按比分生成进球记录</button></div><section v-for="(goal, index) in goalRows" :key="`${goal.teamId}:${index}`" class="form-section result-goal"><h3>{{ teamName(goal.teamId) }} · 第 {{ index + 1 }} 条</h3><div class="form-grid"><div><label :for="`goal-minute-${index}`">进球分钟</label><input :id="`goal-minute-${index}`" v-model="goal.minute" type="number" min="0" max="150" step="1" required /></div><div class="standings-team-checks"><label><input v-model="goal.ownGoal" type="checkbox" @change="goal.scorerId = ''; goal.assistId = ''" /><span>乌龙球（不计个人数据）</span></label></div><template v-if="!goal.ownGoal"><div><label :for="`goal-scorer-${index}`">进球者</label><select :id="`goal-scorer-${index}`" v-model="goal.scorerId" required @change="goal.assistId === goal.scorerId && (goal.assistId = '')"><option value="">请选择球员</option><option v-for="player in players(goal.teamId)" :key="player.id" :value="player.id">{{ player.number }}号 · {{ player.name }}</option></select></div><div><label :for="`goal-assist-${index}`">助攻者</label><select :id="`goal-assist-${index}`" v-model="goal.assistId"><option value="">无助攻</option><option v-for="player in players(goal.teamId).filter(p => p.id !== goal.scorerId)" :key="player.id" :value="player.id">{{ player.number }}号 · {{ player.name }}</option></select></div></template></div></section></template>
            <p v-else class="field-note">撤销 {{ editor.homeScore }} : {{ editor.awayScore }} 的赛果后，本场恢复已排赛，榜单不再统计本场，并重新判断晋级。原记录保留在更正历史中。</p>
            <template v-if="editorMode !== 'qualification'"><label for="result-reason">{{ editorMode === 'revoke' ? '撤销原因' : '录入或更正原因' }}</label><textarea id="result-reason" v-model="resultForm.reason" rows="3" maxlength="300" required placeholder="填写赛果来源或更正原因，便于后续核对" /></template><div class="form-footer"><p class="muted">保存后公开榜单与赛程将读取最新结果。</p><button type="submit" class="primary-button">{{ editorMode === 'qualification' ? '保存晋级来源' : editorMode === 'revoke' ? '确认撤销赛果' : '保存并发布赛果' }}</button></div>
          </fieldset>
          <template v-else><p v-if="!history.revisions.length" class="muted">暂无赛果变更记录。</p><section v-for="revision in history.revisions" :key="revision.version" class="result-history-row"><div class="card-heading"><strong>{{ revision.revoked ? '撤销赛果' : `${revision.result?.homeScore} : ${revision.result?.awayScore}` }}</strong><span class="muted">{{ matchTime(revision.createdAt) }}</span></div><p>{{ revision.reason }}</p><p v-if="revision.result?.penalties" class="muted">点球 {{ revision.result.penalties.join(' : ') }}</p><p v-for="(goal, index) in revision.result?.goals || []" :key="index" class="muted">{{ goal.minute }}′ {{ teamName(goal.teamId) }} · {{ goal.ownGoal ? '乌龙球' : `${goal.scorer?.name}${goal.assist ? `（${goal.assist.name} 助攻）` : ''}` }}</p></section><button v-if="history.nextVersion" class="secondary-button" type="button" :disabled="busy" @click="moreHistory">加载更多历史</button></template>
        </form>
        <div v-if="!matches.length" class="account-card competition-empty"><h2>尚未排赛</h2><p class="muted">请先在“赛程与对阵”新增比赛。</p></div>
        <div v-for="match in matches.filter(m => active !== 'advancement' || m.stage !== 'group')" :key="match.id" class="account-card standings-match-row"><div><span class="status-badge neutral">{{ matchStageLabels[match.stage] }} · {{ match.groupId || `第${match.round}轮` }}</span><h3>{{ pairing(match) }}</h3><p class="muted">{{ matchTime(match.scheduledAt) }} · {{ match.venue }}</p><p v-if="active === 'advancement'" class="muted">主队：{{ sourceText(match, 'home') }}<br />客队：{{ sourceText(match, 'away') }}</p></div><div class="standings-match-actions"><strong class="result-score">{{ match.status === 'finished' ? `${match.homeScore} : ${match.awayScore}` : matchStatusLabels[match.status] }}</strong><span v-if="match.penalties" class="muted">点球 {{ match.penalties.join(' : ') }}</span><div class="competition-actions"><template v-if="active === 'results'"><button class="secondary-button" :disabled="busy || !match.homeTeamId || !match.awayTeamId" @click="open(match, 'result')">{{ match.status === 'finished' ? '更正赛果' : '录入赛果' }}</button><button v-if="match.status === 'finished'" class="secondary-button" :disabled="busy" @click="open(match, 'revoke')">撤销赛果</button><button class="secondary-button" :disabled="busy" @click="open(match, 'history')">更正历史</button></template><button v-else class="secondary-button" :disabled="busy" @click="open(match, 'qualification')">设置分组来源</button></div></div></div>
        <p v-if="active === 'advancement' && !matches.some(m => m.stage !== 'group')" class="account-card competition-empty">尚无淘汰赛，请先排赛。</p>
      </template>
      <template v-if="active === 'rankings'"><div v-if="!snapshot.groups.length" class="account-card competition-empty">尚未配置积分分组；纯淘汰赛可直接查看球员榜。</div><section v-for="group in snapshot.groups" :key="group.id" class="account-card standings-preview"><div class="card-heading"><h2>{{ group.id }} 积分榜</h2><span class="status-badge">{{ group.complete ? '本组已完赛' : `已完赛 ${group.finishedMatches}/${group.expectedMatches}` }}</span></div><div class="standings-table-wrap"><table><thead><tr><th>名次</th><th>球队</th><th>赛</th><th>胜</th><th>平</th><th>负</th><th>进/失</th><th>净胜</th><th>积分</th></tr></thead><tbody><tr v-for="row in group.rows" :key="row.teamId"><td>{{ row.rank }}</td><td>{{ row.teamName }}</td><td>{{ row.played }}</td><td>{{ row.won }}</td><td>{{ row.drawn }}</td><td>{{ row.lost }}</td><td>{{ row.goalsFor }}/{{ row.goalsAgainst }}</td><td>{{ row.difference }}</td><td><strong>{{ row.points }}</strong></td></tr></tbody></table></div></section><div class="standings-player-previews"><section v-for="metric in (['goals', 'assists'] as const)" :key="metric" class="account-card standings-preview"><h2>{{ metric === 'goals' ? '射手榜' : '助攻榜' }}</h2><p v-if="!snapshot[metric].length" class="muted">暂无有效记录</p><div v-for="row in snapshot[metric]" :key="`${row.teamId}:${row.playerId}`" class="admin-player-rank"><strong>{{ row.rank }}</strong><div><strong>{{ row.playerName }}</strong><p class="muted">{{ row.teamName }} · {{ row.number }}号</p></div><strong>{{ row.value }}</strong></div></section></div></template>
    </template>
  </section>
</template>
