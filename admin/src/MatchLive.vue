<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import type { createAdminAuth } from './auth'
import type { AdminCompetition } from '../../src/domain/competition'
import { matchTime, matchStageLabels, type MatchSchedule } from '../../src/domain/match'
import type { TeamSummary } from '../../src/domain/team'
import type { LiveEntry, LiveForm, LiveImage, LiveImageCleanup } from '../../src/domain/match-live'
import NewsImageInput from './NewsImageInput.vue'
const props = defineProps<{ auth: ReturnType<typeof createAdminAuth> }>()
const competitions = ref<AdminCompetition[]>([]), matches = ref<MatchSchedule[]>([]), teams = ref<TeamSummary[]>([]), competitionId = ref(''), matchId = ref('')
const entries = ref<LiveEntry[]>([]), cursor = ref<string | null>(null), busy = ref(false), error = ref(''), notice = ref(''), editor = ref(false), selected = ref<LiveEntry | null>(null)
const form = reactive<LiveForm>({ text: '', minute: null, images: [] }), minuteText = ref(''), requestId = ref(''), deleting = ref<LiveEntry | null>(null), deleteText = ref(''), needsReload = ref(false)
const uploadsEnabled = ref(false), uploadNotice = ref('正在读取图片上传配置…'), pendingImages = reactive(new Set<string>()), cleanup = ref<LiveImageCleanup | null>(null), cleanupBusy = ref(false), cleanupError = ref(''), confirmCleanup = ref(false), cleanupCursor = ref<string | undefined>()
const imagePending = computed(() => pendingImages.size > 0), locked = computed(() => busy.value || imagePending.value || cleanupBusy.value), ownerId = computed(() => selected.value?.id || `l_${requestId.value}`)
const hidden = computed(() => competitions.value.find(c => c.id === competitionId.value)?.displayEnabled === false)
const keys = new WeakMap<LiveImage, string>(); let sequence = 0, generation = 0, alive = true
const freshId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('')
const explain = (e: unknown) => e instanceof Error ? e.message : '直播服务暂不可用，请重试。'
const team = (id: string | null) => teams.value.find(t => t.id === id)?.name || '待定球队'
const label = (m: MatchSchedule) => `${matchTime(m.scheduledAt)} · ${team(m.homeTeamId)} vs ${team(m.awayTeamId)} · ${matchStageLabels[m.stage]}`
function key(image: LiveImage) { if (!keys.has(image)) keys.set(image, `image-${++sequence}`); return keys.get(image)! }
function pending(id: string, value: boolean) { value ? pendingImages.add(id) : pendingImages.delete(id) }
function changeImage(image: LiveImage, value: { id: string | null; url: string }) { image.imageId = value.id; image.url = value.url }
function clearEditor() { editor.value = false; selected.value = null; deleting.value = null; needsReload.value = false; pendingImages.clear() }
async function collect<T>(fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>): Promise<T[]> {
  const all: T[] = [], seen = new Set<string>(); let next: string | undefined
  do { const p = await fetchPage(next); all.push(...p.items); if (p.nextCursor && seen.has(p.nextCursor) || seen.size >= 100) throw new Error('分页返回异常，请重新读取。'); if (p.nextCursor) seen.add(p.nextCursor); next = p.nextCursor || undefined } while (next)
  return all
}
async function load(more = false) {
  if (!matchId.value || imagePending.value) return
  const serial = ++generation, id = matchId.value; busy.value = true; error.value = ''; clearEditor()
  if (!more) { entries.value = []; cursor.value = null }
  try { const p = await props.auth.authorized((api, token) => api.liveEntries(token, id, more ? cursor.value || undefined : undefined)); if (serial === generation) { entries.value = more ? [...entries.value, ...p.entries.filter(e => !entries.value.some(old => old.id === e.id))] : p.entries; cursor.value = p.nextCursor } }
  catch (e) { if (serial === generation) error.value = explain(e) }
  finally { if (serial === generation) busy.value = false }
}
async function chooseCompetition() {
  if (imagePending.value) return
  const serial = ++generation, id = competitionId.value; busy.value = true; error.value = ''; notice.value = ''; matches.value = []; entries.value = []; cursor.value = null; matchId.value = ''; clearEditor()
  try {
    const rows = id ? await collect(async c => { const p = await props.auth.authorized((api, token) => api.matches(token, id, c)); return { items: p.matches, nextCursor: p.nextCursor } }) : []
    if (serial !== generation) return
    matches.value = rows.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)); matchId.value = rows[0]?.id || ''
    if (matchId.value) await load()
  } catch (e) { if (serial === generation) error.value = explain(e) }
  finally { if (serial === generation) busy.value = false }
}
async function initialize() {
  if (locked.value) return
  void readImageConfig()
  const serial = ++generation; busy.value = true; error.value = ''; clearEditor()
  try {
    const [events, clubs] = await Promise.all([
      collect(async c => { const p = await props.auth.authorized((api, token) => api.competitions(token, c)); return { items: p.competitions, nextCursor: p.nextCursor } }),
      collect(async c => { const p = await props.auth.authorized((api, token) => api.teams(token, c)); return { items: p.teams, nextCursor: p.nextCursor } }),
    ])
    if (serial !== generation) return
    competitions.value = events; teams.value = clubs; competitionId.value = events.some(c => c.id === competitionId.value) ? competitionId.value : events[0]?.id || ''
    await chooseCompetition()
  } catch (e) { if (serial === generation) error.value = explain(e) }
  finally { if (serial === generation) busy.value = false }
}
function create() { if (locked.value || !matchId.value) return; selected.value = null; requestId.value = freshId(); Object.assign(form, { text: '', minute: null, images: [] }); minuteText.value = ''; editor.value = true; deleting.value = null; needsReload.value = false; error.value = ''; notice.value = '' }
function edit(entry: LiveEntry) { if (locked.value) return; selected.value = entry; requestId.value = freshId(); Object.assign(form, { text: entry.text, minute: entry.minute, images: entry.images.map(i => ({ ...i })) }); minuteText.value = entry.minute === null ? '' : String(entry.minute); editor.value = true; deleting.value = null; needsReload.value = false; error.value = ''; notice.value = '' }
function mutationFailed(e: unknown) { error.value = explain(e); if (e && typeof e === 'object' && 'code' in e && ['TIMEOUT', 'NETWORK_ERROR', 'INVALID_RESPONSE', 'WRITE_COMMITTED', 'CONFLICT', 'SERVICE_UNAVAILABLE'].includes(String(e.code))) needsReload.value = true }
async function save() {
  if (locked.value || needsReload.value) return
  const minute = minuteText.value.trim() === '' ? null : Number(minuteText.value)
  if (minute !== null && (!/^\d{1,3}$/.test(minuteText.value.trim()) || minute > 150)) { error.value = '比赛分钟应为0–150，留空表示赛场动态。'; return }
  if (!form.text.trim() && !form.images.length) { error.value = '请填写直播文字或添加图片。'; return }
  const serial = generation, id = matchId.value, chosen = selected.value
  const payload: LiveForm = { text: form.text, minute, images: form.images.map(i => ({ imageId: i.imageId || null, url: i.imageId ? '' : i.url, caption: i.caption })) }
  busy.value = true; error.value = ''; notice.value = ''
  try {
    await props.auth.authorized((api, token) => chosen ? api.correctLive(token, id, chosen.id, chosen.version!, requestId.value, payload) : api.publishLive(token, id, requestId.value, payload))
    if (serial !== generation) return
    notice.value = hidden.value ? '直播已保存，赛事公开后客户端可见。' : chosen ? '直播已更正，客户端下次刷新时更新。' : '直播已发布，客户端下次刷新时可见。'
    await load()
  } catch (e) { if (serial === generation) mutationFailed(e) }
  finally { if (serial === generation) busy.value = false }
}
function askDelete(entry: LiveEntry) { if (locked.value) return; clearEditor(); deleting.value = entry; deleteText.value = ''; requestId.value = freshId(); error.value = '' }
async function remove() {
  if (locked.value || !deleting.value || deleteText.value !== '删除' || needsReload.value) return
  const serial = generation, row = deleting.value; busy.value = true; error.value = ''
  try { await props.auth.authorized((api, token) => api.deleteLive(token, matchId.value, row.id, row.version!, requestId.value)); if (serial !== generation) return; notice.value = '直播已删除，客户端下次刷新时移除。'; await load() }
  catch (e) { if (serial === generation) mutationFailed(e) }
  finally { if (serial === generation) busy.value = false }
}
function move(index: number, offset: number) { const target = index + offset; if (locked.value || target < 0 || target >= form.images.length) return; const [image] = form.images.splice(index, 1); form.images.splice(target, 0, image) }
async function cleanImages(dryRun = true, next = false) {
  if (locked.value) return
  const start = next ? cleanup.value?.nextCursor || undefined : dryRun ? undefined : cleanupCursor.value
  cleanupBusy.value = true; cleanupError.value = ''; confirmCleanup.value = false
  try { cleanup.value = await props.auth.authorized((api, token) => api.cleanupLiveImages(token, dryRun, start)); cleanupCursor.value = start }
  catch (e) { cleanupError.value = explain(e) }
  finally { cleanupBusy.value = false }
}
async function readImageConfig() {
  try { const c = await props.auth.authorized((api, token) => api.liveImageConfig(token)); if (!alive) return; uploadsEnabled.value = c.enabled; uploadNotice.value = c.enabled ? '支持JPG/PNG本地上传。图片上传后需发布直播才会关联。' : '本地图片上传尚未开放，可使用已有HTTPS图片地址。' }
  catch { if (alive) { uploadsEnabled.value = false; uploadNotice.value = '图片上传配置暂不可用，可刷新工作区重试或使用已有HTTPS图片地址。' } }
}
onMounted(() => { void initialize() })
onUnmounted(() => { generation++; alive = false })
</script>
<template>
  <section class="match-live-admin">
    <div class="workspace-heading"><div><span class="eyebrow">赛场内容</span><h1>图文赛事直播</h1><p class="muted">按比赛发布赛场动态，支持更正、删除和图片上传。</p></div><button class="secondary-button" :disabled="locked" @click="initialize">重新加载工作区</button></div>
    <div class="competition-filters live-admin-filters"><label>选择直播赛事<select aria-label="选择直播赛事" v-model="competitionId" :disabled="locked" @change="chooseCompetition"><option v-if="!competitions.length" value="">暂无赛事</option><option v-for="c in competitions" :key="c.id" :value="c.id">{{ c.name }}{{ c.displayEnabled ? '' : '（未公开）' }}</option></select></label><label>选择直播比赛<select aria-label="选择直播比赛" v-model="matchId" :disabled="locked || !matches.length" @change="notice = ''; load()"><option v-if="!matches.length" value="">暂无已排比赛</option><option v-for="m in matches" :key="m.id" :value="m.id">{{ label(m) }}</option></select></label></div>
    <p v-if="hidden" class="notice">当前赛事未公开，直播仅管理员可见。</p><p v-if="error" class="notice" role="alert">{{ error }}</p><p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <div v-if="matchId" class="content-actions live-admin-actions"><button class="primary-button" :disabled="locked" @click="create">发布新动态</button><button class="secondary-button" :disabled="locked" @click="load()">重新读取直播</button></div>
    <form v-if="editor" class="account-card competition-form live-admin-editor" @submit.prevent="save">
      <h2>{{ selected ? '更正直播动态' : '发布直播动态' }}</h2><p class="muted">文字最多1000字，图片最多4张。留空分钟可发布赛前、赛后动态。</p>
      <label>比赛分钟<input v-model="minuteText" type="text" inputmode="numeric" maxlength="3" placeholder="例如 35，留空为赛场动态" :disabled="busy || needsReload" /></label>
      <label>直播文字<textarea v-model="form.text" maxlength="1000" rows="5" placeholder="记录这场比赛的精彩瞬间…" :disabled="busy || needsReload" /></label><p class="muted">{{ Array.from(form.text).length }}/1000</p>
      <p class="muted">{{ uploadNotice }}</p>
      <div v-for="(image, index) in form.images" :key="key(image)" class="live-admin-image">
        <NewsImageInput :auth="auth" :article-id="ownerId" scope="live" :label="`直播图${index + 1}`" :url="image.url" :image-id="image.imageId" :enabled="uploadsEnabled" :disabled="busy || needsReload" @change="changeImage(image, $event)" @pending="pending(key(image), $event)" />
        <label>图片{{ index + 1 }}说明<input v-model="image.caption" maxlength="100" :disabled="busy || needsReload" /></label>
        <div class="content-actions"><button type="button" class="secondary-button" :disabled="locked || needsReload || index === 0" @click="move(index, -1)">上移图片{{ index + 1 }}</button><button type="button" class="secondary-button" :disabled="locked || needsReload || index === form.images.length - 1" @click="move(index, 1)">下移图片{{ index + 1 }}</button><button type="button" class="secondary-button" :disabled="locked || needsReload" @click="form.images.splice(index, 1)">移除图片{{ index + 1 }}</button></div>
      </div>
      <button v-if="form.images.length < 4" type="button" class="secondary-button" :disabled="locked || needsReload" @click="form.images.push({ url: '', caption: '', imageId: null })">添加直播图片</button>
      <p v-if="imagePending" role="status" class="notice">请等待图片上传完成，失败时可重试或取消本次选择。</p><p v-if="needsReload" role="alert" class="notice">请先点击“重新读取直播”确认云端结果，再继续编辑。</p>
      <div class="content-actions"><button class="primary-button" :disabled="locked || needsReload">{{ busy ? '保存中…' : selected ? '保存直播更正' : '确认发布直播' }}</button><button type="button" class="secondary-button" :disabled="locked" @click="clearEditor">取消编辑</button></div>
    </form>
    <div v-if="deleting" class="account-card live-delete-confirm competition-form" role="dialog" aria-label="删除直播确认"><h2>删除这条直播</h2><p>{{ deleting.text || '图片动态' }}</p><label>输入“删除”确认<input v-model="deleteText" :disabled="busy || needsReload" /></label><div class="content-actions"><button class="primary-button" :disabled="locked || needsReload || deleteText !== '删除'" @click="remove">确认删除直播</button><button class="secondary-button" :disabled="locked" @click="deleting = null">取消删除</button></div></div>
    <p v-if="busy" role="status" class="muted">正在读取或保存直播…</p><p v-else-if="matchId && !entries.length && !error" class="account-card muted">本场暂无直播动态，点击“发布新动态”开始记录。</p><p v-else-if="!matchId && !error" class="account-card muted">请先在“赛程与对阵”创建比赛，再发布直播。</p>
    <article v-for="entry in entries" :key="entry.id" class="account-card live-admin-entry" :data-live-id="entry.id"><div class="card-heading"><h2>{{ entry.minute === null ? '赛场动态' : `${entry.minute}′` }}</h2><span class="muted">{{ matchTime(entry.createdAt) }}{{ entry.corrected ? ' · 已更正' : '' }}</span></div><p class="live-entry-copy">{{ entry.text }}</p><div class="live-admin-gallery"><figure v-for="(image, index) in entry.images" :key="index"><img :src="image.url" :alt="image.caption || '直播图片'"/><figcaption>{{ image.caption }}</figcaption></figure></div><div class="content-actions"><button class="secondary-button" :disabled="locked" @click="edit(entry)">更正直播</button><button class="secondary-button" :disabled="locked" @click="askDelete(entry)">删除直播</button></div></article>
    <button v-if="cursor" class="secondary-button" :disabled="locked" @click="load(true)">加载更早直播</button>
    <details class="account-card live-image-maintenance"><summary>直播图片维护</summary><p class="muted">已发布直播引用的图片受保护。未使用、替换或删除后的图片保留24小时，之后可清理。</p><div class="content-actions"><button class="secondary-button" :disabled="locked" @click="cleanImages(true)">检查待清理直播图片</button><button v-if="cleanup?.nextCursor" class="secondary-button" :disabled="locked" @click="cleanImages(true, true)">检查下一页直播图片</button><button v-if="cleanup && cleanup.eligibleObjects > 0" class="secondary-button" :disabled="locked" @click="confirmCleanup = true">清理到期直播图片</button></div><p v-if="cleanup" role="status">已检查 {{ cleanup.scanned }} 张图片 · 可清理 {{ cleanup.eligibleObjects }} 个文件 · 已删除 {{ cleanup.removedObjects }} 个文件 · 保护 {{ cleanup.protectedImages }} 张图片 · 暂缓 {{ cleanup.deferredImages }} 张图片</p><p v-if="cleanupError" role="alert" class="notice">{{ cleanupError }}</p><div v-if="confirmCleanup"><p>确认清理当前页到期且未引用的直播图片？</p><button class="primary-button" :disabled="locked" @click="cleanImages(false)">确认清理直播图片</button><button class="secondary-button" :disabled="locked" @click="confirmCleanup = false">取消清理</button></div></details>
  </section>
</template>
