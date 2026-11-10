<script setup lang="ts">
import {computed,nextTick,onMounted,ref,watch} from 'vue'
import RegistrationMaintenance from './RegistrationMaintenance.vue'
import type {createAdminAuth} from './auth'
import {competitionTime,type AdminCompetition,type RegistrationStats} from '../../src/domain/competition'
import {registrationStates,fileSize,type RegistrationSummary,type RegistrationDetail,type RegistrationFile} from '../../src/domain/registration'
const props=defineProps<{auth:ReturnType<typeof createAdminAuth>}>()
const competitions=ref<AdminCompetition[]>([]),competitionId=ref(''),filter=ref(''),records=ref<RegistrationSummary[]>([]),cursor=ref<string|null>(null),stats=ref<RegistrationStats>({pending:0,approved:0,occupied:0})
const detail=ref<RegistrationDetail|null>(null),busy=ref(false),error=ref(''),notice=ref(''),uncertain=ref(false),reason=ref(''),playerCount=ref(''),checkedMaterials=ref(false)
const approvalRules=computed(()=>detail.value?.reviewRules||null)
const displayedRules=computed(()=>detail.value?.status==='pending'?approvalRules.value:detail.value?.review?.rules||detail.value)
type ReviewDecision='approved'|'rejected'
const reviewError=ref<{decision:ReviewDecision;message:string}|null>(null),reviewing=ref<ReviewDecision|null>(null)
function clearReviewError(decision:ReviewDecision){if(!uncertain.value&&reviewError.value?.decision===decision)reviewError.value=null}
watch([playerCount,checkedMaterials],()=>clearReviewError('approved'))
watch(reason,()=>clearReviewError('rejected'))
async function showReviewError(decision:ReviewDecision,message:string){
 reviewError.value={decision,message}
 await nextTick()
 const feedback=document.getElementById(`review-feedback-${decision}`)
 feedback?.focus({preventScroll:true})
 feedback?.scrollIntoView({block:'center',behavior:'auto'})
}
const explain=(e:unknown)=>e instanceof Error?e.message:'操作失败，请重试。'
function requestId(){return Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')}
async function loadCompetitions(){
 busy.value=true;error.value=''
 try{const all:AdminCompetition[]=[];let next:string|undefined;do{const p=await props.auth.authorized((api,token)=>api.competitions(token,next));all.push(...p.competitions);next=p.nextCursor||undefined}while(next);competitions.value=all;competitionId.value=all[0]?.id||'';busy.value=false;if(competitionId.value)await load()}
 catch(e){error.value=explain(e)}finally{busy.value=false}
}
async function load(more=false){
 if(busy.value||!competitionId.value)return
 busy.value=true;error.value='';if(!more){reviewError.value=null;records.value=[];cursor.value=null;detail.value=null;uncertain.value=false;stats.value={pending:0,approved:0,occupied:0}}
 try{const p=await props.auth.authorized((api,token)=>api.registrations(token,competitionId.value,filter.value||undefined,more?cursor.value||undefined:undefined));records.value=more?[...records.value,...p.registrations]:p.registrations;cursor.value=p.nextCursor;stats.value=p.stats}
 catch(e){error.value=explain(e)}finally{busy.value=false}
}
async function open(id:string){
 if(busy.value)return;busy.value=true;error.value='';notice.value='';reviewError.value=null;detail.value=null;checkedMaterials.value=false;reason.value='';playerCount.value=''
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
async function review(decision:ReviewDecision){
 let r=detail.value
 if(!r||busy.value||uncertain.value||r.status!=='pending')return
 error.value='';notice.value='';reviewError.value=null
 const count=String(playerCount.value).trim()
 if(decision==='approved'&&!count){await showReviewError(decision,'请填写核对后的参赛人数，审核将按赛事最新人数要求核对。');return}
 if(decision==='rejected'&&!reason.value.trim()){await showReviewError(decision,'请填写具体驳回原因，方便领队修改材料。');return}
 busy.value=true;reviewing.value=decision
 try{
  if(decision==='approved'){
   // Re-read before local range validation so a settings edit in another tab takes effect immediately.
   const fresh=await props.auth.authorized((api,token)=>api.registration(token,r!.id))
   if(fresh.version!==r.version||fresh.status!=='pending'){
    uncertain.value=true
    await showReviewError(decision,'报名内容或审核状态已变化，请重新读取并核对材料后审核。');return
   }
   detail.value=fresh;r=fresh
   const rules=fresh.reviewRules
   if(!rules){await showReviewError(decision,'本赛事人数要求尚未配置，请先完善赛事设置。');return}
   if(!/^\d+$/.test(count)||!Number.isSafeInteger(Number(count))||Number(count)<rules.minPlayers||Number(count)>rules.maxPlayers){await showReviewError(decision,`参赛人数须填写${rules.minPlayers}–${rules.maxPlayers}人的整数，请根据报名材料核对。`);return}
   if(!checkedMaterials.value){await showReviewError(decision,'请先核对报名材料，再勾选“已核对报名材料与参赛要求”，即可审核通过。');return}
  }
  if(!window.confirm(decision==='approved'?`确认通过“${r.teamName}”的报名？核对人数：${count}人，当前要求：${r.reviewRules!.minPlayers}–${r.reviewRules!.maxPlayers}人。`:`确认驳回“${r.teamName}”的报名并释放名额？`))return
  const updated=await props.auth.authorized((api,token)=>api.reviewRegistration(token,r!.id,r!.version,requestId(),decision,decision==='rejected'?reason.value:'',decision==='approved'?Number(count):null))
  busy.value=false
  await load()
  detail.value=updated;checkedMaterials.value=false;reason.value=''
  notice.value=decision==='approved'?'审核通过，球队进入本赛事参赛名单。':'已驳回，原因已同步给领队，名额已释放。'
  await nextTick()
  document.querySelector('.review-result')?.scrollIntoView({block:'center',behavior:'auto'})
 }catch(e){
  uncertain.value=['CONFLICT','NETWORK_ERROR','TIMEOUT','SERVICE_UNAVAILABLE','INVALID_RESPONSE'].includes((e as any)?.code||'')
  await showReviewError(decision,explain(e))
 }finally{busy.value=false;reviewing.value=null}
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
  <article v-if="detail" class="account-card registration-review-detail"><div class="card-heading"><div><span class="eyebrow">报名详情</span><h2>{{ detail.teamName }}</h2></div><span class="application-status" :class="detail.status">{{ registrationStates[detail.status] }}</span></div><dl class="registration-details"><div><dt>所属地区</dt><dd>{{ detail.form.district }}</dd></div><div><dt>报名项目</dt><dd>{{ detail.form.project }}</dd></div><div><dt>领队姓名</dt><dd>{{ detail.form.leaderName }}</dd></div><div><dt>联系方式</dt><dd>{{ detail.form.contactPhone }}</dd></div><div><dt>提交时间</dt><dd>{{ competitionTime(detail.submittedAt) }}</dd></div><div><dt>{{ detail.status==='pending'?'当前人数要求':detail.review?.rules?'审核时人数要求':'提交时人数要求' }}</dt><dd v-if="displayedRules">{{ displayedRules.minPlayers }}–{{ displayedRules.maxPlayers }}人</dd><dd v-else>尚未配置</dd></div></dl><div class="review-requirements"><h3>提交时的参赛说明</h3><p>{{ detail.requirements }}</p><p class="muted">提交时人数要求：{{ detail.minPlayers }}–{{ detail.maxPlayers }}人。审核通过时按赛事最新人数要求核对，历史记录保留。</p></div>
   <section class="review-files"><h3>报名材料 · {{ detail.attachments.length }}份</h3><div v-for="f in detail.attachments" :key="f.id"><span class="review-file-type">{{ f.extension.toUpperCase() }}</span><div><strong>{{ f.name }}</strong><span class="muted">{{ fileSize(f.size) }}</span></div><button class="secondary-button" :disabled="busy" @click="file(f)">下载</button></div></section>
   <section v-if="detail.status==='pending'" class="review-controls">
    <h3>审核处理</h3><p class="muted">先下载并核对材料，再确认参赛人数；资料不完整时可填写原因驳回。</p>
    <fieldset :aria-busy="reviewing!==null">
     <div class="review-approval">
      <h4>通过审核</h4>
      <label for="verified-count">核对后的参赛人数 *</label>
      <input id="verified-count" v-model="playerCount" :disabled="busy||uncertain" type="number" :min="approvalRules?.minPlayers" :max="approvalRules?.maxPlayers" step="1" placeholder="根据报名材料填写" aria-describedby="verified-count-help" />
      <p id="verified-count-help" class="muted review-count-help"><template v-if="approvalRules">赛事当前要求 {{ approvalRules.minPlayers }}–{{ approvalRules.maxPlayers }} 人，请填写核对后的整数人数。</template><template v-else>人数要求尚未配置，请先完善赛事设置。</template>点击审核通过时会再次读取最新要求。</p>
      <label class="checkbox-line"><input v-model="checkedMaterials" :disabled="busy||uncertain" type="checkbox" /> 已核对报名材料与参赛要求</label>
      <p v-if="reviewError?.decision==='approved'" id="review-feedback-approved" class="notice review-feedback" role="alert" tabindex="-1">{{ reviewError.message }}</p>
      <button class="primary-button" type="button" :disabled="busy||uncertain" @click="review('approved')">{{ reviewing==='approved'?'正在通过审核…':'审核通过' }}</button>
      <div v-if="uncertain&&reviewError?.decision==='approved'" class="review-reload"><p class="muted">请先重新读取，核对最新报名与审核状态后再操作。</p><button class="secondary-button" type="button" :disabled="busy" @click="open(detail.id)">重新读取当前报名</button></div>
     </div>
     <div class="review-reject">
      <h4>驳回报名</h4>
      <p class="muted">资料需补充或不符合要求时，说明原因后驳回，释放报名名额。</p>
      <label for="rejection-reason">驳回原因（驳回时必填）</label>
      <textarea id="rejection-reason" v-model="reason" :disabled="busy||uncertain" rows="3" maxlength="500" placeholder="请说明需修改或补充的内容"></textarea>
      <p v-if="reviewError?.decision==='rejected'" id="review-feedback-rejected" class="notice review-feedback" role="alert" tabindex="-1">{{ reviewError.message }}</p>
      <button class="secondary-button danger-button" type="button" :disabled="busy||uncertain" @click="review('rejected')">{{ reviewing==='rejected'?'正在驳回报名…':'驳回报名' }}</button>
      <div v-if="uncertain&&reviewError?.decision==='rejected'" class="review-reload"><p class="muted">请先重新读取，核对最新报名与审核状态后再操作。</p><button class="secondary-button" type="button" :disabled="busy" @click="open(detail.id)">重新读取当前报名</button></div>
     </div>
    </fieldset>
   </section>
   <section v-else-if="detail.review" class="review-result"><h3>审核结果</h3><p>{{ registrationStates[detail.review.decision] }} · {{ competitionTime(detail.review.reviewedAt) }}</p><p v-if="detail.review.reason">{{ detail.review.reason }}</p><p v-if="detail.review.playerCount!==null">已核对参赛人数：{{ detail.review.playerCount }}人</p></section>
   <section class="review-timeline"><h3>报名动态（最近20次）</h3><div v-for="(h,i) in [...detail.history].reverse()" :key="i"><strong>{{ registrationStates[h.status] }} · {{ h.actor==='admin'?'后台审核':'领队操作' }}</strong><span class="muted">{{ competitionTime(h.at) }}</span><p v-if="h.reason">{{ h.reason }}</p></div></section>
  </article><div v-else class="account-card registration-detail-empty"><h2>选择一条报名记录</h2><p class="muted">点击左侧球队，查看报名信息、材料及审核动态。</p></div>
 </div></template>
 <RegistrationMaintenance :auth="auth" />
</section></template>
