<script setup lang="ts">
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { listPublicLive } from '@/services/match-live'
import { createLiveFeedState } from '@/composables/match-live-state'
import AppIcon from './AppIcon.vue'
import {useRecoveryRefresh} from '@/services/public-data'
useRecoveryRefresh(()=>props.pageActive===false?undefined:refresh())
const props = defineProps<{ matchId: string; pageActive?: boolean }>()
const state = createLiveFeedState(listPublicLive)
const { entries, nextCursor, loading, error, ready, updatedAt, unavailable, historyMode } = state
const active = ref(true), broken = ref<Record<string, boolean>>({})
let timer: ReturnType<typeof setInterval> | undefined
const time = (v: string) => { const d = new Date(Date.parse(v) + 8 * 3600000); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` }
async function refresh() { broken.value = {}; await state.load() }
function start() { stop(); if (active.value) timer = setInterval(() => { if (!loading.value && !unavailable.value && !historyMode.value) void refresh() }, 15_000) }
function stop() { if (timer) clearInterval(timer); timer = undefined }
function resume() {
  if (props.pageActive === false) { pause(); return }
  // #ifdef H5
  if (document.hidden) { pause(); return }
  // #endif
  active.value = true; if (!historyMode.value) void refresh(); start()
}
function pause() { active.value = false; stop() }
// #ifdef H5
function visibility() { document.hidden ? pause() : resume() }
// #endif
function preview(url: string) { uni.previewImage({ urls: entries.value.flatMap(e => e.images.map(i => i.url)), current: url }) }
watch(() => props.matchId, id => { state.reset(id); broken.value = {}; void refresh() }, { immediate: true })
watch(() => props.pageActive, value => { value === false ? pause() : resume() })
onMounted(() => {
  resume()
  // #ifdef H5
  document.addEventListener('visibilitychange', visibility)
  // #endif
})
onUnmounted(() => { pause(); state.reset('');
  // #ifdef H5
  document.removeEventListener('visibilitychange', visibility)
  // #endif
})
</script>
<template>
  <view class="panel match-live-feed">
    <view class="live-feed-heading"><view><text class="h2">图文直播</text><text class="muted small-text">{{ historyMode ? '正在查看更早动态 · 点击刷新返回最新' : '最新动态在前 · 每15秒更新' }}</text></view><button class="ui-button secondary-button" hover-class="none" role="button" :disabled="loading" @click="refresh"><AppIcon name="clock" :size="15"/>{{ loading ? '更新中…' : '刷新直播' }}</button></view>
    <view v-if="error" class="live-feed-error" role="alert"><text>{{ error }}</text><text v-if="entries.length" class="muted small-text">当前显示上次读取的内容</text><button class="ui-button secondary-button" hover-class="none" role="button" :disabled="loading" @click="refresh">重试加载直播</button></view>
    <view v-if="!ready && loading" class="loading-state">正在读取直播动态…</view>
    <view v-else-if="ready && !entries.length && !error" class="empty-state"><AppIcon name="ball" :size="32" tone="muted"/><text>暂无图文直播</text><text class="muted small-text">官方发布赛场动态后会显示在这里</text></view>
    <view v-for="entry in entries" :key="entry.id" class="live-feed-entry" :data-live-id="entry.id">
      <view class="live-entry-heading"><text class="live-entry-minute">{{ entry.minute === null ? '赛场动态' : `${entry.minute}′` }}</text><text class="muted small-text">{{ time(entry.createdAt) }}<text v-if="entry.corrected"> · 已更正</text></text></view>
      <text v-if="entry.text" class="live-entry-text">{{ entry.text }}</text>
      <view v-if="entry.images.length" class="live-entry-images" :class="{ single: entry.images.length === 1 }"><view v-for="(image, index) in entry.images" :key="`${entry.id}-${index}-${image.url}`" class="live-entry-image"><button v-if="!broken[`${entry.id}-${index}`]" class="ui-button live-image-button" hover-class="none" role="button" :aria-label="image.caption || '查看直播图片'" @click="preview(image.url)"><image :src="image.url" mode="aspectFill" :alt="image.caption || '赛场图片'" @error="broken[`${entry.id}-${index}`] = true" /></button><view v-else class="live-image-failed"><text>图片暂不可用</text><text class="muted small-text">刷新直播后重试</text></view><text v-if="image.caption" class="muted small-text live-image-caption">{{ image.caption }}</text></view></view>
    </view>
    <button v-if="nextCursor" class="ui-button secondary-button live-load-more" hover-class="none" role="button" :disabled="loading" @click="state.load(true)">{{ loading ? '加载中…' : '加载更早动态' }}</button>
    <text v-if="updatedAt && !error" class="muted small-text live-feed-updated">本机读取于 {{ time(updatedAt) }} · 图文内容由赛事运营发布</text>
  </view>
</template>
