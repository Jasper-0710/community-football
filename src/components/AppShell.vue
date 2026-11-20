<script setup lang="ts">
// Remove native component hosts so flex/grid layout matches H5; accept app-level design classes.
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import { ref,computed,onMounted,watch } from 'vue'
import type { Tab } from '@/domain/types'
import type {NavigationTarget} from '@/domain/platform-settings'
import {usePlatformSettings} from '@/composables/usePlatformSettings'
import {usePersonalAppearance} from '@/composables/usePersonalAppearance'
import {useUserProfile} from '@/composables/useUserProfile'
import AppIcon from './AppIcon.vue'
import SearchPanel from './SearchPanel.vue'
import RecoveryNotice from './RecoveryNotice.vue'
const props = withDefaults(defineProps<{ active?: Tab; root?: boolean; detail?: boolean; live?: boolean }>(), { active: 'home', root: false, detail: false, live: false })
const emit = defineEmits<{ navigate: [tab: Tab] }>()
const searchOpen = ref(false)
const platform=usePlatformSettings(),tabs=computed(()=>platform.settings.value.form.navigation)
// Restore an intended login on entry so account-specific appearance also applies outside “我的”.
useUserProfile()
const appearance=usePersonalAppearance(),identity=appearance.effective
onMounted(()=>{void platform.refresh()})
// #ifdef MP-WEIXIN
function syncStatusBar() {
  uni.setNavigationBarColor({
    frontColor: identity.value.mode === 'dark' ? '#ffffff' : '#000000',
    backgroundColor: appearance.tokens.value['--surface'],
    fail: () => { /* Appearance remains usable if the host cannot change its status bar. */ },
  })
}
onMounted(syncStatusBar)
watch(() => identity.value.mode, syncStatusBar, { flush: 'post' })
// #endif
let safeTop = 0
// #ifdef MP-WEIXIN
safeTop = uni.getWindowInfo().statusBarHeight ?? 20
// #endif
function navigate(tab: NavigationTarget) {if(tab==='search'){searchOpen.value=true;return}void platform.refresh();if (props.root) emit('navigate', tab); else uni.reLaunch({ url: `/pages/index/index?tab=${tab}` }) }
function back() { uni.navigateBack({ fail: () => uni.reLaunch({ url: '/pages/index/index' }) }) }
</script>
<template>
  <view class="app-shell" :class="{ 'detail-shell': detail,'theme-dark':identity.mode==='dark' }" :style="{...appearance.tokens.value, '--safe-top': `${safeTop}px` }" :data-settings-version="platform.settings.value.version">
    <view class="site-header"><view class="header-inner">
      <button hover-class="none" role="button" tabindex="0" v-if="detail" class="ui-button icon-button mobile-back" aria-label="返回上一页" @click="back"><AppIcon name="back" /></button>
      <button hover-class="none" role="button" tabindex="0" class="ui-button brand" :aria-label="`${identity.title}${identity.subtitle}首页`" @click="navigate('home')"><image src="/static/brand.png" class="brand-mark" mode="aspectFit" /><view class="brand-copy"><text class="brand-title">{{identity.title}}</text><text class="brand-subtitle">{{identity.subtitle}}</text></view></button>
      <view class="desktop-nav"><button hover-class="none" role="button" tabindex="0" v-for="tab in tabs" :key="tab.id" class="ui-button nav-item" :class="{ active: active === tab.id }" @click="navigate(tab.id)">{{ tab.label }}<view v-if="active === tab.id" class="nav-dot" /></button></view>
      <view class="header-actions"><view class="region-label"><AppIcon name="pin" :size="15" /><text>上海赛区</text></view><text v-if="!live" class="demo-pill">开发预览</text><button hover-class="none" role="button" tabindex="0" v-if="!live" class="ui-button icon-button search-trigger" aria-label="搜索" @click="searchOpen = true"><AppIcon name="search" :size="21" /></button></view>
    </view></view>
    <view v-if="platform.error.value" class="settings-sync-notice" role="status"><text>{{platform.error.value}} 当前显示{{platform.settings.value.version?'上次保存的设置':'默认外观'}}。</text><button role="button" tabindex="0" class="ui-button text-button" :disabled="platform.loading.value" @click="platform.refresh">重试同步</button></view>
    <RecoveryNotice /><view class="main-content"><slot /></view>
    <view class="site-footer"><view class="footer-inner"><view class="footer-brand"><image src="/static/brand.png" mode="aspectFit" /><text>邻里有球，生活有光。</text></view><text>{{identity.title}}{{identity.subtitle}}</text><text class="footer-prototype">{{ live ? '赛事信息以最新发布为准' : '开发预览 / 示例区数据为模拟' }}</text></view></view>
    <view v-if="!detail" class="mobile-nav"><button hover-class="none" role="button" tabindex="0" v-for="tab in tabs" :key="tab.id" class="ui-button mobile-nav-item" :class="{ active: active === tab.id }" @click="navigate(tab.id)"><view class="navigation-icon" :class="{'navigation-icon-black':active===tab.id&&appearance.tokens.value['--on-accent']==='#000000'}"><AppIcon :preserve-tone="true" :name="tab.icon" :tone="active===tab.id?(appearance.tokens.value['--on-accent']==='#ffffff'?'white':'ink'):(identity.mode==='dark'?'white':'muted')" :size="22" /></view><text>{{ tab.label }}</text></button></view>
    <SearchPanel v-if="searchOpen" @close="searchOpen = false" />
  </view>
</template>
