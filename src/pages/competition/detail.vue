<script setup lang="ts">
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import AppShell from '@/components/AppShell.vue'
import { getPublicCompetition } from '@/services/competitions'
import { competitionTime, formatLabel, registrationLabels, type PublicCompetition } from '@/domain/competition'
const record = ref<PublicCompetition | null>(null), error = ref(''), loading = ref(false)
let id = '', request = 0
onLoad(query => { id = query?.id || '' })
onShow(() => { void load() })
async function load() {
  const current = ++request
  record.value = null; error.value = ''; loading.value = true
  try { const value = await getPublicCompetition(id); if (current === request) record.value = value }
  catch (e) { if (current === request) error.value = e instanceof Error ? e.message : '赛事加载失败，请重试。' }
  finally { if (current === request) loading.value = false }
}
function register() { uni.navigateTo({url:'/pages/registration/manage?competitionId='+id}) }
function myRegistrations() { uni.navigateTo({url:'/pages/registration/mine'}) }
function back() { uni.navigateBack({ fail: () => uni.reLaunch({ url: '/pages/index/index?tab=tournament' }) }) }
</script>
<template>
  <AppShell active="tournament" detail live><view class="inner-page competition-detail">
    <view class="section-heading"><button class="ui-button text-button" @click="back">← 返回赛事列表</button><button class="ui-button text-button" :disabled="loading" @click="load">刷新赛事</button></view>
    <view v-if="loading" class="panel competition-empty"><text>正在加载赛事…</text></view>
    <view v-else-if="error" class="panel competition-empty" role="alert"><text>{{ error }}</text><button class="ui-button outline-button" @click="load">重新加载赛事</button></view>
    <template v-else-if="record">
      <view class="panel competition-intro">
        <view class="competition-meta"><text class="format-tag">{{ formatLabel(record.format) }}</text><text class="registration-status" :class="record.registrationStatus">{{ registrationLabels[record.registrationStatus] }}</text></view>
        <text class="page-title">{{ record.name }}</text>
        <view class="competition-facts"><view><text class="fact-label">赛事日期</text><text>{{ record.startDate }} — {{ record.endDate }}</text></view><view><text class="fact-label">比赛地点</text><text>{{ record.venue }}</text></view></view>
        <view class="competition-copy-section"><text class="h2">赛事介绍</text><text class="competition-body">{{ record.description }}</text></view>
      </view>
      <view class="competition-detail-grid">
        <view class="panel competition-info"><view class="info-section-heading"><text class="info-section-number">01</text><view><text class="h2">赛制说明</text><text class="section-subtitle">了解比赛形式与规则</text></view></view><text class="competition-body">{{ record.formatDescription }}</text></view>
        <view class="panel competition-info"><view class="info-section-heading"><text class="info-section-number">02</text><view><text class="h2">参赛要求</text><text class="section-subtitle">报名前请核对参赛条件</text></view></view><text class="competition-body">{{ record.registrationRequirements }}</text></view>
      </view>
      <view class="panel competition-info registration-info"><view class="info-section-heading"><text class="info-section-number">03</text><view><text class="h2">报名安排</text><text class="section-subtitle">以下时间均为北京时间</text></view></view><text class="registration-status" :class="record.registrationStatus">{{ registrationLabels[record.registrationStatus] }}</text><view class="competition-facts"><view><text class="fact-label">报名开始</text><text>{{ competitionTime(record.registrationStartAt) }}</text></view><view><text class="fact-label">报名截止</text><text>{{ competitionTime(record.registrationEndAt) }}</text></view></view><view v-if="record.registrationConfig" class="competition-facts"><view><text class="fact-label">报名项目</text><text>{{ record.registrationConfig.projects.join('、') }}</text></view><view><text class="fact-label">参赛规模</text><text>{{ record.registrationConfig.teamLimit===null?'球队不限额':`球队上限${record.registrationConfig.teamLimit}支` }} · 每队{{ record.registrationConfig.minPlayers }}–{{ record.registrationConfig.maxPlayers }}人</text></view></view><text class="info-note">领队填写报名信息并上传材料，后台审核通过后确认参赛。截止前可修改或撤销，截止后锁定。</text><button class="ui-button primary-button" :disabled="record.registrationStatus!=='open'" @click="register">{{ record.registrationStatus==='open'?'为我的球队报名':registrationLabels[record.registrationStatus] }}</button><button class="ui-button text-button" @click="myRegistrations">查看我的报名</button></view>
    </template>
  </view></AppShell>
</template>
