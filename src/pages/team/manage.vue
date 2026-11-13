<script setup lang="ts">
import { computed, ref, reactive, watch } from 'vue'
import { onShow, onUnload } from '@dcloudio/uni-app'
import AppShell from '@/components/AppShell.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useUserProfile } from '@/composables/useUserProfile'
import { teamDistricts,playerPositions,positionLabel,teamRequestId,type ManagedTeam,type TeamPlayer,type PlayerPosition } from '@/domain/team'
import {getMyTeam,createMyTeam,updateMyTeam,saveTeamPlayer,removeTeamPlayer,checkTeamDissolution,dissolveMyTeam} from '@/services/teams'
const {profile,supported,loading:profileLoading,error:profileError,login}=useUserProfile()
const team=ref<ManagedTeam|null>(null),ready=ref(false),loading=ref(false),saving=ref(false),error=ref(''),notice=ref('')
const editingTeam=ref(false),editingPlayer=ref(false),playerId=ref(''),createRequest=ref(''),writeUncertain=ref(false)
const dissolving=ref(false),confirmName=ref('')
const playerValidationAttempted=ref(false)
let generation=0,visible=true
const form=reactive({name:'',district:'',description:'',contactPhone:''})
const player=reactive({name:'',number:'',position:'' as PlayerPosition|''})
const districtIndex=computed(()=>Math.max(0,teamDistricts.indexOf(form.district)))
const positionIndex=computed(()=>Math.max(0,playerPositions.findIndex(p=>p.value===player.position)))
const isNew=computed(()=>!team.value)
const playerErrors=computed(()=>{
 if(!playerValidationAttempted.value)return {name:'',number:'',position:''}
 const number=Number(player.number)
 const duplicate=team.value?.players.find(p=>p.id!==playerId.value&&p.number===number)
 return {
  name:player.name.trim()?'':'请填写球员姓名。',
  number:!/^\d{1,2}$/.test(player.number)||number<1||number>99?'球衣号码须为1–99的整数。':duplicate?`${number}号球衣号码已被${duplicate.name}使用，请换一个号码。`:'',
  position:player.position?'':'请选择球员位置。',
 }
})
const confirmationMatches=computed(()=>!!team.value&&confirmName.value.trim()===team.value.name)
const dissolutionHint=computed(()=>writeUncertain.value?'请先重新读取球队，核对最新状态。':saving.value?'正在处理，请稍候。':!confirmName.value.trim()?'请输入上方完整队名，包含中间的空格和标点。':confirmationMatches.value?'队名已核对一致，可以确认解散。':'队名尚未匹配，请核对中间的空格和标点；也可以复制上方队名后粘贴。')
function feedback(title:string){uni.showToast({title,icon:'none',duration:2500})}
function success(text:string,title=text){notice.value=text;feedback(title)}
function inputConfirmation(event:unknown){
 const input=event as {detail?:{value?:unknown};target?:{value?:unknown}}
 const value=input.detail?.value??input.target?.value
 if(typeof value==='string')confirmName.value=value
}
function copyTeamName(){if(team.value)uni.setClipboardData({data:team.value.name,fail:()=>feedback('复制失败，请手动输入队名')})}
const message=(e:unknown)=>e instanceof Error?e.message:'操作失败，请重试。'
async function load(){
 if(!profile.value||saving.value||loading.value)return
 const current=++generation;loading.value=true;error.value='';notice.value='';ready.value=false;team.value=null;editingTeam.value=false;editingPlayer.value=false
 dissolving.value=false;confirmName.value=''
 try{const value=await getMyTeam();if(current!==generation||!visible)return;team.value=value;ready.value=true;writeUncertain.value=false}
 catch(e){if(current===generation&&visible)error.value=message(e)}finally{if(current===generation)loading.value=false}
}
function clearPrivateState(){
 generation++;loading.value=false;saving.value=false;team.value=null;ready.value=false;error.value='';notice.value=''
 editingTeam.value=false;editingPlayer.value=false;playerId.value='';createRequest.value='';writeUncertain.value=false
 dissolving.value=false;confirmName.value='';playerValidationAttempted.value=false
 Object.assign(form,{name:'',district:'',description:'',contactPhone:''});Object.assign(player,{name:'',number:'',position:''})
}
watch(()=>profile.value?.id,id=>{clearPrivateState();if(id&&visible)void load()},{flush:'sync'})
onShow(()=>{visible=true;if(profile.value&&!editingTeam.value&&!editingPlayer.value&&!dissolving.value&&!saving.value)void load()})
onUnload(()=>{visible=false;clearPrivateState()})
function back(){uni.navigateBack({fail:()=>uni.reLaunch({url:'/pages/index/index?tab=profile'})})}
function profilePage(){uni.reLaunch({url:'/pages/index/index?tab=profile'})}
function startTeam(){
 if(saving.value||writeUncertain.value||dissolving.value)return
 if(!profile.value?.nickname.trim()){notice.value='请先在个人中心填写昵称，再创建球队。';return}
 Object.assign(form,team.value?{name:team.value.name,district:team.value.district,description:team.value.description,contactPhone:team.value.contactPhone}:{name:'',district:'',description:'',contactPhone:''})
 if(!team.value)createRequest.value=teamRequestId()
 editingTeam.value=true;editingPlayer.value=false;playerValidationAttempted.value=false;error.value='';notice.value=''
}
function startPlayer(p?:TeamPlayer){
 if(saving.value||writeUncertain.value||dissolving.value)return
 playerId.value=p?.id||'p_'+teamRequestId();Object.assign(player,{name:p?.name||'',number:p?String(p.number):'',position:p?.position||''})
 editingPlayer.value=true;editingTeam.value=false;playerValidationAttempted.value=false;error.value='';notice.value=''
}
function failure(e:unknown){error.value=message(e);writeUncertain.value=['SERVICE_UNAVAILABLE','INVALID_RESPONSE','CONFLICT','ALREADY_EXISTS','NOT_FOUND'].includes((e as {code?:string})?.code||'');feedback('操作未完成，请查看页面提示')}
async function saveTeam(){
 if(saving.value||writeUncertain.value)return
 if(!form.name.trim()||!form.district||!form.contactPhone.trim()){error.value='请填写队名、所属区和领队联系电话。';feedback('请填写球队必填资料');return}
 const current=generation;saving.value=true;error.value='';notice.value=''
 try{const created=!team.value;const value=team.value?await updateMyTeam(team.value.version,{...form}):await createMyTeam(createRequest.value,{...form});if(current!==generation||!visible)return;team.value=value;editingTeam.value=false;success(created?'球队创建成功，你已成为领队。接下来添加球员名单。':'球队资料已保存。',created?'球队创建成功':'球队资料已保存')}catch(e){if(current===generation&&visible)failure(e)}finally{if(current===generation)saving.value=false}
}
async function savePlayer(){
 if(!team.value||saving.value||writeUncertain.value)return
 playerValidationAttempted.value=true;error.value=''
 if(Object.values(playerErrors.value).some(Boolean)||!player.position){feedback('请检查球员姓名、号码和位置');return}
 const current=generation;saving.value=true;error.value='';notice.value=''
 try{const value=await saveTeamPlayer(team.value.version,playerId.value,{name:player.name,number:Number(player.number),position:player.position});if(current!==generation||!visible)return;team.value=value;editingPlayer.value=false;playerValidationAttempted.value=false;success('球员名单已保存。')}catch(e){if(current===generation&&visible)failure(e)}finally{if(current===generation)saving.value=false}
}
async function remove(p:TeamPlayer){
 if(!team.value||saving.value||writeUncertain.value||dissolving.value)return
 const current=generation
 const choice=await new Promise<boolean>(resolve=>uni.showModal({title:'移出当前名单',content:`确定将 ${p.name}（${p.number}号）移出球队名单吗？`,confirmText:'移出名单',confirmColor:'#963a29',success:r=>resolve(r.confirm),fail:()=>resolve(false)}))
 if(current!==generation||!visible)return
 if(!choice){feedback('已取消移出');return}
 if(!team.value||saving.value||!visible)return
 saving.value=true;error.value='';notice.value=''
 try{const value=await removeTeamPlayer(team.value.version,p.id);if(current!==generation||!visible)return;team.value=value;success('球员已移出当前名单。')}catch(e){if(current===generation&&visible)failure(e)}finally{if(current===generation)saving.value=false}
}
async function startDissolution(){
 if(!team.value||saving.value||writeUncertain.value)return
 const current=generation;saving.value=true;error.value='';notice.value=''
 try{await checkTeamDissolution(team.value.version);if(current!==generation||!visible)return;confirmName.value='';dissolving.value=true}
 catch(e){if(current===generation&&visible)failure(e)}finally{if(current===generation)saving.value=false}
}
async function dissolve(){
 if(!team.value||saving.value||writeUncertain.value||!confirmationMatches.value)return
 const current=generation;saving.value=true;error.value='';notice.value=''
 try{await dissolveMyTeam(team.value.version,confirmName.value.trim());if(current!==generation||!visible)return;team.value=null;dissolving.value=false;confirmName.value='';editingTeam.value=false;editingPlayer.value=false;createRequest.value='';success('球队已解散，历史档案已保留。你现在可以重新创建球队。','球队已解散，可以重新建队')}
 catch(e){if(current===generation&&visible)failure(e)}finally{if(current===generation)saving.value=false}
}
</script>
<template>
<AppShell active="profile" detail live><view class="inner-page manage-team-page">
 <view class="section-heading"><button class="ui-button text-button" @click="back">← 返回个人中心</button><button v-if="profile" class="ui-button text-button" :disabled="saving||loading" @click="load">重新读取</button></view>
 <view class="team-page-heading"><text class="eyebrow">MY TEAM</text><text class="page-title">我的球队</text><text class="page-description">管理球队资料与球员名单，让每次上场都有准备。</text></view>
 <view v-if="!profile" class="panel team-login-state"><AppIcon name="users" :size="42" tone="green"/><text class="h2">登录后，管理你的球队</text><text class="muted">建队成功后自动成为领队，每人可管理一支球队。</text><text v-if="!supported" class="info-note">请在微信小程序中登录并管理球队。</text><text v-if="profileError" class="team-message error" role="alert">{{ profileError }}</text><button v-if="supported" class="ui-button primary-button" :disabled="profileLoading" :loading="profileLoading" @click="login">{{ profileLoading?'正在登录…':'微信登录' }}</button></view>
 <template v-else>
 <text v-if="error&&!editingTeam&&!editingPlayer&&!dissolving" class="team-message error" role="alert">{{ error }}</text><text v-if="notice" class="team-message success" role="status">{{ notice }}</text>
 <view v-if="writeUncertain" class="info-note"><text>请先重新读取云端资料，确认最新结果后再继续操作。重新读取将收起当前未保存的表单。</text><button class="ui-button outline-button" :disabled="saving" @click="load">重新读取球队</button></view>
 <view v-if="loading" class="panel competition-empty"><text>正在读取球队资料…</text></view>
 <view v-else-if="!ready" class="panel competition-empty"><text class="h3">暂时无法读取球队</text><button class="ui-button outline-button" @click="load">重新加载球队</button></view>
 <template v-else>
 <view v-if="!team&&!editingTeam" class="panel team-create-card"><view class="team-default-crest"><AppIcon name="ball" :size="36" tone="green"/></view><text class="h2">从一支球队开始</text><text class="muted">填写球队资料，成为领队，邀请你的队友一起上场。</text><view class="team-start-steps"><text>01 填写球队资料</text><text>02 添加球员名单</text><text>03 准备赛事报名</text></view><button v-if="profile.nickname" class="ui-button primary-button" @click="startTeam">创建我的球队</button><button v-else class="ui-button primary-button" @click="profilePage">先完善个人昵称</button><text class="small-text muted">每人管理一支球队，创建后可继续修改资料。</text></view>
 <view v-if="team&&!editingTeam" class="panel owned-team-card">
  <view class="owned-team-heading"><view class="team-default-crest"><text>{{ team.name.slice(0,1) }}</text></view><view class="owned-team-copy"><text class="team-district-tag">{{ team.district }} · 我的球队</text><text class="team-title">{{ team.name }}</text><text class="muted">你是球队领队 · {{ team.playerCount }} 名球员</text></view></view>
  <view class="team-contact"><text class="fact-label">领队联系电话</text><text>{{ team.contactPhone }}</text></view><view class="team-introduction"><text class="h3">球队介绍</text><text>{{ team.description||'暂未填写球队介绍，可在编辑资料中补充。' }}</text></view>
  <view class="team-card-footer"><text class="muted small-text">当前使用默认队徽，图片上传暂未开放。</text><button class="ui-button outline-button" :disabled="saving||writeUncertain||dissolving" @click="startTeam">编辑球队资料</button></view>
 </view>
 <view v-if="editingTeam" class="panel team-edit-panel">
  <view class="section-heading"><view><text class="h2">{{ isNew?'创建球队':'编辑球队资料' }}</text><text class="section-subtitle">带 * 的内容为必填项</text></view><button class="ui-button text-button" :disabled="saving" @click="editingTeam=false">取消</button></view>
  <view class="team-form-section"><text class="h3">球队资料</text><text class="team-form-description">队名与所属区用于识别球队，介绍可稍后补充。</text>
   <label class="team-field-label" for="team-name">球队名称 *</label><input id="team-name" class="team-input" v-model="form.name" :disabled="saving" maxlength="40" placeholder="请输入队名，最多40个字" aria-label="球队名称"/>
   <text class="team-field-label">所属区 *</text><picker :range="teamDistricts" :value="districtIndex" :disabled="saving" @change="form.district=teamDistricts[Number($event.detail.value)]"><view class="team-picker-input" :class="{placeholder:!form.district}" role="button" aria-label="选择球队所属区"><text>{{ form.district||'请选择上海所属区' }}</text><AppIcon name="down" :size="18"/></view></picker>
   <label class="team-field-label" for="team-description">球队介绍 <text class="muted">选填</text></label><textarea id="team-description" class="team-textarea" v-model="form.description" :disabled="saving" maxlength="500" placeholder="介绍球队故事、特点或训练安排" aria-label="球队介绍"/><text class="team-field-count">{{ Array.from(form.description).length }}/500</text>
  </view>
  <view class="team-form-section"><text class="h3">领队联系方式</text><text class="team-form-description">供赛事管理员联系，仅本人和授权管理员可查看。</text><label class="team-field-label" for="team-phone">联系电话 *</label><input id="team-phone" class="team-input" v-model="form.contactPhone" :disabled="saving" type="text" maxlength="30" placeholder="手机号或含区号的联系电话" aria-label="领队联系电话"/></view>
  <view class="info-note"><text>队徽上传暂未开放，创建后先使用默认队徽。{{ isNew?'创建成功后，你将自动成为球队领队。':'' }}</text></view>
  <text v-if="error" class="team-message error team-inline-message" role="alert">{{ error }}</text>
  <button class="ui-button primary-button team-save-button" :disabled="saving||writeUncertain" :loading="saving" @click="saveTeam">{{ saving?'正在保存…':isNew?'创建球队并成为领队':'保存球队资料' }}</button>
 </view>
 <view v-if="team" class="panel team-roster-panel">
  <view class="section-heading"><view><text class="h2">球员名单 <text class="roster-count">{{ team.playerCount }}</text></text><text class="section-subtitle">维护姓名、号码和场上位置</text></view><button v-if="!editingPlayer" class="ui-button outline-button" :disabled="saving||editingTeam||dissolving||writeUncertain" @click="startPlayer()">添加球员</button></view>
  <view v-if="editingPlayer" class="team-player-editor">
   <view class="section-heading"><text class="h3">{{ team.players.some(p=>p.id===playerId)?'编辑球员':'添加球员' }}</text><button class="ui-button text-button" :disabled="saving" @click="editingPlayer=false">取消</button></view>
   <label class="team-field-label" for="player-name">球员姓名 *</label><input id="player-name" class="team-input" :class="{'has-error':playerErrors.name}" v-model="player.name" :disabled="saving" maxlength="30" placeholder="请输入球员姓名" aria-label="球员姓名" :aria-invalid="!!playerErrors.name"/><text v-if="playerErrors.name" class="team-field-error" role="alert">{{ playerErrors.name }}</text>
   <view class="player-form-grid"><view><label class="team-field-label" for="player-number">球衣号码 *</label><input id="player-number" class="team-input" :class="{'has-error':playerErrors.number}" v-model="player.number" :disabled="saving" type="number" maxlength="2" placeholder="1–99" aria-label="球衣号码" :aria-invalid="!!playerErrors.number"/><text v-if="playerErrors.number" class="team-field-error" role="alert">{{ playerErrors.number }}</text></view><view><text class="team-field-label">位置 *</text><picker :range="playerPositions.map(p=>p.label)" :value="positionIndex" :disabled="saving" @change="player.position=playerPositions[Number($event.detail.value)].value"><view class="team-picker-input" :class="{'has-error':playerErrors.position}" role="button" aria-label="选择球员位置"><text>{{ player.position?positionLabel(player.position):'请选择' }}</text><AppIcon name="down" :size="16"/></view></picker><text v-if="playerErrors.position" class="team-field-error" role="alert">{{ playerErrors.position }}</text></view></view>
   <text class="team-form-description">同一支球队的球衣号码不能重复。</text><text v-if="error" class="team-message error team-inline-message" role="alert">{{ error }}</text><button class="ui-button primary-button team-save-button" :disabled="saving||writeUncertain" :loading="saving" @click="savePlayer">{{ saving?'正在保存…':'保存球员' }}</button>
  </view>
  <view v-if="!team.players.length&&!editingPlayer" class="team-roster-empty"><AppIcon name="users" :size="36" tone="muted"/><text class="h3">先添加第一名球员</text><text class="muted">完整名单将用于后续赛事报名。</text></view>
  <view v-for="p in team.players" :key="p.id" class="managed-player-row"><view class="managed-player-number">{{ p.number }}</view><view class="managed-player-copy"><text class="h3">{{ p.name }}</text><text class="muted">{{ positionLabel(p.position) }}</text></view><view class="managed-player-actions"><button class="ui-button text-button" :disabled="saving||editingTeam||editingPlayer||dissolving||writeUncertain" :aria-label="'编辑球员'+p.name" @click="startPlayer(p)">编辑</button><button class="ui-button text-button remove-player" :disabled="saving||editingTeam||editingPlayer||dissolving||writeUncertain" :aria-label="'移出球员'+p.name" @click="remove(p)">移出</button></view></view>
 </view>
 <view v-if="team" class="info-note">球队资料与名单已保存到当前微信账号。赛事报名将在后续开放，创建球队不等于报名成功。</view>
 <view v-if="team&&!editingTeam&&!editingPlayer" class="panel team-dissolve-panel">
  <text class="h3">球队管理</text>
  <text class="team-form-description">解散后可重新建队，原球队资料与球员名单保留在后台档案中。有关联报名、赛程或成绩的球队暂不能解散。</text>
  <template v-if="dissolving">
   <view class="team-dissolve-confirm"><text class="h3">确认解散这支球队？</text><text>解散后不能继续编辑或恢复原球队，请输入完整队名确认：</text><view class="team-confirm-name-row"><text class="team-confirm-name" selectable>{{ team.name }}</text><button class="ui-button text-button" @click="copyTeamName">复制队名</button></view>
   <label class="team-field-label" for="dissolve-team-name">确认球队名称</label><input id="dissolve-team-name" class="team-input" :value="confirmName" @input="inputConfirmation" @blur="inputConfirmation" @confirm="inputConfirmation" :disabled="saving" maxlength="100" confirm-type="done" placeholder="请输入或粘贴上方完整队名" aria-label="确认球队名称"/>
   <text class="team-confirm-hint" :class="{matched:confirmationMatches}" role="status">{{ dissolutionHint }}</text><text class="team-form-description">首尾空格会忽略，中间文字、空格和标点需一致。</text><text v-if="error" class="team-message error team-inline-message" role="alert">{{ error }}</text>
   <view class="team-dissolve-actions"><button class="ui-button outline-button" :disabled="saving" @click="dissolving=false;confirmName=''">暂不解散</button><button class="ui-button team-danger-button" :disabled="saving||writeUncertain||!confirmationMatches" :loading="saving" @click="dissolve">确认解散球队</button></view></view>
  </template>
  <button v-else class="ui-button outline-button team-dissolve-start" :disabled="saving||writeUncertain" :loading="saving" @click="startDissolution">解散球队</button>
 </view>
 </template></template>
</view></AppShell>
</template>
