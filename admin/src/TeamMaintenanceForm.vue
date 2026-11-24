<script setup lang="ts">
import {computed,onMounted,onUnmounted,reactive,ref} from 'vue'
import {playerPositions,teamDistricts,teamRequestId,type ManagedTeam,type TeamPlayer} from '../../src/domain/team'
import type {LeaderOption,TeamMutation} from '../../src/domain/team-maintenance'
import type {createAdminAuth} from './auth'
const props=defineProps<{auth:ReturnType<typeof createAdminAuth>;team:ManagedTeam|null;mode:'create'|'team'|'player'|'remove'|'leader'|'dissolve';player?:TeamPlayer}>()
const emit=defineEmits<{saved:[team:ManagedTeam];cancel:[];reload:[];busy:[value:boolean]}>()
const form=reactive({name:props.mode==='player'?props.player?.name||'':props.team?.name||'',district:props.team?.district||'',description:props.team?.description||'',contactPhone:props.team?.contactPhone||'',number:props.player?.number?.toString()||'',position:props.player?.position||'',leaderId:'',confirmName:''})
const leaders=ref<LeaderOption[]>([]),leaderCursor=ref<string|null>(null),leadersBusy=ref(false),leadersError=ref('')
const saving=ref(false),error=ref(''),stale=ref(false),pending=ref<TeamMutation|null>(null),checked=ref(false),checking=ref(false)
const fieldErrors=ref<Record<string,string>>({}),requestId=teamRequestId(),playerId=props.player?.id||'p_'+teamRequestId()
let epoch=0
const locked=computed(()=>saving.value||!!pending.value||stale.value)
const title=computed(()=>({create:'新建球队',team:'编辑球队资料',player:props.player?'编辑球员':'添加球员',remove:'移出当前名单',leader:'更换球队领队',dissolve:'解散球队'})[props.mode])
const explain=(e:unknown)=>e instanceof Error?e.message:'球队管理暂不可用，请重试。'
async function loadLeaders(more=false){
 if(leadersBusy.value)return
 const current=epoch;leadersBusy.value=true;leadersError.value=''
 try{const page=await props.auth.authorized((api,token)=>api.teamLeaders(token,more?leaderCursor.value||undefined:undefined));if(current!==epoch)return;leaders.value=more?[...leaders.value,...page.leaders]:page.leaders;leaderCursor.value=page.nextCursor}
 catch(e){if(current===epoch)leadersError.value=explain(e)}finally{if(current===epoch)leadersBusy.value=false}
}
async function checkDissolution(){
 if(!props.team)return
 const current=epoch;checking.value=true
 try{await props.auth.authorized((api,token)=>api.checkTeamDissolution(token,props.team!.id,props.team!.version));if(current===epoch)checked.value=true}
 catch(e){if(current===epoch){error.value=explain(e);stale.value=true}}finally{if(current===epoch)checking.value=false}
}
function validate(){
 const e:Record<string,string>={}
 if(['create','team','player'].includes(props.mode)){
  if(!form.name.trim())e.name=props.mode==='player'?'请填写球员姓名。':'请填写队名。'
  else if(Array.from(form.name.trim()).length>(props.mode==='player'?30:40))e.name=props.mode==='player'?'球员姓名最多30个字。':'队名最多40个字。'
 }
 if(['create','team'].includes(props.mode)){
  if(!teamDistricts.includes(form.district))e.district='请选择所属区。'
  if(Array.from(form.description.trim()).length>500)e.description='球队介绍最多500个字。'
  if(!/^\+?[\d()\s-]+$/.test(form.contactPhone.trim())||!/^\d{7,15}$/.test(form.contactPhone.replace(/[+()\s-]/g,'')))e.contactPhone='请填写有效联系电话。'
 }
 if(['create','leader'].includes(props.mode)&&!leaders.value.some(u=>u.id===form.leaderId&&u.available))e.leaderId='请选择可管理球队的微信用户。'
 if(props.mode==='player'){
  const n=Number(form.number)
  if(!/^\d{1,2}$/.test(form.number)||n<1||n>99)e.number='球衣号码须为1–99的整数。'
  else if(props.team?.players.some(p=>p.id!==props.player?.id&&p.number===n))e.number='该球衣号码已被本队其他球员使用。'
  if(!playerPositions.some(p=>p.value===form.position))e.position='请选择球员位置。'
 }
 if(['leader','dissolve'].includes(props.mode)&&form.confirmName.trim()!==props.team?.name)e.confirmName='请输入完整且一致的球队名称。'
 fieldErrors.value=e;return !Object.keys(e).length
}
function mutation():TeamMutation{
 const base={id:props.team!.id,expectedVersion:props.team!.version,requestId}
 if(props.mode==='player')return {action:'teams.savePlayerAdmin',...base,playerId,form:{name:form.name.trim(),number:Number(form.number),position:form.position as 'goalkeeper'|'defender'|'midfielder'|'forward'}}
 if(props.mode==='remove')return {action:'teams.removePlayerAdmin',...base,playerId,confirmName:props.player!.name}
 if(props.mode==='leader')return {action:'teams.assignLeaderAdmin',...base,leaderId:form.leaderId,confirmName:form.confirmName.trim()}
 if(props.mode==='dissolve')return {action:'teams.dissolveAdmin',...base,confirmName:form.confirmName.trim()}
 return {action:'teams.updateAdmin',...base,form:{name:form.name.trim(),district:form.district,description:form.description.trim(),contactPhone:form.contactPhone.trim()}}
}
async function submit(){
 if(saving.value||stale.value||props.mode==='dissolve'&&!checked.value)return
 if(!pending.value){
  if(!validate())return
  pending.value=props.mode==='create'?{action:'teams.createAdmin',requestId,leaderId:form.leaderId,form:{name:form.name.trim(),district:form.district,description:form.description.trim(),contactPhone:form.contactPhone.trim()}}:mutation()
 }
 const current=epoch,submission=pending.value;saving.value=true;emit('busy',true);error.value=''
 try{const team=await props.auth.authorized((api,token)=>api.mutateTeam(token,submission));if(current===epoch)emit('saved',team)}
 catch(e){if(current===epoch){error.value=explain(e);const code=(e as {code?:string})?.code;if(code==='CONFLICT'||code==='NOT_FOUND'){pending.value=null;stale.value=true}else if(code&&!['NETWORK_ERROR','TIMEOUT','SERVICE_UNAVAILABLE','INVALID_RESPONSE'].includes(code))pending.value=null}}
 finally{if(current===epoch)saving.value=false;emit('busy',false)}
}
onMounted(()=>{if(['create','leader'].includes(props.mode))void loadLeaders();if(props.mode==='dissolve')void checkDissolution()})
onUnmounted(()=>{epoch++})
</script>
<template>
<form class="account-card competition-form team-maintenance-form" :data-mode="mode" @submit.prevent="submit">
 <div class="card-heading"><div><span class="eyebrow">档案维护</span><h2>{{ title }}</h2><p class="muted">{{ mode==='create'?'为已在小程序登录的用户建立球队，保存后该用户可在“我的球队”继续管理。':mode==='player'||mode==='remove'?'当前名单会同步到客户端，历史比赛中已保存的姓名、号码和事件保持原记录。':mode==='leader'?'仅未关联报名、赛程或成绩的球队可更换领队；原领队释放名额，新领队取得管理权限。':mode==='dissolve'?'仅未关联报名、赛程或成绩的球队可解散。球队和解散时的名单会保留为只读档案。':'保存后同步球队公开资料；报名表及历史比赛事件保留提交时的资料。' }}</p></div></div>
 <p v-if="error" class="notice" role="alert">{{ error }}</p>
 <p v-if="pending&&!saving" class="section-guide" role="status">提交结果尚未确认，表单已锁定。可以重试同一请求，或重新读取核对实际结果。</p>
 <fieldset :disabled="locked||checking">
  <template v-if="mode==='create'||mode==='leader'">
   <label for="admin-team-leader">{{ mode==='create'?'球队领队':'新领队' }}</label>
   <select id="admin-team-leader" v-model="form.leaderId" :aria-invalid="!!fieldErrors.leaderId" :disabled="leadersBusy"><option value="">请选择微信用户</option><option v-for="u in leaders" :key="u.id" :value="u.id" :disabled="!u.available">{{ u.nickname||'未填写昵称' }} · {{ u.phoneHint||'账号 '+u.id.slice(-6) }}{{ u.reason?'（'+u.reason+'）':'' }}</option></select>
   <p v-if="fieldErrors.leaderId" class="field-error" role="alert">{{ fieldErrors.leaderId }}</p>
   <p class="muted team-form-help">每位用户只能管理一支球队。找不到用户时，请其先登录小程序并填写昵称，再刷新用户列表。</p>
   <div class="content-actions"><button type="button" class="secondary-button" :disabled="leadersBusy" @click="loadLeaders()">刷新微信用户</button><button v-if="leaderCursor" type="button" class="secondary-button" :disabled="leadersBusy" @click="loadLeaders(true)">加载更多微信用户</button></div>
   <p v-if="leadersBusy" role="status">正在读取微信用户…</p><p v-if="leadersError" class="notice" role="alert">{{ leadersError }}</p>
  </template>
  <template v-if="mode==='create'||mode==='team'">
   <div class="form-grid"><div><label for="admin-team-name">球队名称</label><input id="admin-team-name" v-model="form.name" maxlength="80" :aria-invalid="!!fieldErrors.name"/><p v-if="fieldErrors.name" class="field-error" role="alert">{{ fieldErrors.name }}</p></div><div><label for="admin-team-district">所属区</label><select id="admin-team-district" v-model="form.district" :aria-invalid="!!fieldErrors.district"><option value="">请选择所属区</option><option v-for="d in teamDistricts" :key="d">{{ d }}</option></select><p v-if="fieldErrors.district" class="field-error" role="alert">{{ fieldErrors.district }}</p></div></div>
   <label for="admin-team-phone">领队联系电话</label><input id="admin-team-phone" v-model="form.contactPhone" type="tel" maxlength="30" :aria-invalid="!!fieldErrors.contactPhone"/><p v-if="fieldErrors.contactPhone" class="field-error" role="alert">{{ fieldErrors.contactPhone }}</p>
   <label for="admin-team-description">球队介绍（选填）</label><textarea id="admin-team-description" v-model="form.description" rows="4" maxlength="1000" :aria-invalid="!!fieldErrors.description"/><p v-if="fieldErrors.description" class="field-error" role="alert">{{ fieldErrors.description }}</p>
  </template>
  <template v-if="mode==='player'">
   <label for="admin-player-name">球员姓名</label><input id="admin-player-name" v-model="form.name" maxlength="60" :aria-invalid="!!fieldErrors.name"/><p v-if="fieldErrors.name" class="field-error" role="alert">{{ fieldErrors.name }}</p>
   <div class="form-grid"><div><label for="admin-player-number">球衣号码</label><input id="admin-player-number" v-model="form.number" inputmode="numeric" maxlength="2" :aria-invalid="!!fieldErrors.number"/><p v-if="fieldErrors.number" class="field-error" role="alert">{{ fieldErrors.number }}</p></div><div><label for="admin-player-position">场上位置</label><select id="admin-player-position" v-model="form.position" :aria-invalid="!!fieldErrors.position"><option value="">请选择位置</option><option v-for="p in playerPositions" :key="p.value" :value="p.value">{{ p.label }}</option></select><p v-if="fieldErrors.position" class="field-error" role="alert">{{ fieldErrors.position }}</p></div></div>
  </template>
  <p v-if="mode==='remove'" class="section-guide">确认将 <strong>{{ player?.number }}号 · {{ player?.name }}</strong> 移出 <strong>{{ team?.name }}</strong> 的当前名单？移出后号码可以重新使用，该球员的历史档案仍会保留。</p>
  <template v-if="mode==='leader'||mode==='dissolve'"><p v-if="checking" role="status">正在核对解散条件…</p><label for="admin-team-confirm">输入完整球队名称确认</label><p class="team-confirm-name">{{ team?.name }}</p><input id="admin-team-confirm" v-model="form.confirmName" autocomplete="off" :aria-invalid="!!fieldErrors.confirmName"/><p v-if="fieldErrors.confirmName" class="field-error" role="alert">{{ fieldErrors.confirmName }}</p></template>
 </fieldset>
 <div class="form-footer"><button type="button" class="secondary-button" :disabled="saving" @click="pending||stale?emit('reload'):emit('cancel')">{{ pending||stale?(mode==='create'?'重新读取列表':'重新读取球队'):'取消' }}</button><button type="submit" class="primary-button" :class="{'team-danger-button':mode==='remove'||mode==='dissolve'}" :disabled="saving||stale||checking||mode==='dissolve'&&!checked">{{ saving?'正在提交…':pending?'重试本次提交':mode==='remove'?'确认移出':mode==='dissolve'?'确认解散':mode==='leader'?'确认更换领队':mode==='create'?'创建球队':'保存'+(mode==='player'?'球员':'球队资料') }}</button></div>
</form>
</template>
