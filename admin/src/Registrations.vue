<script setup lang="ts">
import {onMounted,ref} from 'vue'
import type {createAdminAuth} from './auth'
import {competitionTime,type AdminCompetition,type RegistrationStats} from '../../src/domain/competition'
import {registrationStates,fileSize,type RegistrationSummary,type RegistrationDetail,type RegistrationFile} from '../../src/domain/registration'
const props=defineProps<{auth:ReturnType<typeof createAdminAuth>}>()
const competitions=ref<AdminCompetition[]>([]),competitionId=ref(''),filter=ref(''),records=ref<RegistrationSummary[]>([]),cursor=ref<string|null>(null),stats=ref<RegistrationStats>({pending:0,approved:0,occupied:0})
const detail=ref<RegistrationDetail|null>(null),busy=ref(false),error=ref(''),notice=ref(''),uncertain=ref(false),reason=ref(''),playerCount=ref(''),checkedMaterials=ref(false)
const explain=(e:unknown)=>e instanceof Error?e.message:'操作失败，请重试。'
function requestId(){return Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')}
async function loadCompetitions(){
 busy.value=true;error.value=''
 try{const all:AdminCompetition[]=[];let next:string|undefined;do{const p=await props.auth.authorized((api,token)=>api.competitions(token,next));all.push(...p.competitions);next=p.nextCursor||undefined}while(next);competitions.value=all;competitionId.value=all[0]?.id||'';busy.value=false;if(competitionId.value)await load()}
 catch(e){error.value=explain(e)}finally{busy.value=false}
}
async function load(more=false){
 if(busy.value||!competitionId.value)return
 busy.value=true;error.value='';if(!more){records.value=[];cursor.value=null;detail.value=null;uncertain.value=false;stats.value={pending:0,approved:0,occupied:0}}
 try{const p=await props.auth.authorized((api,token)=>api.registrations(token,competitionId.value,filter.value||undefined,more?cursor.value||undefined:undefined));records.value=more?[...records.value,...p.registrations]:p.registrations;cursor.value=p.nextCursor;stats.value=p.stats}
 catch(e){error.value=explain(e)}finally{busy.value=false}
}
async function open(id:string){
 if(busy.value)return;busy.value=true;error.value='';notice.value='';detail.value=null;checkedMaterials.value=false;reason.value='';playerCount.value=''
 try{detail.value=await props.auth.authorized((api,token)=>api.registration(token,id));uncertain.value=false;playerCount.value=detail.value.review?.playerCount?.toString()||''}
 catch(e){error.value=explain(e)}finally{busy.value=false}
}
async function file(f:RegistrationFile){
 if(!detail.value||busy.value)return
 const tab=window.open('about:blank','_blank');if(tab)tab.opener=null
 busy.value=true;error.value=''
 try{const link=await props.auth.authorized((api,token)=>api.registrationFile(token,detail.value!.id,f.id));if(!tab)throw new Error('浏览器拦截了下载窗口，请允许本页面打开新窗口后重试。');tab.location.replace(link.url)}
 catch(e){tab?.close();error.value=explain(e)}finally{busy.value=false}
}
async function review(decision:'approved'|'rejected'){
 const r=detail.value;if(!r||busy.value||uncertain.value||r.status!=='pending')return
 error.value='';notice.value=''
 if(decision==='approved'&&(!checkedMaterials.value||!/^\d+$/.test(playerCount.value)||Number(playerCount.value)<r.minPlayers||Number(playerCount.value)>r.maxPlayers)){error.value=`请核对全部材料，填写${r.minPlayers}–${r.maxPlayers}人的参赛人数并勾选确认。`;return}
 if(decision==='rejected'&&!reason.value.trim()){error.value='请填写具体驳回原因，方便领队修改材料。';return}
 if(!window.confirm(decision==='approved'?`确认通过“${r.teamName}”的报名？核对人数：${playerCount.value}人。`:`确认驳回“${r.teamName}”的报名并释放名额？`))return
 busy.value=true
 try{const updated=await props.auth.authorized((api,token)=>api.reviewRegistration(token,r.id,r.version,requestId(),decision,decision==='rejected'?reason.value:'',decision==='approved'?Number(playerCount.value):null));busy.value=false;await load();detail.value=updated;checkedMaterials.value=false;reason.value='';notice.value=decision==='approved'?'审核通过，球队进入本赛事参赛名单。':'已驳回，原因已同步给领队，名额已释放。'}
 catch(e){error.value=explain(e);uncertain.value=['CONFLICT','NETWORK_ERROR','TIMEOUT','SERVICE_UNAVAILABLE','INVALID_RESPONSE'].includes((e as any)?.code||'')}
 finally{busy.value=false}
}
onMounted(()=>void loadCompetitions())
</script>
<template><section class="registrations-admin">
 <div class="workspace-heading"><div><span class="eyebrow">参赛资格</span><h1>球队报名审核</h1><p class="muted">核对报名资料与附件，确认本赛事的参赛球队。</p></div><button class="secondary-button" :disabled="busy" @click="competitions.length?load():loadCompetitions()">刷新报名</button></div>
 <div class="section-guide"><strong>审核流程</strong><p>查看资料与材料 → 核对参赛人数 → 审核通过或填写原因驳回。领队修改后会重新进入待审核。</p></div>
 <p v-if="error" class="notice" role="alert">{{ error }}</p><p v-if="notice" class="notice success" role="status">{{ notice }}</p>
 <div v-if="!competitions.length&&!busy&&!error" class="account-card competition-empty"><h2>请先创建赛事</h2><p class="muted">在赛事管理中设置报名项目、人数与名额后，接收球队报名。</p></div>
 <template v-if="competitions.length">
 <div class="account-card registration-filters"><div><label for="review-competition">选择赛事</label><select id="review-competition" v-model="competitionId" :disabled="busy" @change="load()"><option v-for="c in competitions" :key="c.id" :value="c.id">{{ c.name }}</option></select></div><div><label for="review-status">报名状态</label><select id="review-status" v-model="filter" :disabled="busy" @change="load()"><option value="">全部报名</option><option value="pending">待审核</option><option value="approved">已通过（参赛名单）</option><option value="rejected">已驳回</option><option value="cancelled">已撤销</option></select></div></div>
 <div class="registration-stat-cards"><div><span>待审核</span><strong>{{ stats.pending }}</strong><small>等待核对报名资料</small></div><div><span>已通过</span><strong>{{ stats.approved }}</strong><small>已确认参赛资格</small></div><div><span>已占用名额</span><strong>{{ stats.occupied }}</strong><small>待审核与已通过合计</small></div></div>
 <div class="registration-workspace">
  <section class="registration-inbox"><div class="card-heading"><h2>{{ filter==='approved'?'参赛球队名单':'报名记录' }}</h2><span class="muted">当前已加载 {{ records.length }} 条</span></div><p v-if="busy&&!records.length" class="muted">正在读取报名…</p><div v-else-if="!records.length&&!error" class="account-card competition-empty"><h3>当前没有符合条件的报名</h3><p class="muted">可以切换赛事或报名状态查看。</p></div><button v-for="r in records" :key="r.id" class="registration-inbox-item" :class="{selected:detail?.id===r.id}" :disabled="busy" @click="open(r.id)"><span class="registration-item-top"><strong>{{ r.teamName }}</strong><span class="application-status" :class="r.status">{{ registrationStates[r.status] }}</span></span><span>{{ r.district }} · {{ r.project }}</span><span class="muted">{{ r.attachmentCount }}份材料 · {{ competitionTime(r.updatedAt) }}</span></button><button v-if="cursor" class="secondary-button" :disabled="busy" @click="load(true)">加载更多报名</button></section>
  <article v-if="detail" class="account-card registration-review-detail"><div class="card-heading"><div><span class="eyebrow">报名详情</span><h2>{{ detail.teamName }}</h2></div><span class="application-status" :class="detail.status">{{ registrationStates[detail.status] }}</span></div><dl class="registration-details"><div><dt>所属地区</dt><dd>{{ detail.form.district }}</dd></div><div><dt>报名项目</dt><dd>{{ detail.form.project }}</dd></div><div><dt>领队姓名</dt><dd>{{ detail.form.leaderName }}</dd></div><div><dt>联系方式</dt><dd>{{ detail.form.contactPhone }}</dd></div><div><dt>提交时间</dt><dd>{{ competitionTime(detail.submittedAt) }}</dd></div><div><dt>人数要求</dt><dd>{{ detail.minPlayers }}–{{ detail.maxPlayers }}人</dd></div></dl><div class="review-requirements"><h3>本次报名的参赛要求</h3><p>{{ detail.requirements }}</p></div>
   <section class="review-files"><h3>报名材料 · {{ detail.attachments.length }}份</h3><div v-for="f in detail.attachments" :key="f.id"><span class="review-file-type">{{ f.extension.toUpperCase() }}</span><div><strong>{{ f.name }}</strong><span class="muted">{{ fileSize(f.size) }}</span></div><button class="secondary-button" :disabled="busy" @click="file(f)">下载</button></div></section>
   <p v-if="uncertain" class="notice">提交结果或报名内容已变化，请重新打开该报名记录，核对最新状态后再审核。</p>
   <section v-if="detail.status==='pending'" class="review-controls"><h3>审核意见</h3><p class="muted">请先下载并核对材料。审核通过确认参赛，驳回后释放名额。</p><fieldset :disabled="busy||uncertain"><label for="verified-count">核对后的参赛人数 *</label><input id="verified-count" v-model="playerCount" type="number" :min="detail.minPlayers" :max="detail.maxPlayers" step="1" placeholder="根据报名材料填写" /><label class="checkbox-line"><input v-model="checkedMaterials" type="checkbox" /> 已核对报名材料与参赛要求</label><button class="primary-button" type="button" @click="review('approved')">审核通过</button><div class="review-reject"><label for="rejection-reason">驳回原因（驳回时必填）</label><textarea id="rejection-reason" v-model="reason" rows="3" maxlength="500" placeholder="请说明需修改或补充的内容"></textarea><button class="secondary-button danger-button" type="button" @click="review('rejected')">驳回报名</button></div></fieldset></section>
   <section v-else-if="detail.review" class="review-result"><h3>审核结果</h3><p>{{ registrationStates[detail.review.decision] }} · {{ competitionTime(detail.review.reviewedAt) }}</p><p v-if="detail.review.reason">{{ detail.review.reason }}</p><p v-if="detail.review.playerCount!==null">已核对参赛人数：{{ detail.review.playerCount }}人</p></section>
   <section class="review-timeline"><h3>报名动态（最近20次）</h3><div v-for="(h,i) in [...detail.history].reverse()" :key="i"><strong>{{ registrationStates[h.status] }} · {{ h.actor==='admin'?'后台审核':'领队操作' }}</strong><span class="muted">{{ competitionTime(h.at) }}</span><p v-if="h.reason">{{ h.reason }}</p></div></section>
  </article><div v-else class="account-card registration-detail-empty"><h2>选择一条报名记录</h2><p class="muted">点击左侧球队，查看报名信息、材料及审核动态。</p></div>
 </div></template>
</section></template>
