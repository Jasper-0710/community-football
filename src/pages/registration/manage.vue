<script setup lang="ts">
import {computed,nextTick,reactive,ref,watch} from 'vue'
import {onLoad,onShow,onUnload} from '@dcloudio/uni-app'
import AppShell from '@/components/AppShell.vue'
import AppIcon from '@/components/AppIcon.vue'
import {useUserProfile} from '@/composables/useUserProfile'
import {teamDistricts,teamRequestId} from '@/domain/team'
import {competitionTime} from '@/domain/competition'
import {registrationStates,fileSize,type RegistrationDetail,type RegistrationPreparation,type RegistrationForm} from '@/domain/registration'
import {prepareRegistration,getMyRegistration,submitRegistration,cancelRegistration,chooseRegistrationFiles,uploadRegistrationFile,discardRegistrationFile,openRegistrationFile,type UploadDraft} from '@/services/registrations'
const {profile,loading:profileLoading,error:profileError,supported,login}=useUserProfile()
const confirming=ref(false),submitting=ref(false)
const ready=ref(false),loading=ref(false),busy=ref(false),editing=ref(false),uncertain=ref(false),error=ref(''),notice=ref(''),locked=ref(false)
const preparation=ref<RegistrationPreparation|null>(null),record=ref<RegistrationDetail|null>(null),deadline=ref<string|null>(null),drafts=ref<UploadDraft[]>([])
const form=reactive({teamName:'',district:'',project:'',leaderName:'',contactPhone:''})
let competitionId='',id='',generation=0,visible=true
const title=computed(()=>record.value?.competitionName||preparation.value?.competition.name||'球队报名')
const config=computed(()=>preparation.value?.competition.registrationConfig)
const projectOptions=computed(()=>['请选择本次参赛项目',...(config.value?.projects||[])])
const projectIndex=computed(()=>Math.max(0,(config.value?.projects.indexOf(form.project)??-1)+1))
function selectProject(event:{detail:{value:string|number}}){form.project=config.value?.projects[Number(event.detail.value)-1]||''}
function inputField(field:keyof RegistrationForm,event:unknown){
 const input=event as {detail?:{value?:unknown};target?:{value?:unknown}}
 const value=input.detail?.value??input.target?.value
 if(typeof value==='string')form[field]=value
}
function submissionError(message:string){
 error.value=message;uni.showToast({title:message,icon:'none',duration:3000})
 void nextTick(()=>{if(visible&&editing.value)uni.pageScrollTo({selector:'.registration-submit',duration:200})})
}
const canSubmit=computed(()=>!!preparation.value?.team&&!!config.value&&preparation.value.uploadsEnabled&&!locked.value&&!busy.value&&!confirming.value&&!uncertain.value)
const submitBlockers=computed(()=>{
 const reasons:string[]=[]
 if(!config.value)reasons.push('赛事报名项目和人数要求尚未设置，请联系赛事工作人员。')
 if(!preparation.value?.uploadsEnabled)reasons.push('报名材料上传暂未开放，当前无法提交报名。请等待赛事工作人员开放后重新读取。')
 if(locked.value)reasons.push('报名已截止，当前资料已锁定。')
 if(uncertain.value)reasons.push('请先重新读取报名记录，核对上次操作结果。')
 return reasons
})
const explain=(e:unknown)=>e instanceof Error?e.message:'操作失败，请重试。'
onLoad(q=>{competitionId=q?.competitionId||'';id=q?.id||''})
watch(profile,p=>{if(p)void load();else{generation++;record.value=null;preparation.value=null;ready.value=false}})
onShow(()=>{visible=true;if(profile.value&&!editing.value&&!busy.value)void load()})
onUnload(()=>{visible=false;generation++})
function back(){uni.navigateBack({fail:()=>uni.reLaunch({url:'/pages/index/index?tab=profile'})})}
function teamPage(){uni.navigateTo({url:'/pages/team/manage'})}
function fillForm(){
 const r=record.value,t=preparation.value?.team
 Object.assign(form,r?r.form:{teamName:t?.name||'',district:t?.district||'',project:config.value?.projects.length===1?config.value.projects[0]:'',leaderName:'',contactPhone:t?.contactPhone||''})
 drafts.value=r?r.attachments.map(f=>({requestId:teamRequestId(),id:f.id,path:'',name:f.name,size:f.size,file:f,progress:100,error:'',existing:true})):[]
}
async function load(){
 if(!profile.value||busy.value)return
 const current=++generation;loading.value=true;ready.value=false;error.value='';notice.value='';editing.value=false;preparation.value=null;record.value=null
 try{
  if(id){const r=await getMyRegistration(id);if(current!==generation||!visible)return;record.value=r.registration;competitionId=r.registration.competitionId;locked.value=r.locked;deadline.value=r.deadline}
  else{const p=await prepareRegistration(competitionId);if(current!==generation||!visible)return;preparation.value=p;record.value=p.registration;locked.value=!p.competition.registrationEndAt||Date.parse(p.serverTime)>=Date.parse(p.competition.registrationEndAt);deadline.value=p.competition.registrationEndAt;id=p.registration?.id||'';fillForm();editing.value=!!p.team&&!p.registration}
  ready.value=true;uncertain.value=false
 }catch(e){if(current===generation)error.value=explain(e)}finally{if(current===generation)loading.value=false}
}
async function edit(){
 if(busy.value||locked.value||uncertain.value)return
 busy.value=true;error.value='';notice.value=''
 try{const p=await prepareRegistration(competitionId);if(!visible)return;preparation.value=p;record.value=p.registration;deadline.value=p.competition.registrationEndAt;locked.value=!deadline.value||Date.parse(p.serverTime)>=Date.parse(deadline.value);if(locked.value){notice.value='报名已截止，当前资料已锁定。';return}fillForm();editing.value=true}
 catch(e){error.value=explain(e)}finally{busy.value=false}
}
function failure(e:unknown){error.value=explain(e);uncertain.value=['SERVICE_UNAVAILABLE','INVALID_RESPONSE','CONFLICT','NOT_FOUND'].includes((e as any)?.code||'')}
async function upload(d:UploadDraft){
 try{await uploadRegistrationFile(competitionId,d)}catch(e){d.error=explain(e)}
}
async function choose(){
 if(busy.value||!preparation.value?.uploadsEnabled||drafts.value.length>=5)return
 busy.value=true;error.value=''
 try{const chosen=await chooseRegistrationFiles(5-drafts.value.length);for(const d of chosen){if(!visible)break;drafts.value.push(d);await upload(drafts.value[drafts.value.length-1])}}
 catch(e){error.value=explain(e)}finally{busy.value=false}
}
async function retry(d:UploadDraft){if(busy.value)return;busy.value=true;d.error='';try{await upload(d)}finally{busy.value=false}}
async function remove(d:UploadDraft){if(busy.value)return;busy.value=true;error.value='';try{if(d.id&&!d.existing)await discardRegistrationFile(d.id);drafts.value=drafts.value.filter(x=>x!==d)}catch(e){error.value=explain(e)}finally{busy.value=false}}
async function submit(){
 if(!canSubmit.value)return
 error.value='';notice.value=''
 const missing=([['teamName','球队名'],['district','所属地区'],['project','报名项目'],['leaderName','领队姓名'],['contactPhone','联系方式']] as const).filter(([field])=>!form[field].trim()).map(([,label])=>label)
 if(missing.length){submissionError(`请填写${missing.join('、')}。`);return}
 const phone=form.contactPhone.trim()
 if(!/^\+?[0-9][0-9 ()-]{5,29}$/.test(phone)||phone.replace(/\D/g,'').length<7){submissionError('请填写有效的联系方式，手机号或含区号的联系电话。');return}
 if(!drafts.value.length){submissionError('请上传至少一份报名材料，再提交审核。');return}
 if(drafts.value.some(d=>d.error)){submissionError('有材料上传失败，请重试上传或移除后重新选择。');return}
 if(drafts.value.some(d=>!d.file)){submissionError('材料尚未上传完成，请等待上传完成后再提交。');return}
 confirming.value=true
 let confirmed=false
 try{
  confirmed=await new Promise<boolean>((resolve,reject)=>uni.showModal({title:record.value?'确认重新提交':'确认提交报名',content:`${form.teamName} · ${form.project}\n共${drafts.value.length}份材料。提交后等待后台审核${record.value?'，原审核结果将重置':''}。`,confirmText:'确认提交',success:r=>resolve(r.confirm),fail:()=>reject(new Error('无法打开提交确认，请重试。'))}))
 }catch(e){submissionError(explain(e));return}finally{confirming.value=false}
 if(!confirmed||busy.value||!visible)return
 busy.value=true;submitting.value=true
 try{const r=await submitRegistration(competitionId,record.value?.version||0,preparation.value!.competition.rulesVersion,teamRequestId(),{...form},drafts.value.map(d=>d.file!.id));if(!visible)return;record.value=r;id=r.id;editing.value=false;notice.value='报名已提交，请等待审核。截止前可修改资料或撤销。';void nextTick(()=>{if(visible)uni.pageScrollTo({scrollTop:0,duration:0})})}catch(e){if(visible){failure(e);submissionError(error.value)}}finally{busy.value=false;submitting.value=false}
}
async function cancel(){
 if(!record.value||locked.value||busy.value||uncertain.value)return
 const confirm=await new Promise<boolean>(resolve=>uni.showModal({title:'撤销本次报名',content:'撤销后释放球队名额，报名记录会保留。截止前再次报名需要重新提交审核。',confirmText:'撤销报名',confirmColor:'#963a29',success:r=>resolve(r.confirm),fail:()=>resolve(false)}))
 if(!confirm||busy.value||!visible)return
 busy.value=true;error.value='';notice.value=''
 try{record.value=await cancelRegistration(record.value.id,record.value.version,teamRequestId());notice.value='报名已撤销，名额已释放。'}catch(e){failure(e)}finally{busy.value=false}
}
async function openFile(fileId:string){if(!record.value||busy.value)return;busy.value=true;error.value='';try{await openRegistrationFile(record.value.id,fileId)}catch(e){error.value=explain(e)}finally{busy.value=false}}
</script>
<template>
<AppShell active="tournament" detail live><view class="inner-page registration-page">
 <view class="section-heading"><button class="ui-button text-button" :disabled="busy" @click="back">← 返回</button><button v-if="profile" class="ui-button text-button" :disabled="loading||busy" @click="load">重新读取</button></view>
 <view class="registration-heading"><text class="eyebrow">赛事报名</text><text class="page-title">{{ title }}</text><text class="page-description">填写报名资料，提交参赛材料，审核通过后获得参赛资格。</text></view>
 <view v-if="!profile" class="panel registration-empty"><AppIcon name="users" :size="40" tone="green"/><text class="h2">登录后，为你的球队报名</text><text class="muted">使用球队领队的微信账号提交，并随时查看审核进度。</text><text v-if="profileError" class="team-message error">{{ profileError }}</text><button v-if="supported" class="ui-button primary-button" :disabled="profileLoading" @click="login">微信登录</button><text v-else class="info-note">请在微信小程序中登录并报名。</text></view>
 <template v-else>
 <text v-if="error&&!editing" class="team-message error" role="alert">{{ error }}</text><text v-if="notice" class="team-message success" role="status">{{ notice }}</text>
 <view v-if="uncertain&&!editing" class="info-note"><text>请先重新读取报名记录，核对提交结果后再继续操作。</text><button class="ui-button outline-button" :disabled="busy" @click="load">重新读取报名</button></view>
 <view v-if="loading" class="panel registration-empty"><text>正在读取报名资料…</text></view>
 <view v-else-if="!ready" class="panel registration-empty"><text class="h3">暂时无法读取报名信息</text><button class="ui-button outline-button" @click="load">重新加载</button></view>
 <template v-else>
 <view class="registration-steps"><view :class="{current:editing||!record}"><text>01</text><text>填写与上传</text></view><view :class="{current:record?.status==='pending'}"><text>02</text><text>后台审核</text></view><view :class="{current:record?.status==='approved'}"><text>03</text><text>确认参赛</text></view></view>
 <view v-if="!record&&!preparation?.team" class="panel registration-empty"><text class="h2">先创建你的球队</text><text class="muted">建队后自动成为领队，报名时会带出队名、地区和联系方式。</text><button class="ui-button primary-button" @click="teamPage">创建我的球队</button></view>
 <view v-if="record&&!editing" class="panel registration-summary">
  <view class="section-heading"><view><text class="h2">{{ record.teamName }}</text><text class="section-subtitle">{{ record.district }} · {{ record.project }}</text></view><text class="application-status" :class="record.status">{{ registrationStates[record.status] }}</text></view>
  <view v-if="record.status==='rejected'" class="registration-review rejected"><text class="h3">需要补充或修改材料</text><text>{{ record.review?.reason }}</text></view>
  <view v-else class="registration-review" :class="record.status"><text>{{ record.status==='pending'?'材料已送达，等待赛事管理员审核。':record.status==='approved'?'报名审核已通过，请关注后续赛程安排。':'本次报名已撤销，球队名额已释放。' }}</text></view>
  <view class="registration-facts"><view><text>领队姓名</text><text>{{ record.form.leaderName }}</text></view><view><text>联系方式</text><text>{{ record.form.contactPhone }}</text></view><view><text>提交时间</text><text>{{ competitionTime(record.submittedAt) }}</text></view><view><text>报名截止</text><text>{{ competitionTime(deadline) }}</text></view></view>
  <view class="registration-materials"><text class="h3">已提交材料 · {{ record.attachments.length }}份</text><view v-for="f in record.attachments" :key="f.id" class="registration-file"><view class="file-symbol">{{ f.extension.toUpperCase() }}</view><view class="file-copy"><text>{{ f.name }}</text><text class="muted">{{ fileSize(f.size) }}</text></view><button class="ui-button text-button" :disabled="busy" @click="openFile(f.id)">查看</button></view></view>
  <text v-if="locked" class="info-note">报名已截止，资料修改与撤销已锁定。</text><view v-else class="registration-footer"><text class="muted">修改资料后须重新审核；撤销会释放名额。</text><view><button class="ui-button outline-button" :disabled="busy||uncertain" @click="edit">{{ ['rejected','cancelled'].includes(record.status)?'重新报名':'修改报名资料' }}</button><button v-if="record.status!=='cancelled'" class="ui-button text-button danger-text" :disabled="busy||uncertain" @click="cancel">撤销报名</button></view></view>
 </view>
 <template v-if="editing&&preparation?.team">
 <view class="panel registration-rules"><text class="h3">本赛事报名须知</text><view v-if="config" class="registration-rule-grid"><view><text class="fact-label">球队名额</text><text>{{ config.teamLimit===null?'不限额':`共${config.teamLimit}队 · 已占${preparation.competition.registrationStats.occupied}队` }}</text></view><view><text class="fact-label">每队参赛人数</text><text>{{ config.minPlayers }}–{{ config.maxPlayers }}人</text></view></view><text class="muted">截止：{{ competitionTime(deadline) }}（北京时间）</text><text class="muted">请在材料中提供完整参赛名单。人数由管理员审核材料时核对。</text><text v-if="!config" class="info-note">赛事报名安排尚未完善，请稍后再试。</text><text v-if="!preparation.uploadsEnabled" class="info-note">报名材料上传暂未开放，暂时无法提交报名。</text><text v-if="locked" class="info-note">报名已截止，当前资料已锁定。</text></view>
 <view class="panel registration-form">
  <view class="info-section-heading"><text class="info-section-number">01</text><view><text class="h2">球队与报名项目</text><text class="section-subtitle">以下为本次报名资料，带 * 的内容为必填</text></view></view>
  <label class="team-field-label" for="registration-team">球队名 *</label><input id="registration-team" class="team-input" :value="form.teamName" @input="inputField('teamName',$event)" @blur="inputField('teamName',$event)" @confirm="inputField('teamName',$event)" :disabled="busy||uncertain||locked" maxlength="40" placeholder="填写球队全称" aria-label="报名球队名"/>
  <text class="team-field-label">所属地区 *</text><picker :range="teamDistricts" :value="Math.max(0,teamDistricts.indexOf(form.district))" :disabled="busy||uncertain||locked" @change="form.district=teamDistricts[Number($event.detail.value)]"><view class="team-picker-input" role="button" aria-label="选择报名地区"><text>{{ form.district||'请选择上海所属区' }}</text><AppIcon name="down" :size="18"/></view></picker>
  <text class="team-field-label">报名项目 *</text><picker :range="projectOptions" :value="projectIndex" :disabled="busy||uncertain||locked||!config" @change="selectProject"><view class="team-picker-input" role="button" aria-label="选择报名项目"><text>{{ form.project||'请选择本次参赛项目' }}</text><AppIcon name="down" :size="18"/></view></picker>
  <view class="registration-form-divider"><view class="info-section-heading"><text class="info-section-number">02</text><view><text class="h2">领队联系方式</text><text class="section-subtitle">供赛事工作人员联系，仅本人及管理员可查看</text></view></view>
   <label class="team-field-label" for="registration-leader">领队姓名 *</label><input id="registration-leader" class="team-input" :value="form.leaderName" @input="inputField('leaderName',$event)" @blur="inputField('leaderName',$event)" @confirm="inputField('leaderName',$event)" :disabled="busy||uncertain||locked" maxlength="30" placeholder="请填写领队真实姓名" aria-label="报名领队姓名"/>
   <label class="team-field-label" for="registration-phone">联系方式 *</label><input id="registration-phone" class="team-input" :value="form.contactPhone" @input="inputField('contactPhone',$event)" @blur="inputField('contactPhone',$event)" @confirm="inputField('contactPhone',$event)" :disabled="busy||uncertain||locked" maxlength="30" placeholder="手机号或含区号的联系电话" aria-label="报名联系方式"/>
  </view>
 </view>
 <view class="panel registration-materials"><view class="info-section-heading"><text class="info-section-number">03</text><view><text class="h2">报名材料 *</text><text class="section-subtitle">上传参赛名单及赛事要求的证明材料</text></view></view><text class="muted">PDF、JPG、PNG、Word（DOCX）、Excel（XLSX）；最多5份，每份不超过10MB。</text>
  <view v-for="d in drafts" :key="d.requestId" class="registration-file upload-file"><view class="file-symbol">{{ d.name.split('.').pop()?.toUpperCase() }}</view><view class="file-copy"><text>{{ d.name }}</text><text class="muted">{{ fileSize(d.size) }} · {{ d.file?'上传完成':`${d.progress}%` }}</text><progress v-if="!d.file&&!d.error" :percent="d.progress" activeColor="#17674c" stroke-width="4"/><text v-if="d.error" class="danger-text">{{ d.error }}</text><button v-if="d.error" class="ui-button text-button" :disabled="busy||locked" @click="retry(d)">重试上传</button></view><button class="ui-button text-button" :disabled="busy||uncertain||locked" @click="remove(d)">移除</button></view>
  <text v-if="!preparation.uploadsEnabled" class="info-note" role="status">材料上传暂未开放，选择材料按钮暂不可用。请等待赛事工作人员开放后重新读取。</text>
  <button class="ui-button outline-button upload-material-button" :disabled="busy||uncertain||locked||!preparation.uploadsEnabled||drafts.length>=5" @click="choose">{{ busy?'正在处理材料…':`＋ 选择报名材料（${drafts.length}/5）` }}</button>
 </view>
 <view class="panel registration-submit"><text class="h3">核对后提交，等待审核</text><text class="muted">截止前可修改或撤销，截止后锁定。修改后重新审核。待审核及已通过占用球队名额。</text><view v-if="submitBlockers.length" class="info-note" role="status"><text class="h3">暂时无法提交</text><text v-for="reason in submitBlockers" :key="reason" class="page-description">{{ reason }}</text></view><view v-if="error" class="team-message error registration-submit-feedback" role="alert"><text>{{ error }}</text><button v-if="uncertain" class="ui-button outline-button" :disabled="busy||confirming" @click="load">重新读取报名</button></view><text v-if="submitting" class="info-note" role="status">正在提交报名，请稍候。请勿关闭页面或重复提交。</text><button class="ui-button primary-button" :disabled="!canSubmit" :loading="busy" @click="submit">{{ submitting?'正在提交报名…':confirming?'请确认提交':record?'保存修改并重新审核':'提交报名，等待审核' }}</button><button v-if="record" class="ui-button text-button" :disabled="busy" @click="editing=false">返回报名详情</button></view>
 </template>
 <view v-if="record?.history.length&&!editing" class="panel registration-history"><text class="h3">报名动态</text><view v-for="(h,i) in [...record.history].reverse()" :key="i"><text class="history-dot"/><view><text>{{ registrationStates[h.status] }} · {{ h.actor==='leader'?'领队操作':'后台审核' }}</text><text class="muted">{{ competitionTime(h.at) }}</text><text v-if="h.reason">{{ h.reason }}</text></view></view></view>
 </template></template>
</view></AppShell>
</template>
