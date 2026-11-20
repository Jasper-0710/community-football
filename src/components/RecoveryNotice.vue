<script setup lang="ts">
import { computed } from 'vue'
import { publicRecovery } from '@/services/public-data'
const sources=computed(()=>publicRecovery.notices.value)
const visible=computed(()=>sources.value.length>0||publicRecovery.readOnly.value)
const cached=computed(()=>sources.value.filter(item=>item.source==='snapshot'))
const time=computed(()=>{const timestamp=Math.min(...cached.value.map(item=>item.savedAt));if(!Number.isFinite(timestamp))return '';const date=new Date(timestamp+8*3600000),pad=(n:number)=>String(n).padStart(2,'0');return `${date.getUTCMonth()+1}月${date.getUTCDate()}日 ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}（北京时间）`})
</script>
<template><view v-if="visible" class="recovery-notice" role="status"><view><text class="recovery-notice-title">{{cached.length?'正在显示本机公开快照':sources.length?'正在使用云端备用读取':'网络或主服务暂不可用'}}</text><text>{{cached.length?`最早快照：${time}。内容可能已更新，图片链接可能过期；快照最多保留30分钟。`:sources.length?'备用公开快照最多保留2分钟，内容可能存在同步延迟。':'本机没有可用快照时会显示读取失败。'}}</text><text v-if="publicRecovery.readOnly.value">当前只读，恢复连接后重新读取再保存。</text></view><button role="button" tabindex="0" class="ui-button outline-button" :disabled="publicRecovery.retrying.value||!publicRecovery.online.value" @click="publicRecovery.retry">{{publicRecovery.retrying.value?'重新读取中…':'重新连接'}}</button></view></template>
