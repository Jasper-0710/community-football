<script setup lang="ts">
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { newsCategories, type ContentCategory } from '@/domain/content'
import { useNews } from '@/composables/useNews'
import AppIcon from '@/components/AppIcon.vue'
const { articles, category, cursor, busy, error, load } = useNews()
function filter(value?: ContentCategory) { category.value = value; void load() }
function open(id: string) { uni.navigateTo({ url: `/pages/article/detail?id=${id}` }) }
function date(value: string | null) { return value ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 10) : '' }
</script>
<template>
  <view class="inner-page public-news">
    <view class="page-heading"><view><text class="eyebrow">BEYOND THE PITCH</text><text class="page-title">绿茵场内外。</text><text class="page-description">记录赛场的高光，也记录平凡的热爱。</text></view><view class="page-emblem"><AppIcon name="news" tone="green" :size="42" /></view></view>
    <view class="category-filters"><button role="button" tabindex="0" hover-class="none" class="ui-button filter-chip" :class="{ active: !category }" @click="filter()">全部动态</button><button role="button" tabindex="0" hover-class="none" v-for="item in newsCategories" :key="item" class="ui-button filter-chip" :class="{ active: category === item }" @click="filter(item)">{{ item }}</button><button role="button" tabindex="0" hover-class="none" class="ui-button text-button" :disabled="busy" @click="load()">刷新动态</button></view>
    <view v-if="error" class="empty-state" role="alert"><text>{{ error }}</text><button role="button" tabindex="0" class="ui-button outline-button" @click="load()">重新加载动态</button></view><view v-else-if="busy && !articles.length" class="empty-state"><text>正在加载动态…</text></view><view v-else-if="!articles.length" class="empty-state"><text>暂无已发布内容</text></view>
    <view class="news-feed"><button role="button" tabindex="0" hover-class="none" v-for="article in articles" :key="article.id" class="ui-button news-item" @click="open(article.id)"><view class="news-item-content"><view class="news-item-tags"><text class="category-tag">{{ article.category }}</text><text v-if="article.pinned" class="pinned">置顶</text></view><text class="news-item-title">{{ article.title }}</text><text class="news-item-excerpt">{{ article.excerpt }}</text><view class="story-meta"><text>{{ article.author }}</text><text>{{ date(article.publishedAt) }}</text></view></view><image v-if="article.coverUrl" class="news-item-image" :src="article.coverUrl" mode="aspectFill"/><view v-else class="news-item-art"><AppIcon :name="article.category === '公告' ? 'bell' : 'ball'" :size="42" tone="green"/><text>COMMUNITY NEWS</text></view></button></view>
    <button role="button" tabindex="0" v-if="cursor" class="ui-button outline-button" :disabled="busy" @click="load(true)">{{ busy ? '加载中…' : '加载更多动态' }}</button>
  </view>
</template>
