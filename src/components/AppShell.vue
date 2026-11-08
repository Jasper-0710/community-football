<script setup lang="ts">
// Remove native component hosts so flex/grid layout matches H5; accept app-level design classes.
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { ref } from 'vue'
import type { Tab } from '@/domain/types'
import AppIcon from './AppIcon.vue'
import SearchPanel from './SearchPanel.vue'
const props = withDefaults(defineProps<{ active?: Tab; root?: boolean; detail?: boolean; live?: boolean }>(), { active: 'home', root: false, detail: false, live: false })
const emit = defineEmits<{ navigate: [tab: Tab] }>()
const searchOpen = ref(false)
const tabs: { id: Tab; name: string; icon: string }[] = [{ id: 'home', name: '首页', icon: 'home' }, { id: 'tournament', name: '赛事', icon: 'calendar' }, { id: 'news', name: '动态', icon: 'news' }, { id: 'stats', name: '数据', icon: 'trophy' }, { id: 'profile', name: '我的', icon: 'user' }]
let safeTop = 0
// #ifdef MP-WEIXIN
safeTop = uni.getWindowInfo().statusBarHeight ?? 20
// #endif
function navigate(tab: Tab) { if (props.root) emit('navigate', tab); else uni.reLaunch({ url: `/pages/index/index?tab=${tab}` }) }
function back() { uni.navigateBack({ fail: () => uni.reLaunch({ url: '/pages/index/index' }) }) }
</script>
<template>
  <view class="app-shell" :class="{ 'detail-shell': detail }" :style="{ '--safe-top': `${safeTop}px` }">
    <view class="site-header"><view class="header-inner">
      <button hover-class="none" role="button" tabindex="0" v-if="detail" class="ui-button icon-button mobile-back" aria-label="返回上一页" @click="back"><AppIcon name="back" /></button>
      <button hover-class="none" role="button" tabindex="0" class="ui-button brand" aria-label="中国社超上海赛区赛事平台首页" @click="navigate('home')"><image src="/static/brand.png" class="brand-mark" mode="aspectFit" /><view class="brand-copy"><text class="brand-title">中国社超</text><text class="brand-subtitle">上海赛区赛事平台</text></view></button>
      <view class="desktop-nav"><button hover-class="none" role="button" tabindex="0" v-for="tab in tabs" :key="tab.id" class="ui-button nav-item" :class="{ active: active === tab.id }" @click="navigate(tab.id)">{{ tab.name }}<view v-if="active === tab.id" class="nav-dot" /></button></view>
      <view class="header-actions"><view class="region-label"><AppIcon name="pin" :size="15" /><text>上海赛区</text></view><text v-if="!live" class="demo-pill">开发预览</text><button hover-class="none" role="button" tabindex="0" v-if="!live" class="ui-button icon-button search-trigger" aria-label="搜索" @click="searchOpen = true"><AppIcon name="search" :size="21" /></button></view>
    </view></view>
    <view class="main-content"><slot /></view>
    <view class="site-footer"><view class="footer-inner"><view class="footer-brand"><image src="/static/brand.png" mode="aspectFit" /><text>邻里有球，生活有光。</text></view><text>中国社超上海赛区赛事平台</text><text class="footer-prototype">{{ live ? '赛事信息以最新发布为准' : '开发预览 / 示例区数据为模拟' }}</text></view></view>
    <view v-if="!detail" class="mobile-nav"><button hover-class="none" role="button" tabindex="0" v-for="tab in tabs" :key="tab.id" class="ui-button mobile-nav-item" :class="{ active: active === tab.id }" @click="navigate(tab.id)"><AppIcon :name="tab.icon" :tone="active === tab.id ? 'green' : 'muted'" :size="22" /><text>{{ tab.name }}</text></button></view>
    <SearchPanel v-if="searchOpen" @close="searchOpen = false" />
  </view>
</template>
