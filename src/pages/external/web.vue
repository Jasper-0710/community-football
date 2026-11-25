<script setup lang="ts">
import {ref} from 'vue'
import {onLoad} from '@dcloudio/uni-app'
import {getPlatformSettings} from '@/services/platform-settings'
import {publicRecovery} from '@/services/public-data'
import {validExternalTarget} from '@/domain/external-entries'
const url=ref(''),error=ref(''),key=ref<'community'|'insurance'|null>(null)
async function load(){url.value='';error.value='';try{
 // Resolve only a configured entry; never trust a URL passed by a page query.
 const settings=await getPlatformSettings(),entry=key.value?settings.form.external[key.value]:null
 if(publicRecovery.readOnly.value)throw new Error('入口配置尚未实时确认，请恢复连接后重试。')
 if(!entry?.enabled||entry.target.kind!=='https'||!validExternalTarget(entry.target,false,true))throw new Error('此入口已关闭或目标发生变化，请返回后重新打开。')
 url.value=entry.target.url
 }catch(e){error.value=e instanceof Error?e.message:'暂时无法打开网页。'}}
function back(){uni.navigateBack({fail:()=>uni.reLaunch({url:'/pages/index/index'})})}
onLoad(query=>{
 // #ifdef H5
 error.value='请返回赛事平台，从社区或保障介绍的入口打开网页。'
 // #endif
 // #ifdef MP-WEIXIN
 key.value=query?.entry==='community'?'community':query?.entry==='insurance'?'insurance':null;if(!key.value){error.value='入口参数无效。';return}void load()
 // #endif
})
</script>
<template><view class="external-web-page"><!-- #ifdef MP-WEIXIN --><web-view v-if="url&&!error" :src="url" @error="error='目标网页暂时无法打开，请检查服务或业务域名配置。'" /><!-- #endif --><view v-if="error" class="external-web-error"><text>{{error}}</text><button v-if="key" @click="load">重试打开网页</button><button @click="back">返回赛事平台</button></view></view></template>
<style scoped>.external-web-error { padding:48px 24px; display:flex; flex-direction:column; gap:20px; line-height:1.8; overflow-wrap:anywhere; }</style>
