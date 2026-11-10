<script setup lang="ts">
import { ref } from 'vue'
import type { createAdminAuth } from './auth'
import type { RegistrationCleanupResult } from './registration-maintenance'
const props = defineProps<{ auth: ReturnType<typeof createAdminAuth> }>()
const result = ref<RegistrationCleanupResult | null>(null)
const busy = ref(false), error = ref(''), pageCursor = ref<string | undefined>()
async function inspect(cursor?: string) {
  if (busy.value) return
  busy.value = true; error.value = ''; result.value = null; pageCursor.value = cursor
  try { result.value = await props.auth.authorized((api, token) => api.cleanupRegistrationFiles(token, true, cursor)) }
  catch (e) { error.value = e instanceof Error ? e.message : '检查失败，请重试。' }
  finally { busy.value = false }
}
async function clean() {
  if (busy.value || !result.value?.dryRun || !result.value.eligibleSessions) return
  busy.value = true; error.value = ''
  try { result.value = await props.auth.authorized((api, token) => api.cleanupRegistrationFiles(token, false, pageCursor.value)) }
  catch (e) { result.value = null; error.value = (e instanceof Error ? e.message : '清理结果暂未确认。') + ' 请重新检查本批材料。' }
  finally { busy.value = false }
}
</script>

<template>
  <details class="account-card material-maintenance">
    <summary><span><strong>报名材料维护</strong><small>检查过期上传、未提交且已移除的附件及中断后遗留的临时文件</small></span></summary>
    <div class="maintenance-body">
      <p class="muted">检查范围覆盖全部赛事，每批最多检查 5 条上传记录、清理 20 个文件。已提交的报名材料及历史材料会保留；上传中的文件会延后处理。</p>
      <p v-if="error" class="notice" role="alert">{{ error }}</p>
      <button class="secondary-button" :disabled="busy" @click="inspect(pageCursor)">{{ busy ? '处理中…' : '检查本批临时材料' }}</button>
      <template v-if="result">
        <div class="maintenance-stats" aria-label="材料维护检查结果">
          <div><span>已检查记录</span><strong>{{ result.scannedSessions }}</strong></div>
          <div><span>可清理文件</span><strong>{{ result.candidateObjects }}</strong></div>
          <div><span>保留的报名材料记录</span><strong>{{ result.retainedSessions }}</strong></div>
          <div><span>稍后处理的上传记录</span><strong>{{ result.deferredSessions }}</strong></div>
        </div>
        <p v-if="result.blockedObjects" class="notice" role="alert">有 {{ result.blockedObjects }} 个文件的登记信息需维护人员核对，已跳过。</p>
        <p v-if="result.dryRun" class="muted">以上是检查结果，尚未删除文件。清理后不会影响球队报名和审核记录。</p>
        <p v-else class="notice success" role="status">本批已清理 {{ result.removedObjects }} 个文件，已关闭 {{ result.cleanedSessions }} 条过期或移除的上传记录。{{ result.failedObjects ? `其中 ${result.failedObjects} 个文件未清理成功，请重新检查后重试。` : '' }}{{ result.retryPage ? '本批仍有待清理文件，请继续检查。' : '' }}</p>
        <div class="maintenance-actions">
          <button v-if="result.dryRun" class="secondary-button danger-button" :disabled="busy || !result.eligibleSessions" @click="clean">清理本批临时材料</button>
          <button v-if="!result.retryPage && result.nextCursor" class="secondary-button" :disabled="busy" @click="inspect(result!.nextCursor!)">检查下一批</button>
          <span v-if="!result.nextCursor && !result.retryPage" class="muted">已检查至最后一批</span>
          <button v-if="pageCursor" class="secondary-button" :disabled="busy" @click="inspect()">从头检查</button>
        </div>
      </template>
    </div>
  </details>
</template>

<style scoped>
.material-maintenance { margin-top: 24px; }
summary { cursor: pointer; font-size: 18px; }
summary span { display: inline-flex; flex-direction: column; gap: 6px; vertical-align: top; max-width: calc(100% - 24px); }
summary small { font-size: 14px; font-weight: 400; color: var(--muted, #526579); line-height: 1.6; }
.maintenance-body { padding-top: 16px; }
.maintenance-body > p { line-height: 1.7; }
.maintenance-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 18px 0; }
.maintenance-stats > div { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid #dce5e9; background: #f6f9fa; border-radius: 12px; }
.maintenance-stats span { font-size: 14px; color: #526579; }
.maintenance-stats strong { font-size: 28px; color: #123e34; }
.maintenance-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 16px; }
@media (max-width: 640px) { .maintenance-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } .maintenance-actions > button { width: 100%; } }
</style>
