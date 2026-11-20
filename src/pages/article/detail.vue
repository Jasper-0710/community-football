<script setup lang="ts">
import {useRecoveryRefresh} from '@/services/public-data'
useRecoveryRefresh(()=>load())
import { ref, onUnmounted } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getPublicNews } from '@/services/content'
import type { NewsArticle } from '@/domain/content'
import AppShell from '@/components/AppShell.vue'
import AppIcon from '@/components/AppIcon.vue'
const id = ref(''), article = ref<NewsArticle | null>(null), error = ref(''), busy = ref(false), failedImages = ref<number[]>([])
let generation = 0
async function load() { const serial = ++generation; article.value = null; failedImages.value = []; error.value = ''; busy.value = true; try { const r = await getPublicNews(id.value); if (serial === generation) article.value = r } catch (e) { if (serial === generation) error.value = e instanceof Error ? e.message : '文章暂不可用。' } finally { if (serial === generation) busy.value = false } }
onLoad(query => { id.value = query?.id || '' }); onShow(() => { void load() }); onUnmounted(() => { generation++ })
function back() { uni.navigateBack({ fail: () => uni.reLaunch({ url: '/pages/index/index?tab=news' }) }) }
function date(value: string | null) { return value ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '' }
</script>
<template><AppShell active="news" detail live>
  <view v-if="article" class="article-page"><button role="button" tabindex="0" hover-class="none" class="ui-button breadcrumb" @click="back"><AppIcon name="back" :size="15"/>返回动态</button><view class="article-header"><text class="category-tag">{{ article.category }}</text><text class="article-title">{{ article.title }}</text><view class="article-meta"><text>{{ article.author }}</text><text>{{ date(article.publishedAt) }}</text><text v-if="article.pinned" class="pinned">置顶</text></view></view>
  <image v-if="article.coverUrl && !failedImages.includes(-1)" :src="article.coverUrl" mode="aspectFill" class="article-cover" @error="failedImages.push(-1)"/>
  <view v-if="failedImages.length" class="empty-state"><text>部分图片暂时无法加载</text><button role="button" tabindex="0" class="ui-button outline-button" :disabled="busy" @click="load">重新加载图片</button></view>
  <view class="article-body"><view v-for="(block, i) in article.body" :key="i" class="article-block"><text v-if="block.type === 'text'">{{ block.text }}</text><template v-else><image v-if="!failedImages.includes(i)" :src="block.url" mode="widthFix" class="article-inline-image" @error="failedImages.push(i)"/><text v-else class="muted">图片暂时无法加载</text><text v-if="block.caption" class="muted small-text">{{ block.caption }}</text></template></view></view>
  <view class="article-end"><AppIcon name="ball" tone="green" :size="25"/><text>邻里有球，生活有光。</text><button role="button" tabindex="0" hover-class="none" class="ui-button outline-button" @click="back">继续阅读<AppIcon name="arrow" :size="17"/></button></view></view>
  <view v-else class="empty-state"><text>{{ error || (busy ? '正在加载文章…' : '文章暂不可用') }}</text><button role="button" tabindex="0" v-if="error" class="ui-button outline-button" @click="load">重新加载文章</button><button role="button" tabindex="0" class="ui-button text-button" @click="back">返回动态</button></view>
</AppShell></template>
