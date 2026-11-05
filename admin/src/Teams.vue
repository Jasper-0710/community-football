<script setup lang="ts">
import {onMounted,onUnmounted,ref} from 'vue'
import {positionLabel,type ManagedTeam,type TeamSummary} from '../../src/domain/team'
import type {createAdminAuth} from './auth'
const props=defineProps<{auth:ReturnType<typeof createAdminAuth>}>()
const teams=ref<TeamSummary[]>([]),selected=ref<ManagedTeam|null>(null),cursor=ref<string|null>(null),busy=ref(false),error=ref('')
let request=0
const explain=(e:unknown)=>e instanceof Error?e.message:'球队档案暂不可用，请重试。'
async function load(more=false){
 if(busy.value)return
 const current=++request;busy.value=true;error.value='';selected.value=null
 try{const page=await props.auth.authorized((api,token)=>api.teams(token,more?cursor.value||undefined:undefined));if(current!==request)return;teams.value=more?[...teams.value,...page.teams]:page.teams;cursor.value=page.nextCursor}
 catch(e){if(current===request){teams.value=[];cursor.value=null;error.value=explain(e)}}finally{if(current===request)busy.value=false}
}
async function open(id:string){
 if(busy.value)return
 const current=++request;busy.value=true;error.value='';selected.value=null
 try{const team=await props.auth.authorized((api,token)=>api.team(token,id));if(current===request)selected.value=team}
 catch(e){if(current===request)error.value=explain(e)}finally{if(current===request)busy.value=false}
}
onMounted(()=>{void load()});onUnmounted(()=>{request++})
</script>
<template>
<section class="teams-admin">
 <div class="workspace-heading"><div><span class="eyebrow">球队与名单</span><h1>球队档案</h1><p class="muted">查看在管球队与已解散档案，核对联系方式和球员名单。</p></div><button class="secondary-button" :disabled="busy" @click="selected?open(selected.id):load()">刷新档案</button></div>
 <p v-if="error" class="notice" role="alert">{{ error }}</p>
 <p v-if="busy" class="account-card competition-empty" role="status">正在读取球队档案…</p>
 <template v-else-if="selected">
  <button class="secondary-button team-back-button" @click="selected=null">← 返回球队列表</button>
  <article class="account-card admin-team-detail">
   <div class="admin-team-heading"><div class="admin-team-crest" aria-hidden="true">{{ selected.name.slice(0,1) }}</div><div><span class="status-badge neutral">{{ selected.district }}</span><span class="status-badge team-lifecycle" :class="{archived:selected.status==='dissolved'}">{{ selected.status==='dissolved'?'已解散':'正常管理' }}</span><h2>{{ selected.name }}</h2><p class="muted">{{ selected.status==='dissolved'?'解散时名单':'当前名单' }} {{ selected.playerCount }} 人 · 默认队徽</p></div></div>
   <p v-if="selected.status==='dissolved'" class="section-guide">已于 {{ new Date(selected.dissolvedAt!).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) }} 解散。以下为解散时保留的档案，原领队已可重新建队。</p><div class="admin-team-info-grid"><section class="admin-team-info"><h3>领队联系方式</h3><dl><div><dt>领队昵称</dt><dd>{{ selected.leaderNickname||'未填写' }}</dd></div><div><dt>联系电话</dt><dd>{{ selected.contactPhone }}</dd></div></dl><p class="muted">仅球队领队和授权管理员可查看联系方式。</p></section><section class="admin-team-info"><h3>球队介绍</h3><p class="competition-description">{{ selected.description||'领队暂未填写球队介绍。' }}</p></section></div>
  </article>
  <section class="account-card admin-roster"><div class="card-heading"><div><h2>球员名单</h2><p class="muted">{{ selected.status==='dissolved'?'保留解散时的球员名单，供历史核对。':'由领队维护的当前名单，按球衣号码排列。' }}</p></div><span class="status-badge">{{ selected.playerCount }} 人</span></div>
   <div v-if="!selected.players.length" class="competition-empty"><h3>暂未添加球员</h3><p class="muted">领队添加球员后，刷新即可查看。</p></div>
   <div v-else class="admin-player-list"><div class="admin-player-row admin-player-labels"><span>号码</span><span>球员姓名</span><span>位置</span></div><div v-for="p in selected.players" :key="p.id" class="admin-player-row"><strong class="admin-shirt-number">{{ p.number }}</strong><span>{{ p.name }}</span><span class="muted">{{ positionLabel(p.position) }}</span></div></div>
  </section>
  <div class="section-guide"><strong>球队名单与参赛名单</strong><p>{{ selected.status==='dissolved'?'此处保留解散时的球队档案与名单。':'这里展示球队当前资料。赛事报名和最终参赛名单将在报名功能开放后单独管理。' }}</p></div>
 </template>
 <template v-else>
  <div class="section-guide"><strong>球队资料来自小程序</strong><p>领队创建或编辑球队后，刷新即可读取最新资料。点击“查看球队与名单”核对联系方式和球员信息。</p></div>
  <div v-if="!teams.length&&!error" class="account-card competition-empty"><h2>暂时还没有球队</h2><p class="muted">领队可从小程序“我的 → 我的球队”创建球队。</p></div>
  <div class="admin-team-grid"><article v-for="team in teams" :key="team.id" class="account-card admin-team-card" :data-team-id="team.id"><div class="admin-team-heading"><div class="admin-team-crest" aria-hidden="true">{{ team.name.slice(0,1) }}</div><div><span class="status-badge neutral">{{ team.district }}</span><span class="status-badge team-lifecycle" :class="{archived:team.status==='dissolved'}">{{ team.status==='dissolved'?'已解散':'正常管理' }}</span><h2>{{ team.name }}</h2></div></div><div class="admin-team-facts"><div><span>球员人数</span><strong>{{ team.playerCount }} 人</strong></div><div><span>领队联系电话</span><strong>{{ team.contactPhone }}</strong></div></div><button class="secondary-button" @click="open(team.id)">查看球队与名单 →</button></article></div>
  <button v-if="cursor" class="secondary-button" :disabled="busy" @click="load(true)">加载更多球队</button>
 </template>
</section>
</template>
