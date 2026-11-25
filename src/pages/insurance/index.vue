<script setup lang="ts">
import {computed,onUnmounted,ref,watch} from 'vue'
import {onShow} from '@dcloudio/uni-app'
import AppShell from '@/components/AppShell.vue'
import AppIcon from '@/components/AppIcon.vue'
import {usePlatformSettings} from '@/composables/usePlatformSettings'
import {publicRecovery} from '@/services/public-data'
import {jumpExternal} from '@/services/external-navigation'
const platform=usePlatformSettings(),entry=computed(()=>platform.settings.value.form.external.insurance),images=computed(()=>platform.settings.value.insuranceImages||[]),failed=ref<string[]>([]),busy=ref(false),notice=ref('')
const unavailable=computed(()=>!platform.confirmed.value||!!platform.error.value||publicRecovery.readOnly.value)
let disposed=false
async function reload(){failed.value=[];await platform.refresh()}
function back(){uni.navigateBack({fail:()=>uni.reLaunch({url:'/pages/index/index'})})}
function preview(url:string){uni.previewImage({current:url,urls:images.value.map(x=>x.url),fail:()=>{notice.value='图片预览暂不可用，请重试。'}})}
async function open(){if(busy.value||unavailable.value||!entry.value.enabled||entry.value.target.kind==='none')return;busy.value=true;notice.value='';try{const result=await jumpExternal({...entry.value.target},entry.value.buttonLabel,'insurance');if(!disposed)notice.value=result==='unsupported'?'请在微信小程序中打开投保入口。':result==='cancelled'?'已取消打开，仍停留在保障介绍。':'已打开投保入口，返回后可继续浏览。'}catch(e){if(!disposed)notice.value=e instanceof Error?e.message:'投保入口暂不可用。'}finally{if(!disposed)busy.value=false}}
watch(()=>platform.settings.value,()=>{failed.value=[];notice.value=''})
onShow(()=>{void reload()});onUnmounted(()=>{disposed=true})
</script>
<template><AppShell active="home" detail live>
 <view class="insurance-page">
  <button role="button" tabindex="0" class="ui-button breadcrumb" @click="back"><AppIcon name="back" :size="15" />返回首页</button>
  <template v-if="entry.enabled"><view class="insurance-header"><text class="insurance-eyebrow">ON &amp; OFF THE PITCH</text><text class="insurance-title">{{entry.title}}</text><text class="muted">{{entry.description}}</text><text class="small-text muted">本页提供保障介绍，具体产品条款、投保资格和服务以提供方为准。</text></view>
   <view v-if="failed.length" class="empty-state" role="alert"><text>部分介绍图片暂时无法加载，链接可能已过期。</text><button role="button" tabindex="0" class="ui-button outline-button" :disabled="platform.loading.value" @click="reload">重新加载投保图片</button></view>
   <view class="insurance-images"><view v-for="(image,index) in images" :key="`${image.id}:${image.url}`" class="insurance-image-card"><image v-if="!failed.includes(image.id)" :src="image.url" :aria-label="entry.images[index]?.caption||`保障介绍图片 ${index+1}`" mode="widthFix" class="insurance-image" @error="failed.push(image.id)" @click="preview(image.url)"/><text v-else class="muted insurance-image-missing">图片 {{index+1}} 暂不可用</text><text v-if="entry.images[index]?.caption" class="insurance-caption muted">{{entry.images[index].caption}}</text></view></view>
   <view v-if="entry.target.kind!=='none'" class="insurance-action"><text class="muted small-text">继续后将前往外部服务查看投保信息。</text><button role="button" tabindex="0" class="ui-button primary-button" :disabled="busy||unavailable" :aria-disabled="busy||unavailable" @click="open">{{busy?'正在打开…':entry.buttonLabel}}<AppIcon name="external" :size="17" tone="white" /></button></view>
   <text v-if="unavailable" class="insurance-notice" role="status">当前入口尚未实时确认，请恢复连接并重试同步。</text><text v-if="notice" class="insurance-notice" role="status">{{notice}}</text>
   <button role="button" tabindex="0" class="ui-button text-button insurance-reload" :disabled="platform.loading.value" @click="reload">{{platform.loading.value?'正在同步…':'重新同步专栏'}}</button>
  </template>
  <view v-else class="empty-state"><AppIcon name="info" tone="muted" :size="30" /><text class="h3">保障介绍暂未开放</text><text class="muted">运营人员发布后将在这里展示。</text><button role="button" tabindex="0" class="ui-button outline-button" :disabled="platform.loading.value" @click="reload">重新同步专栏</button></view>
 </view>
</AppShell></template>
<style scoped>
.insurance-page { max-width:800px; margin:0 auto; padding:12px 0 40px; }.insurance-header { display:flex; flex-direction:column; gap:18px; margin:28px 0; line-height:1.8; overflow-wrap:anywhere; }.insurance-eyebrow { color:var(--green); font-size:11px; letter-spacing:2px; }.insurance-title { font-size:32px; font-weight:700; color:var(--ink); }.insurance-images { display:flex; flex-direction:column; gap:24px; }.insurance-image-card { overflow:hidden; border-radius:var(--radius); border:1px solid var(--line); background:var(--surface); }.insurance-image { display:block; width:100%; cursor:zoom-in; }.insurance-caption { display:block; padding:16px 20px; font-size:14px; line-height:1.8; overflow-wrap:anywhere; }.insurance-image-missing { display:block; padding:48px 20px; text-align:center; }.insurance-action { margin:32px 0 12px; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:16px; padding:24px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); }.insurance-notice { display:block; margin:16px 0; color:var(--muted); line-height:1.8; }.insurance-reload { margin-top:24px; }@media(max-width:480px){.insurance-title { font-size:26px; }.insurance-action { padding:18px; }.insurance-action .primary-button { width:100%; }}
</style>
