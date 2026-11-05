<script setup lang="ts">
import { onMounted, ref, reactive } from 'vue'
import { competitionFormats, registrationLabels, competitionTime, formatLabel, type AdminCompetition, type CompetitionForm } from '../../src/domain/competition'
import type { createAdminAuth } from './auth'
const props = defineProps<{ auth: ReturnType<typeof createAdminAuth> }>()
const records = ref<AdminCompetition[]>([]), cursor = ref<string | null>(null), busy = ref(false), error = ref(''), notice = ref('')
const formOpen = ref(false), editing = ref<AdminCompetition | null>(null), requestId = ref('')
const empty = () => ({ name: '', description: '', format: 'group_knockout' as CompetitionForm['format'], formatDescription: '', startDate: '', endDate: '', venue: '', registrationRequirements: '', registrationStartAt: '', registrationEndAt: '', configureRegistration: false, projectsText: '', teamLimitText: '', minPlayersText: '', maxPlayersText: '' })
const form = reactive(empty())
const explain = (e: unknown) => e instanceof Error ? e.message : '操作失败，请重试。'
function inputTime(iso: string | null) { return iso ? new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 16) : '' }
function isoTime(v: string) { return v ? new Date(v + ':00+08:00').toISOString() : null }
function newForm() {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); requestId.value = Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('')
  editing.value = null; Object.assign(form, empty()); formOpen.value = true; error.value = ''; notice.value = ''
}
function edit(record: AdminCompetition) {
  editing.value = record; Object.assign(form, record, { registrationStartAt: inputTime(record.registrationStartAt), registrationEndAt: inputTime(record.registrationEndAt) })
  Object.assign(form,{configureRegistration:!!record.registrationConfig,projectsText:record.registrationConfig?.projects.join('\n')||'',teamLimitText:record.registrationConfig?.teamLimit==null?'':String(record.registrationConfig.teamLimit),minPlayersText:record.registrationConfig?String(record.registrationConfig.minPlayers):'',maxPlayersText:record.registrationConfig?String(record.registrationConfig.maxPlayers):''})
  formOpen.value = true; error.value = ''; notice.value = ''
}
async function fetchRecords(more = false) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    const page = await props.auth.authorized((api, token) => api.competitions(token, more ? cursor.value || undefined : undefined))
    records.value = more ? [...records.value, ...page.competitions] : page.competitions; cursor.value = page.nextCursor
  } catch (e) { records.value = []; cursor.value = null; error.value = explain(e) } finally { busy.value = false }
}
async function save() {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const payload: CompetitionForm = { name: form.name, description: form.description, format: form.format, formatDescription: form.formatDescription, startDate: form.startDate, endDate: form.endDate, venue: form.venue, registrationRequirements: form.registrationRequirements, registrationStartAt: isoTime(form.registrationStartAt), registrationEndAt: isoTime(form.registrationEndAt), registrationConfig:form.configureRegistration?{projects:form.projectsText.split(/\n/).map(s=>s.trim()).filter(Boolean),teamLimit:String(form.teamLimitText).trim()?Number(form.teamLimitText):null,minPlayers:Number(form.minPlayersText),maxPlayers:Number(form.maxPlayersText)}:null }
    await props.auth.authorized((api, token) => editing.value ? api.updateCompetition(token, editing.value.id, editing.value.version, payload) : api.createCompetition(token, requestId.value, payload))
    formOpen.value = false; notice.value = editing.value ? '赛事资料已保存。' : '赛事已创建，当前为隐藏状态，报名未开放。'
    busy.value = false; await fetchRecords()
  } catch (e) { error.value = explain(e) } finally { busy.value = false }
}
async function toggle(record: AdminCompetition, kind: 'visibility' | 'registration') {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const enabled = !(kind === 'visibility' ? record.displayEnabled : record.registrationEnabled)
    const updated = await props.auth.authorized((api, token) => api.competitionSwitch(token, record.id, record.version, kind, enabled))
    records.value = records.value.map(r => r.id === updated.id ? updated : r)
    notice.value = kind === 'visibility' ? (enabled ? '赛事已在小程序公开展示。' : '赛事已隐藏，公开详情也将不可访问。') : (enabled ? '报名开关已开启，开放状态由报名时间决定。' : '报名开关已关闭，赛事展示状态保持当前设置。')
  } catch (e) { error.value = explain(e) } finally { busy.value = false }
}
onMounted(() => { void fetchRecords() })
</script>
<template>
  <section class="competitions-admin">
    <div class="workspace-heading">
      <div><span class="eyebrow">赛事运营</span><h1>赛事管理</h1><p class="muted">维护赛事资料，设置小程序展示与报名安排。</p></div>
      <div class="competition-actions"><button class="secondary-button" :disabled="busy" @click="fetchRecords()">刷新列表</button><button class="primary-button" :disabled="busy" @click="newForm">新建赛事</button></div>
    </div>
    <div class="section-guide"><strong>赛事发布流程</strong><p>填写赛事资料 → 开启小程序展示 → 按报名时间开启报名。展示与报名可分别控制。</p></div>
    <p v-if="error" class="notice" role="alert">{{ error }}</p><p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <form v-if="formOpen" class="competition-form account-card" @submit.prevent="save">
      <div class="card-heading"><div><h2>{{ editing ? '编辑赛事' : '新建赛事' }}</h2><p class="muted">带 * 的内容为必填项，保存后生效。</p></div><button type="button" class="secondary-button" :disabled="busy" @click="formOpen = false">取消</button></div>
      <fieldset :disabled="busy">
        <section class="form-section" aria-labelledby="basic-title">
          <div class="form-section-heading"><span class="step-number">01</span><div><h3 id="basic-title">基本资料</h3><p>向参赛球队介绍赛事名称、内容与举办地点。</p></div></div>
          <label for="competition-name">赛事名称 *</label><input id="competition-name" v-model="form.name" maxlength="80" required placeholder="请输入完整赛事名称" />
          <label for="competition-description">赛事介绍 *</label><textarea id="competition-description" v-model="form.description" maxlength="1000" rows="4" required placeholder="介绍赛事背景、参赛对象及活动亮点"></textarea>
          <label for="competition-venue">比赛地点 *</label><input id="competition-venue" v-model="form.venue" maxlength="120" required placeholder="填写球场名称或具体地址" />
        </section>
        <section class="form-section" aria-labelledby="rules-title">
          <div class="form-section-heading"><span class="step-number">02</span><div><h3 id="rules-title">赛制与日期</h3><p>明确比赛方式、参赛规则和赛事举办时间。</p></div></div>
          <label for="competition-format">赛制类型 *</label><select id="competition-format" v-model="form.format"><option v-for="item in competitionFormats" :key="item.value" :value="item.value">{{ item.label }}</option></select>
          <label for="competition-rules">赛制说明 *</label><textarea id="competition-rules" v-model="form.formatDescription" maxlength="1000" rows="3" required placeholder="填写实际分组、轮次和参赛规则"></textarea>
          <div class="form-grid"><div><label for="competition-start">赛事开始日期 *</label><input id="competition-start" type="date" v-model="form.startDate" min="2020-01-01" max="2100-12-31" required /></div><div><label for="competition-end">赛事结束日期 *</label><input id="competition-end" type="date" v-model="form.endDate" min="2020-01-01" max="2100-12-31" required /></div></div>
        </section>
        <section class="form-section" aria-labelledby="registration-title">
          <div class="form-section-heading"><span class="step-number">03</span><div><h3 id="registration-title">报名安排</h3><p>填写参赛条件及报名起止时间，时间均为北京时间。</p></div></div>
          <label for="competition-requirements">参赛与报名要求 *</label><textarea id="competition-requirements" v-model="form.registrationRequirements" maxlength="1000" rows="3" required placeholder="填写参赛资格、球员名单及其他报名要求"></textarea>
          <div class="form-grid"><div><label for="registration-start">报名开始时间（北京时间）</label><input id="registration-start" type="datetime-local" v-model="form.registrationStartAt" /></div><div><label for="registration-end">报名截止时间（北京时间）</label><input id="registration-end" type="datetime-local" v-model="form.registrationEndAt" /></div></div>
          <p class="field-note">报名时间可暂不填写，开启报名前须补齐。新建赛事默认隐藏，报名开关默认关闭。</p>
          <div class="registration-config"><label class="checkbox-line"><input type="checkbox" v-model="form.configureRegistration" /> 配置球队报名项目与名额</label><p class="field-note">提交报名需要完整配置。每队人数由管理员根据上传材料核对。</p><template v-if="form.configureRegistration"><label for="registration-projects">报名项目 *（每行一个）</label><textarea id="registration-projects" v-model="form.projectsText" rows="3" required placeholder="例如：男子组&#10;女子组"></textarea><div class="form-grid"><div><label for="registration-limit">球队上限</label><input id="registration-limit" type="number" min="1" max="10000" step="1" v-model="form.teamLimitText" placeholder="留空为不限额" /></div><div><label for="registration-min-players">每队人数下限 *</label><input id="registration-min-players" type="number" min="1" max="200" step="1" required v-model="form.minPlayersText" placeholder="按赛事规则填写" /></div><div><label for="registration-max-players">每队人数上限 *</label><input id="registration-max-players" type="number" min="1" max="200" step="1" required v-model="form.maxPlayersText" placeholder="按赛事规则填写" /></div></div><p class="field-note">待审核和已通过占用名额；驳回、撤销释放名额。修改报名后重新审核。</p></template></div>
        </section>
        <div class="form-footer"><p class="muted">保存后，可在赛事卡片中调整展示与报名开关。</p><button type="submit" class="primary-button">{{ busy ? '正在保存…' : '保存赛事' }}</button></div>
      </fieldset>
    </form>
    <p v-if="busy && !records.length" class="account-card competition-empty" role="status">正在读取赛事…</p>
    <div v-else-if="!records.length && !error" class="account-card competition-empty"><h2>还没有赛事</h2><p class="muted">点击“新建赛事”，填写资料后即可设置展示和报名。</p></div>
    <article v-for="record in records" :key="record.id" class="account-card competition-admin-card" :data-competition-id="record.id">
      <div class="card-heading"><div><div class="record-tags"><span class="status-badge neutral">{{ formatLabel(record.format) }}</span><span class="status-badge" :class="{ neutral: !record.displayEnabled }">{{ record.displayEnabled ? '小程序已展示' : '小程序已隐藏' }}</span></div><h2>{{ record.name }}</h2></div><button class="secondary-button" :disabled="busy" @click="edit(record)">编辑赛事</button></div>
      <dl class="competition-facts"><div><dt>赛事日期</dt><dd>{{ record.startDate }} — {{ record.endDate }}</dd></div><div><dt>比赛地点</dt><dd>{{ record.venue }}</dd></div></dl>
      <div class="record-description"><h3>赛事介绍</h3><p class="competition-description">{{ record.description }}</p></div>
      <div class="competition-switches">
        <div class="switch-card"><div class="switch-card-heading"><h3>小程序展示</h3><button class="switch-button" role="switch" :aria-checked="record.displayEnabled" :aria-label="record.name + '：小程序展示'" :class="{ enabled: record.displayEnabled }" :disabled="busy" @click="toggle(record, 'visibility')"><span class="switch-track" aria-hidden="true"></span>{{ record.displayEnabled ? '已展示' : '已隐藏' }}</button></div><p class="muted">开启后，用户可在小程序查看赛事。关闭后，列表和直达详情均不可见。</p></div>
        <div class="switch-card"><div class="switch-card-heading"><h3>赛事报名</h3><button class="switch-button" role="switch" :aria-checked="record.registrationEnabled" :aria-label="record.name + '：赛事报名'" :class="{ enabled: record.registrationEnabled }" :disabled="busy" @click="toggle(record, 'registration')"><span class="switch-track" aria-hidden="true"></span>{{ record.registrationEnabled ? '已开启' : '已关闭' }}</button></div><p class="switch-status">{{ registrationLabels[record.registrationStatus] }}</p><p class="muted">开启后按报名时间生效；隐藏赛事不向用户开放。</p></div>
      </div>
      <div class="registration-config-summary"><h3>球队报名配置</h3><template v-if="record.registrationConfig"><p>{{ record.registrationConfig.projects.join(' / ') }}</p><p>球队{{ record.registrationConfig.teamLimit===null?'不限额':`上限${record.registrationConfig.teamLimit}支` }} · 每队{{ record.registrationConfig.minPlayers }}–{{ record.registrationConfig.maxPlayers }}人</p><p class="muted">已占用 {{ record.registrationStats.occupied }} · 待审核 {{ record.registrationStats.pending }} · 已通过 {{ record.registrationStats.approved }}</p></template><p v-else class="muted">尚未配置，请编辑赛事设置项目、球队名额及每队人数后接收报名。</p></div>
      <div class="registration-window"><h3>报名时间 <span>北京时间</span></h3><div><p><span>开始</span><strong>{{ competitionTime(record.registrationStartAt) }}</strong></p><p><span>截止</span><strong>{{ competitionTime(record.registrationEndAt) }}</strong></p></div></div>
    </article>
    <button v-if="cursor" class="secondary-button" :disabled="busy" @click="fetchRecords(true)">加载更多赛事</button>
  </section>
</template>
