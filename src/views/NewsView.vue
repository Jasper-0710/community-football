<script setup lang="ts">
// Remove native component hosts so flex/grid layout matches H5; accept app-level design classes.
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { ref, computed } from 'vue'
import type { Tournament } from '@/domain/types'
import { dateLabel } from '@/domain/tournament'
import AppIcon from '@/components/AppIcon.vue'
const props = defineProps<{ data: Tournament }>()
const category = ref('全部动态')
const categories = ['全部动态', '公告', '战报', '故事', '快讯']
const articles = computed(() => props.data.articles.filter(a => category.value === '全部动态' || a.category === category.value).sort((a, b) => b.date.localeCompare(a.date)))
function open(id: string) { uni.navigateTo({ url: `/pages/article/detail?id=${id}` }) }
</script>
<template><view class="inner-page"><view class="page-heading"><view><text class="eyebrow">BEYOND THE PITCH</text><text class="page-title">绿茵场内外。</text><text class="page-description">记录赛场的高光，也记录平凡的热爱。</text></view><view class="page-emblem"><AppIcon name="news" tone="green" :size="42" /></view></view><view class="category-filters"><button hover-class="none" role="button" tabindex="0" v-for="item in categories" :key="item" class="ui-button filter-chip" :class="{ active: category === item }" @click="category = item">{{ item }}</button></view><view class="news-feed"><button hover-class="none" role="button" tabindex="0" v-for="article in articles" :key="article.id" class="ui-button news-item" @click="open(article.id)"><view class="news-item-content"><view class="news-item-tags"><text class="category-tag">{{ article.category }}</text><text v-if="article.featured" class="pinned">精选</text></view><text class="news-item-title">{{ article.title }}</text><text class="news-item-excerpt">{{ article.excerpt }}</text><view class="story-meta"><text>{{ article.author }}</text><text>{{ dateLabel(article.date) }}</text></view></view><image v-if="article.image" class="news-item-image" :src="article.image" mode="aspectFill"/><view v-else class="news-item-art"><AppIcon :name="article.category === '公告' ? 'bell' : 'ball'" :size="42" tone="green"/><text>{{ article.category === '公告' ? 'MATCHDAY NOTICE' : 'COMMUNITY NEWS' }}</text></view></button></view></view></template>
