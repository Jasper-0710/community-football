<script setup lang="ts">
import type {BadgeCleanup} from '../../src/domain/team-badge'
import {onMounted,onUnmounted,ref} from 'vue'
import {positionLabel,type ManagedTeam,type TeamSummary} from '../../src/domain/team'
import type {createAdminAuth} from './auth'
const props=defineProps<{auth:ReturnType<typeof createAdminAuth>;initialId?:string}>()
const badgeFailures=ref(new Set<string>())
function badgeFailed(id:string){badgeFailures.value=new Set([...badgeFailures.value,id])}
const teams=ref<TeamSummary[]>([]),selected=ref<ManagedTeam|null>(null),cursor=ref<string|null>(null),busy=ref(false),error=ref('')
const cleanup=ref<BadgeCleanup|null>(null),cleanupBusy=ref(false),cleanupError=ref(''),cleanupCursor=ref<string|undefined>()
async function cleanBadges(dryRun=true,next=false){if(cleanupBusy.value)return;cleanupBusy.value=true;cleanupError.value='';const current=request;try{const cursor=next?cleanup.value?.nextCursor||undefined:cleanupCursor.value;const result=await props.auth.authorized((api,token)=>api.cleanupTeamBadges(token,dryRun,cursor));if(current===request){cleanup.value=result;cleanupCursor.value=cursor}}catch(e){if(current===request){cleanup.value=null;cleanupError.value=explain(e)}}finally{cleanupBusy.value=false}}
let request=0
const explain=(e:unknown)=>e instanceof Error?e.message:'球队档案暂不可用，请重试。'
async function load(more=false){
 if(busy.value)return
 const current=++request;busy.value=true;error.value='';selected.value=null;badgeFailures.value=new Set()
 try{const page=await props.auth.authorized((api,token)=>api.teams(token,more?cursor.value||undefined:undefined));if(current!==request)return;teams.value=more?[...teams.value,...page.teams]:page.teams;cursor.value=page.nextCursor}
 catch(e){if(current===request){teams.value=[];cursor.value=null;error.value=explain(e)}}finally{if(current===request)busy.value=false}
}
async function open(id:string){
 if(busy.value)return
 const current=++request;busy.value=true;error.value='';selected.value=null;badgeFailures.value=new Set()
 try{const team=await props.auth.authorized((api,token)=>api.team(token,id));if(current===request)selected.value=team}
 catch(e){if(current===request)error.value=explain(e)}finally{if(current===request)busy.value=false}
}
onMounted(()=>{void (props.initialId?open(props.initialId):load())});onUnmounted(()=>{request++})
</script>
<template>
<section class="teams-admin">
 <div class="workspace-heading"><div><span class="eyebrow">球队与名单</span><h1>球队档案</h1><p class="muted">查看在管球队与已解散档案，核对联系方式和球员名单。</p></div><button class="secondary-button" :disabled="busy" @click="selected?open(selected.id):load()">刷新档案</button></div>
 <p v-if="error" class="notice" role="alert">{{ error }}</p>
 <p v-if="busy" class="account-card competition-empty" role="status">正在读取球队档案…</p>
 <template v-else-if="selected">
  <button class="secondary-button team-back-button" @click="load()">← 返回球队列表</button>
  <article class="account-card admin-team-detail">
   <div class="admin-team-heading"><div class="admin-team-crest"><img v-if="selected.badgeUrl&&!badgeFailures.has(selected.id)" :src="selected.badgeUrl" :alt="selected.name+'队徽'" @error="badgeFailed(selected.id)"/><span v-else>{{ selected.name.slice(0,1) }}</span></div><div><span class="status-badge neutral">{{ selected.district }}</span><span class="status-badge team-lifecycle" :class="{archived:selected.status==='dissolved'}">{{ selected.status==='dissolved'?'已解散':'正常管理' }}</span><h2>{{ selected.name }}</h2><p class="muted">{{ selected.status==='dissolved'?'解散时名单':'当前名单' }} {{ selected.playerCount }} 人 · {{ selected.hasBadge?'已设置队徽':'默认队徽' }}</p></div></div>
   <p v-if="selected.hasBadge&&(!selected.badgeUrl||badgeFailures.has(selected.id))" class="muted">队徽暂时无法加载，可点击上方“刷新档案”重试。</p>
   <p v-if="selected.status==='dissolved'" class="section-guide">已于 {{ new Date(selected.dissolvedAt!).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) }} 解散。以下为解散时保留的档案，原领队已可重新建队。</p><div class="admin-team-info-grid"><section class="admin-team-info"><h3>领队联系方式</h3><dl><div><dt>领队昵称</dt><dd>{{ selected.leaderNickname||'未填写' }}</dd></div><div><dt>联系电话</dt><dd>{{ selected.contactPhone }}</dd></div></dl><p class="muted">仅球队领队和授权管理员可查看联系方式。</p></section><section class="admin-team-info"><h3>球队介绍</h3><p class="competition-description">{{ selected.description||'领队暂未填写球队介绍。' }}</p></section></div>
  </article>
  <section class="account-card admin-roster"><div class="card-heading"><div><h2>球员名单</h2><p class="muted">{{ selected.status==='dissolved'?'保留解散时的球员名单，供历史核对。':'由领队维护的当前名单，按球衣号码排列。' }}</p></div><span class="status-badge">{{ selected.playerCount }} 人</span></div>
   <div v-if="!selected.players.length" class="competition-empty"><h3>暂未添加球员</h3><p class="muted">领队添加球员后，刷新即可查看。</p></div>
   <div v-else class="admin-player-list"><div class="admin-player-row admin-player-labels"><span>号码</span><span>球员姓名</span><span>位置</span></div><div v-for="p in selected.players" :key="p.id" class="admin-player-row"><strong class="admin-shirt-number">{{ p.number }}</strong><span>{{ p.name }}</span><span class="muted">{{ positionLabel(p.position) }}</span></div></div>
  </section>
  <div class="section-guide"><strong>球队名单与参赛名单</strong><p>{{ selected.status==='dissolved'?'此处保留解散时的球队档案与名单。':'这里展示球队当前资料。赛事报名和最终参赛名单将在报名功能开放后单独管理。' }}</p></div>
 </template>
 <template v-else>
  <div class="section-guide"><strong>球队资料来自小程序</strong><p>领队在微信小程序“我的 → 我的球队 → 球队队徽”中上传和更换队徽。此处查看档案和清理过期图片；刷新可读取最新资料。</p></div>
  <div v-if="!teams.length&&!error" class="account-card competition-empty"><h2>暂时还没有球队</h2><p class="muted">领队可从小程序“我的 → 我的球队”创建球队。</p></div>
  <div class="admin-team-grid"><article v-for="team in teams" :key="team.id" class="account-card admin-team-card" :data-team-id="team.id"><div class="admin-team-heading"><div class="admin-team-crest"><img v-if="team.badgeUrl&&!badgeFailures.has(team.id)" :src="team.badgeUrl" :alt="team.name+'队徽'" @error="badgeFailed(team.id)"/><span v-else>{{ team.name.slice(0,1) }}</span></div><div><span class="status-badge neutral">{{ team.district }}</span><span class="status-badge team-lifecycle" :class="{archived:team.status==='dissolved'}">{{ team.status==='dissolved'?'已解散':'正常管理' }}</span><h2>{{ team.name }}</h2></div></div><div class="admin-team-facts"><div><span>球员人数</span><strong>{{ team.playerCount }} 人</strong></div><div><span>领队联系电话</span><strong>{{ team.contactPhone }}</strong></div></div><button class="secondary-button" @click="open(team.id)">查看球队与名单 →</button></article></div>
  <details class="account-card team-badge-maintenance"><summary>队徽存储维护</summary><p class="muted">检查过期未保存或替换下来的队徽及上传分片。当前球队和已解散档案正在使用的队徽会保留。</p><div class="content-actions"><button class="secondary-button" :disabled="cleanupBusy" @click="cleanupCursor=undefined;cleanBadges()">检查待清理队徽</button><button v-if="cleanup?.dryRun&&cleanup.eligibleObjects" class="secondary-button" :disabled="cleanupBusy" @click="cleanBadges(false)">清理本批队徽</button><button v-if="cleanup?.nextCursor" class="secondary-button" :disabled="cleanupBusy" @click="cleanBadges(true,true)">检查下一批队徽</button></div><p v-if="cleanupError" class="notice" role="alert">{{ cleanupError }}</p><p v-if="cleanup" role="status">本批检查{{ cleanup.scanned }}张队徽，保护{{ cleanup.protectedBadges }}张档案引用队徽，可清理{{ cleanup.eligibleObjects }}个对象，已清理{{ cleanup.removedObjects }}个。<template v-if="cleanup.deferredBadges">{{ cleanup.deferredBadges }}张仍有待处理对象，可稍后重新检查。</template></p></details>
  <button v-if="cursor" class="secondary-button" :disabled="busy" @click="load(true)">加载更多球队</button>
 </template>
</section>
</template>
