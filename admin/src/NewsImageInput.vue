<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import type { createAdminAuth } from './auth'
import { prepareNewsImage, uploadNewsImage, type NewsImageDraft } from './news-images'
import { uploadLiveImage } from './live-images'
const props = defineProps<{ auth: ReturnType<typeof createAdminAuth>; articleId: string; label: string; url: string; imageId?: string | null; enabled: boolean; disabled?: boolean; required?: boolean; scope?: 'news' | 'live' }>()
const emit = defineEmits<{ change: [value: { id: string | null; url: string }]; pending: [value: boolean] }>()
const candidate = ref<NewsImageDraft | null>(null), preview = ref(''), error = ref(''), running = ref(false), broken = ref(false)
let generation = 0
const explain = (e: unknown) => e instanceof Error ? e.message : '图片上传失败，请重试。'
function clear() { if (preview.value) URL.revokeObjectURL(preview.value); preview.value = ''; candidate.value = null }
function cancel() { generation++; running.value = false; clear(); error.value = ''; emit('pending', false) }
async function upload() {
  if (!candidate.value || running.value || props.disabled) return
  const serial = ++generation, articleId = props.articleId
  running.value = true; error.value = ''; emit('pending', true)
  try {
    const result = await (props.scope === 'live' ? uploadLiveImage : uploadNewsImage)(candidate.value, articleId, props.auth.authorized, () => serial === generation && articleId === props.articleId)
    if (serial !== generation) return
    emit('change', { id: result.id, url: result.url }); broken.value = false; clear(); emit('pending', false)
  } catch (e) { if (serial === generation) error.value = explain(e) }
  finally { if (serial === generation) running.value = false }
}
async function choose(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''
  if (!file || props.disabled || running.value) return
  cancel(); const serial = ++generation; running.value = true; emit('pending', true)
  try {
    const draft = await prepareNewsImage(file)
    if (serial !== generation) return
    candidate.value = draft; preview.value = URL.createObjectURL(file); running.value = false; await upload()
  } catch (e) { if (serial === generation) { error.value = explain(e); running.value = false; emit('pending', false) } }
}
async function refresh() {
  if (!props.imageId || running.value) return
  const serial = ++generation; running.value = true; error.value = ''
  try {
    const result = props.scope === 'live'
      ? await props.auth.authorized((api, token) => api.liveImage(token, props.imageId!, props.articleId))
      : await props.auth.authorized((api, token) => api.newsImage(token, props.imageId!, props.articleId))
    if (serial === generation) { emit('change', { id: result.id, url: result.url }); broken.value = false }
  } catch (e) { if (serial === generation) error.value = explain(e) }
  finally { if (serial === generation) running.value = false }
}
function external(event: Event) { broken.value = false; emit('change', { id: null, url: (event.target as HTMLInputElement).value }) }
function remove() { cancel(); broken.value = false; emit('change', { id: null, url: '' }) }
onUnmounted(() => { generation++; clear(); emit('pending', false) })
</script>
<template>
  <div class="news-image-input">
    <div class="news-image-heading"><strong>{{ label }}图片</strong><span class="muted">JPG / PNG · ≤2MB · 边长≤4096 · ≤800万像素</span></div>
    <div v-if="preview || url" class="news-image-preview">
      <img v-if="preview || !broken" :src="preview || url" :alt="`${label}预览`" @error="broken = true" />
      <p v-else class="muted">图片暂时无法显示，可刷新访问链接。</p>
      <span>{{ candidate ? '待上传图片预览' : imageId ? '已上传到云存储，保存内容后关联' : '外部图片预览' }}</span>
    </div>
    <div class="content-actions">
      <label class="news-image-choose" :class="{ unavailable: !enabled || disabled || running }">{{ url ? '选择替换图片' : '选择本地图片' }}<input type="file" :aria-label="`${label}上传图片`" accept="image/png,image/jpeg,.png,.jpg,.jpeg" :disabled="!enabled || disabled || running" @change="choose" /></label>
      <button v-if="imageId && !candidate" type="button" class="secondary-button" :disabled="disabled || running" @click="refresh">刷新图片链接</button>
      <button v-if="url && !candidate" type="button" class="secondary-button" :disabled="disabled || running" @click="remove">移除{{ label }}图片</button>
    </div>
    <div v-if="candidate" class="news-image-progress" role="status">
      <p>{{ candidate.name }} · {{ Math.ceil(candidate.size / 1024) }}KB</p><progress :value="candidate.progress" max="100" :aria-label="`${label}上传进度`" /><p>{{ running ? `正在上传 ${candidate.progress}%…` : '上传未完成，原图片保留。请重试或取消本次选择后保存。' }}</p>
      <div class="content-actions"><button v-if="!running" type="button" class="secondary-button" :disabled="disabled" @click="upload">重试上传</button><button type="button" class="secondary-button" :disabled="disabled" @click="cancel">取消本次选择</button></div>
    </div>
    <p v-else-if="running" role="status" class="muted">正在处理图片…</p>
    <p v-if="error" class="news-image-error" role="alert">{{ error }}</p>
    <label v-if="!imageId">{{ label === '封面' ? '封面HTTPS地址' : '图片HTTPS地址' }}<input :value="url" type="url" maxlength="500" :required="required" :disabled="disabled || !!candidate || running" placeholder="https://…（也可使用已有图片）" @input="external" /></label>
  </div>
</template>
