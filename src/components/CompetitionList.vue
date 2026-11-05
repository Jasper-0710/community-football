<script setup lang="ts">
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { onMounted } from 'vue'
import { useCompetitions } from '@/composables/useCompetitions'
import { formatLabel, registrationLabels } from '@/domain/competition'
const { competitions, error, loading, cursor, load } = useCompetitions()
onMounted(() => { void load() })
function open(id: string) { uni.navigateTo({ url: `/pages/competition/detail?id=${encodeURIComponent(id)}` }) }
</script>
<template>
  <view class="public-competitions">
    <view class="section-heading section-heading-box"><view><text class="section-title">赛事信息</text><text class="section-subtitle">赛事介绍、参赛要求与报名时间</text></view><button class="ui-button text-button" :disabled="loading" @click="load()">刷新赛事</button></view>
    <view v-if="error" class="panel competition-empty" role="alert"><text>{{ error }}</text><button class="ui-button outline-button" @click="load()">重新加载赛事</button></view>
    <view v-else-if="loading && !competitions.length" class="panel competition-empty"><text>正在加载赛事…</text></view>
    <view v-else-if="!competitions.length" class="panel competition-empty"><text class="h3">暂无公开赛事</text><text class="muted">赛事发布后会在这里展示。</text></view>
    <view v-else class="public-competition-grid"><button v-for="item in competitions" :key="item.id" class="ui-button panel public-competition-card" :data-competition-id="item.id" @click="open(item.id)"><view class="competition-meta"><text>{{ formatLabel(item.format) }}</text><text class="registration-status" :class="item.registrationStatus">{{ registrationLabels[item.registrationStatus] }}</text></view><text class="competition-name">{{ item.name }}</text><text class="competition-summary">{{ item.description }}</text><view class="competition-facts"><view><text class="fact-label">赛事日期</text><text>{{ item.startDate }} — {{ item.endDate }}</text></view><view><text class="fact-label">比赛地点</text><text>{{ item.venue }}</text></view></view><text class="competition-link">查看赛事详情 →</text></button></view>
    <button v-if="cursor" class="ui-button outline-button competition-more" :disabled="loading" @click="load(true)">{{ loading ? '正在加载…' : '加载更多赛事' }}</button>
  </view>
</template>
