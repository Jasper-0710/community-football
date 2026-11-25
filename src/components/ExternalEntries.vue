<script setup lang="ts">
defineOptions({ options: { virtualHost:true,styleIsolation:'apply-shared' } })
import {computed,onUnmounted,ref} from 'vue'
import {usePlatformSettings} from '@/composables/usePlatformSettings'
import {publicRecovery} from '@/services/public-data'
import {jumpExternal} from '@/services/external-navigation'
import AppIcon from './AppIcon.vue'
const platform=usePlatformSettings(),external=computed(()=>platform.settings.value.form.external),busy=ref(false),notice=ref('')
const visible=computed(()=>external.value.community.enabled||external.value.insurance.enabled)
const unavailable=computed(()=>!platform.confirmed.value||!!platform.error.value||publicRecovery.readOnly.value)
let disposed=false
async function community(){if(busy.value||unavailable.value)return;busy.value=true;notice.value='';try{const result=await jumpExternal({...external.value.community.target},external.value.community.label,'community');if(!disposed)notice.value=result==='unsupported'?'请在微信小程序中打开社区入口。':result==='cancelled'?'已取消打开，仍停留在赛事平台。':'已打开社区，返回后可继续浏览赛事。'}catch(e){if(!disposed)notice.value=e instanceof Error?e.message:'社区暂不可用。'}finally{if(!disposed)busy.value=false}}
function insurance(){if(unavailable.value)return;uni.navigateTo({url:'/pages/insurance/index'})}
onUnmounted(()=>{disposed=true})
</script>
<template>
 <view v-if="visible" class="external-home-section">
  <view class="section-heading"><view><text class="section-title">球场之外</text><text class="section-subtitle">与社区相连，为每一次上场做好准备</text></view></view>
  <view class="external-home-grid">
   <view v-if="external.community.enabled" class="external-home-card"><view class="external-home-symbol"><AppIcon name="users" tone="green" :size="28" /></view><view class="external-home-copy"><text class="h3">{{external.community.label}}</text><text class="muted">{{external.community.description}}</text></view><button role="button" tabindex="0" hover-class="none" class="ui-button outline-button" :disabled="busy||unavailable" :aria-disabled="busy||unavailable" @click="community">{{busy?'正在打开…':'进入社区'}}<AppIcon name="external" :size="16" /></button></view>
   <view v-if="external.insurance.enabled" class="external-home-card"><view class="external-home-symbol"><AppIcon name="info" tone="green" :size="28" /></view><view class="external-home-copy"><text class="h3">{{external.insurance.title}}</text><text class="muted">{{external.insurance.description}}</text></view><button role="button" tabindex="0" hover-class="none" class="ui-button outline-button" :disabled="unavailable" :aria-disabled="unavailable" @click="insurance">查看保障介绍<AppIcon name="arrow" :size="16" /></button></view>
  </view>
  <view v-if="unavailable" class="external-home-notice" role="status"><text>入口配置尚未实时确认，请恢复连接并同步设置后再打开。</text><button role="button" tabindex="0" class="ui-button text-button" :disabled="platform.loading.value" @click="platform.refresh">同步入口设置</button></view>
  <text v-if="notice" class="external-home-notice" role="status">{{notice}}</text>
 </view>
</template>
<style scoped>
.external-home-section { margin:40px 0; }.external-home-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:20px; }.external-home-card { display:flex; flex-wrap:wrap; align-items:center; gap:16px; padding:24px; border:1px solid var(--line); border-radius:var(--radius); background:var(--surface); min-width:0; }.external-home-symbol { display:flex; align-items:center; justify-content:center; width:52px; height:52px; background:var(--surface-soft); border-radius:var(--small-radius); flex:none; }.external-home-copy { flex:1; min-width:140px; display:flex; flex-direction:column; gap:8px; overflow-wrap:anywhere; }.external-home-copy .muted { font-size:13px; line-height:1.8; }.external-home-card .outline-button { margin-left:auto; }.external-home-notice { display:block; margin-top:14px; font-size:13px; color:var(--muted); line-height:1.8; overflow-wrap:anywhere; }@media(max-width:760px){.external-home-grid { grid-template-columns:minmax(0,1fr); }.external-home-card { padding:20px; }}@media(max-width:360px){.external-home-card { padding:16px; }.external-home-copy { min-width:120px; }}
</style>
