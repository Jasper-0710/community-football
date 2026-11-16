<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { newsCategories, type NewsArticle, type NewsForm, type NewsBlock, type ContentCategory } from '../../src/domain/content'
import type { NewsImageCleanup } from '../../src/domain/news-image'
import NewsImageInput from './NewsImageInput.vue'
import type { AdminCompetition } from '../../src/domain/competition'
import type { createAdminAuth } from './auth'
const props = defineProps<{ auth: ReturnType<typeof createAdminAuth>; initialId?: string }>()
const articles = ref<NewsArticle[]>([]), competitions = ref<AdminCompetition[]>([]), selected = ref<NewsArticle | null>(null), cursor = ref<string | null>(null)
const category = ref<ContentCategory | ''>(''), busy = ref(false), error = ref(''), notice = ref(''), editor = ref(false), deleting = ref(false), deleteName = ref('')
const empty = (): NewsForm => ({ title: '', category: '快讯', excerpt: '', author: '赛事运营', coverUrl: '', coverImageId: null, body: [{ type: 'text', text: '' }], status: 'draft', pinned: false, competitionId: null })
const form = reactive<NewsForm>(empty())
const saveNeedsReload = ref(false)
const requestId = ref(''), uploadsEnabled = ref(false), uploadNotice = ref('正在读取图片上传配置…'), pendingImages = reactive(new Set<string>()), cleanup = ref<NewsImageCleanup | null>(null), cleanupBusy = ref(false), cleanupError = ref(''), cleanupCursor = ref<string | undefined>()
const imagePending = computed(() => pendingImages.size > 0), articleId = computed(() => selected.value?.id || `n_${requestId.value}`)
const blockKeys = new WeakMap<NewsBlock, string>(); let blockSequence = 0, generation = 0
function blockKey(block: NewsBlock) { if (!blockKeys.has(block)) blockKeys.set(block, `body-${++blockSequence}`); return blockKeys.get(block)! }
function pending(key: string, value: boolean) { if (value) pendingImages.add(key); else pendingImages.delete(key) }
function changeImage(block: NewsBlock, image: { id: string | null; url: string }) { if (block.type === 'image') { block.imageId = image.id; block.url = image.url } }
async function cleanImages(dryRun = true, next = false) {
  if (cleanupBusy.value || imagePending.value) return
  cleanupBusy.value = true; cleanupError.value = ''
  if (next) cleanupCursor.value = cleanup.value?.nextCursor || undefined
  try { cleanup.value = await props.auth.authorized((api, token) => api.cleanupNewsImages(token, dryRun, cleanupCursor.value)) }
  catch (e) { cleanup.value = null; cleanupError.value = explain(e) }
  finally { cleanupBusy.value = false }
}
const explain = (e: unknown) => e instanceof Error ? e.message : '内容服务暂不可用，请重试。'
async function load(more = false) {
  if (imagePending.value) return
  const serial = ++generation; busy.value = true; error.value = ''; editor.value = false; deleting.value = false; selected.value = null
  saveNeedsReload.value = false
  if (!more) { articles.value = []; cursor.value = null }
  try { const p = await props.auth.authorized((api, token) => api.news(token, category.value || undefined, more ? cursor.value || undefined : undefined)); if (serial === generation) { articles.value = more ? [...articles.value, ...p.articles] : p.articles; cursor.value = p.nextCursor } }
  catch (e) { if (serial === generation) { articles.value = []; cursor.value = null; error.value = explain(e) } }
  finally { if (serial === generation) busy.value = false }
}
async function open(id: string) {
  saveNeedsReload.value = false
  const serial = ++generation; busy.value = true; error.value = ''; notice.value = ''; selected.value = null; editor.value = false; deleting.value = false
  try {
    const a = await props.auth.authorized((api, token) => api.article(token, id))
    if (serial !== generation) return
    selected.value = a; Object.assign(form, { title: a.title, category: a.category, excerpt: a.excerpt, author: a.author, coverUrl: a.coverUrl, coverImageId: a.coverImageId || null, body: a.body!.map(b => ({ ...b })), status: a.status, pinned: a.pinned, competitionId: a.competitionId }); editor.value = true
  } catch (e) { if (serial === generation) error.value = explain(e) }
  finally { if (serial === generation) busy.value = false }
}
function create() { if (imagePending.value) return; generation++; saveNeedsReload.value = false; selected.value = null; Object.assign(form, empty()); requestId.value = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join(''); editor.value = true; error.value = ''; notice.value = ''; deleting.value = false }
async function save() {
  if (busy.value || imagePending.value || saveNeedsReload.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const payload = JSON.parse(JSON.stringify(form)) as NewsForm
    if (payload.coverImageId) payload.coverUrl = ''
    for (const block of payload.body) if (block.type === 'image' && block.imageId) block.url = ''
    const a = await props.auth.authorized((api, token) => selected.value ? api.updateNews(token, selected.value.id, selected.value.version!, payload) : api.createNews(token, requestId.value, payload))
    selected.value = a; notice.value = a.status === 'published' ? '内容已发布，公开列表、首页和搜索将读取最新内容。' : '草稿已保存，仅管理员可见。'
    await load()
  } catch (e) { error.value = explain(e); if (e && typeof e === 'object' && 'code' in e && e.code === 'WRITE_COMMITTED') saveNeedsReload.value = true } finally { busy.value = false }
}
async function remove() {
  if (!selected.value || busy.value || imagePending.value || deleteName.value !== selected.value.title) return
  busy.value = true; error.value = ''
  try { await props.auth.authorized((api, token) => api.deleteNews(token, selected.value!.id, selected.value!.version!)); notice.value = '内容已删除，公开入口不再展示。'; await load() }
  catch (e) { error.value = explain(e) } finally { busy.value = false }
}
function move(index: number, delta: number) { const target = index + delta; if (target < 0 || target >= form.body.length) return; const [block] = form.body.splice(index, 1); form.body.splice(target, 0, block) }
onMounted(async () => {
  void props.auth.authorized((api, token) => api.newsImageConfig(token)).then(config => { uploadsEnabled.value = config.enabled; uploadNotice.value = config.enabled ? '图片上传后需保存内容才会关联。未保存或替换后的图片保留24小时，之后可检查清理。' : '当前环境尚未开放本地图片上传，仍可填写已有HTTPS地址。' }).catch(() => { uploadNotice.value = '图片上传配置暂不可用，仍可使用已有HTTPS地址。' })
  try { let next: string | undefined; do { const p = await props.auth.authorized((api, token) => api.competitions(token, next)); competitions.value.push(...p.competitions); next = p.nextCursor || undefined } while (next) }
  catch (e) { error.value = explain(e); return }
  if (props.initialId) await open(props.initialId); else await load()
})
onUnmounted(() => { generation++ })
</script>
<template>
  <section class="news-admin">
    <div class="workspace-heading"><div><span class="eyebrow">内容发布</span><h1>新闻与公告</h1><p class="muted">维护快讯、战报、公告、深度和独家内容。</p></div><div class="content-actions"><button class="secondary-button" :disabled="busy || imagePending" @click="load()">刷新内容</button><button class="primary-button" :disabled="busy || imagePending" @click="create">新建内容</button></div></div>
    <p v-if="error" class="notice" role="alert">{{ error }}</p><p v-if="notice" class="notice success" role="status">{{ notice }}</p>
    <form v-if="editor" class="account-card competition-form news-editor" @submit.prevent="save">
      <div class="card-heading"><h2>{{ selected ? '编辑内容' : '新建内容' }}</h2><button type="button" class="secondary-button" :disabled="busy || imagePending" @click="load()">返回列表</button></div>
      <fieldset :disabled="busy"><div class="form-grid">
        <label>标题<input v-model="form.title" maxlength="80" required /></label><label>分类<select v-model="form.category" aria-label="分类"><option v-for="c in newsCategories" :key="c">{{ c }}</option></select></label>
        <label>作者<input v-model="form.author" maxlength="40" required /></label><label>发布状态<select v-model="form.status" aria-label="发布状态"><option value="draft">草稿</option><option value="published">已发布</option></select></label>
        <label>关联赛事<select v-model="form.competitionId" aria-label="关联赛事"><option :value="null">全站内容</option><option v-for="c in competitions" :key="c.id" :value="c.id">{{ c.name }}{{ c.displayEnabled ? '' : '（已隐藏）' }}</option></select></label><label>置顶<select v-model="form.pinned" aria-label="置顶"><option :value="false">普通内容</option><option :value="true">置顶</option></select></label>
      </div><label>摘要<textarea v-model="form.excerpt" maxlength="200" rows="2" /></label>
      <p class="muted section-guide">{{ uploadNotice }}</p>
      <NewsImageInput :key="articleId" :auth="auth" :article-id="articleId" label="封面" :url="form.coverUrl" :image-id="form.coverImageId" :enabled="uploadsEnabled" :disabled="busy" @change="form.coverImageId = $event.id; form.coverUrl = $event.url" @pending="pending('cover', $event)" />
      <div class="card-heading"><h3>图文正文</h3><span class="muted">{{ form.body.length }} / 30 段</span></div>
      <div v-for="(block, index) in form.body" :key="blockKey(block)" class="news-block">
        <div class="content-actions"><strong>第{{ index + 1 }}段 · {{ block.type === 'text' ? '文字' : '图片' }}</strong><button type="button" class="secondary-button" :disabled="index === 0" @click="move(index, -1)">上移</button><button type="button" class="secondary-button" :disabled="index === form.body.length - 1" @click="move(index, 1)">下移</button><button type="button" class="secondary-button" :disabled="form.body.length === 1 || pendingImages.has(blockKey(block))" @click="form.body.splice(index, 1)">移除</button></div>
        <label v-if="block.type === 'text'">正文文字<textarea v-model="block.text" rows="5" maxlength="2000" required /></label>
        <template v-else><NewsImageInput :auth="auth" :article-id="articleId" label="正文" :url="block.url" :image-id="block.imageId" :enabled="uploadsEnabled" :disabled="busy" required @change="changeImage(block, $event)" @pending="pending(blockKey(block), $event)" /><label>图片说明<input v-model="block.caption" maxlength="100" /></label></template>
      </div>
      <div class="content-actions"><button type="button" class="secondary-button" :disabled="form.body.length >= 30" @click="form.body.push({ type: 'text', text: '' })">添加文字</button><button type="button" class="secondary-button" :disabled="form.body.length >= 30" @click="form.body.push({ type: 'image', url: '', caption: '' })">添加图片</button><button type="submit" class="primary-button" :disabled="imagePending || saveNeedsReload">{{ busy ? '正在保存…' : '保存内容' }}</button></div>
      <p v-if="imagePending" class="muted" role="status">请等待图片上传完成，或取消尚未完成的选择后保存。</p>
      <p class="muted section-guide">关联赛事隐藏后，文章的公开入口同步隐藏。微信端图片访问域名须按环境配置开放。</p>
      <button v-if="selected" type="button" class="secondary-button" :disabled="imagePending" @click="deleting = !deleting; deleteName = ''">删除此内容</button>
      <div v-if="deleting && selected" class="notice"><label>输入完整标题确认删除<input v-model="deleteName" autocomplete="off" /></label><p>{{ selected.title }}</p><button type="button" class="secondary-button" :disabled="deleteName !== selected.title" @click="remove">确认删除内容</button></div>
      </fieldset>
    </form>
    <aside v-if="!editor" class="account-card news-image-cleanup"><h2>图片存储维护</h2><p class="muted">检查过期未引用图片及上传临时分片。草稿和已发布文章正在使用的图片会保留，每批最多检查20条图片记录。</p><div class="content-actions"><button class="secondary-button" :disabled="cleanupBusy" @click="cleanupCursor = undefined; cleanImages()">检查待清理图片</button><button v-if="cleanup?.dryRun && cleanup.eligibleObjects" class="secondary-button" :disabled="cleanupBusy" @click="cleanImages(false)">清理本批</button><button v-if="cleanup?.nextCursor" class="secondary-button" :disabled="cleanupBusy" @click="cleanImages(true, true)">检查下一批</button></div><p v-if="cleanupBusy" role="status">正在检查图片存储…</p><p v-if="cleanupError" role="alert" class="notice">{{ cleanupError }}</p><p v-if="cleanup" role="status">本批检查{{ cleanup.scanned }}张图片，保留{{ cleanup.protectedImages }}张文章引用图片，{{ cleanup.dryRun ? '可清理' : '本次符合清理条件' }}{{ cleanup.eligibleObjects }}个存储对象，已清理{{ cleanup.removedObjects }}个。<template v-if="cleanup.deferredImages">{{ cleanup.deferredImages }}张图片仍有待处理对象，可稍后重新检查。</template></p></aside>
    <template v-if="!editor"><label class="content-filter">新闻分类<select v-model="category" :disabled="busy" @change="load()"><option value="">全部分类</option><option v-for="c in newsCategories" :key="c">{{ c }}</option></select></label><p v-if="busy" class="account-card" role="status">正在读取内容…</p><p v-else-if="!articles.length && !error" class="account-card competition-empty">暂无内容，点击“新建内容”开始发布。</p><article v-for="a in articles" :key="a.id" class="account-card content-row"><div><div class="record-tags"><span class="status-badge neutral">{{ a.category }}</span><span class="status-badge">{{ a.status === 'published' ? '已发布' : '草稿' }}</span><span v-if="a.pinned" class="status-badge">置顶</span></div><h2>{{ a.title }}</h2><p class="muted">{{ a.excerpt }}</p><small>{{ a.author }} · {{ new Date(a.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }}</small></div><button class="secondary-button" :disabled="busy" @click="open(a.id)">编辑内容</button></article><button v-if="cursor" class="secondary-button" :disabled="busy" @click="load(true)">加载更多内容</button></template>
  </section>
</template>
