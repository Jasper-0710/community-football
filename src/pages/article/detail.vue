<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useTournament } from '@/composables/useTournament'
import { dateLabel } from '@/domain/tournament'
import AppShell from '@/components/AppShell.vue'
import AppIcon from '@/components/AppIcon.vue'
const { data, error, load } = useTournament()
const id = ref('')
onLoad(query => { id.value = query?.id || '' })
const article = computed(() => data.value?.articles.find(a => a.id === id.value))
function back() { uni.navigateBack({ fail: () => uni.reLaunch({ url: '/pages/index/index?tab=news' }) }) }
</script>
<template><AppShell active="news" detail><view v-if="article" class="article-page"><button hover-class="none" role="button" tabindex="0" class="ui-button breadcrumb" @click="back"><AppIcon name="back" :size="15"/>返回动态</button><view class="article-header"><text class="category-tag">{{ article.category }}</text><text class="article-title">{{ article.title }}</text><view class="article-meta"><text>{{ article.author }}</text><text>{{ dateLabel(article.date, true) }}</text><text class="demo-pill">演示内容</text></view></view><image v-if="article.image" :src="article.image" mode="aspectFill" class="article-cover"/><view class="article-body"><text v-for="(paragraph, i) in article.paragraphs" :key="i" :class="{ 'article-notice': i === 0 }">{{ paragraph }}</text></view><view class="article-end"><AppIcon name="ball" tone="green" :size="25"/><text>邻里有球，生活有光。</text><button hover-class="none" role="button" tabindex="0" class="ui-button outline-button" @click="back">继续阅读<AppIcon name="arrow" :size="17"/></button></view></view><view v-else class="empty-state"><text>{{ error || (data ? '这篇内容暂时找不到了' : '正在加载文章…') }}</text><button hover-class="none" role="button" tabindex="0" v-if="error" class="ui-button primary-button" @click="load">重新加载</button><button hover-class="none" role="button" tabindex="0" v-else-if="data" class="ui-button outline-button" @click="back">返回动态</button></view></AppShell></template>
