<script setup lang="ts">
import {ref,watch} from 'vue'
import {onShow,onUnload} from '@dcloudio/uni-app'
import AppShell from '@/components/AppShell.vue'
import {useUserProfile} from '@/composables/useUserProfile'
import {listMyRegistrations} from '@/services/registrations'
import {registrationStates,type RegistrationSummary} from '@/domain/registration'
import {competitionTime} from '@/domain/competition'
const {profile,loading:profileLoading,error:profileError,supported,login}=useUserProfile()
const records=ref<RegistrationSummary[]>([]),cursor=ref<string|null>(null),loading=ref(false),error=ref(''),ready=ref(false)
let generation=0,visible=true
watch(profile,p=>{if(p)void load();else{generation++;records.value=[];ready.value=false}})
onShow(()=>{visible=true;if(profile.value)void load()});onUnload(()=>{visible=false;generation++})
async function load(more=false){if(loading.value||!profile.value)return;const current=++generation;loading.value=true;error.value='';if(!more){ready.value=false;records.value=[];cursor.value=null}try{const page=await listMyRegistrations(more?cursor.value||undefined:undefined);if(current!==generation||!visible)return;records.value=more?[...records.value,...page.registrations]:page.registrations;cursor.value=page.nextCursor;ready.value=true}catch(e){error.value=e instanceof Error?e.message:'读取失败，请重试。'}finally{if(current===generation)loading.value=false}}
function open(id:string){uni.navigateTo({url:'/pages/registration/manage?id='+id})}
function competitions(){uni.reLaunch({url:'/pages/index/index?tab=tournament'})}
function back(){uni.navigateBack({fail:()=>uni.reLaunch({url:'/pages/index/index?tab=profile'})})}
</script>
<template><AppShell active="profile" detail live><view class="inner-page registration-page">
 <view class="section-heading"><button class="ui-button text-button" @click="back">← 返回个人中心</button><button v-if="profile" class="ui-button text-button" :disabled="loading" @click="load()">刷新记录</button></view>
 <view class="registration-heading"><text class="eyebrow">我的赛事</text><text class="page-title">我的报名</text><text class="page-description">查看提交材料、审核进度及报名结果。</text></view>
 <view v-if="!profile" class="panel registration-empty"><text class="h2">登录后查看报名记录</text><text v-if="profileError" class="team-message error">{{ profileError }}</text><button v-if="supported" class="ui-button primary-button" :disabled="profileLoading" @click="login">微信登录</button><text v-else class="muted">请在微信小程序中查看报名。</text></view>
 <template v-else><view v-if="error" class="team-message error" role="alert"><text>{{ error }}</text><button class="ui-button outline-button" :disabled="loading" @click="load()">重新读取</button></view><view v-if="loading&&!records.length" class="panel registration-empty"><text>正在读取报名记录…</text></view>
 <view v-if="ready&&!records.length" class="panel registration-empty"><text class="h2">还没有报名记录</text><text class="muted">选择正在报名的赛事，为你的球队迈出第一步。</text><button class="ui-button primary-button" @click="competitions">查看赛事</button></view>
 <view v-for="r in records" :key="r.id" class="panel registration-list-card"><view class="section-heading"><text class="format-tag">{{ r.project }}</text><text class="application-status" :class="r.status">{{ registrationStates[r.status] }}</text></view><text class="h2">{{ r.competitionName }}</text><text class="registration-team-label">{{ r.teamName }} · {{ r.district }}</text><text class="muted">最近更新 {{ competitionTime(r.updatedAt) }}</text><button class="ui-button outline-button" @click="open(r.id)">查看报名与材料 →</button></view>
 <button v-if="cursor" class="ui-button outline-button" :disabled="loading" @click="load(true)">加载更多报名</button></template>
</view></AppShell></template>
