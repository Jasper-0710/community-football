<script setup lang="ts">
defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
import {computed,onUnmounted,ref} from 'vue'
import {type ManagedTeam} from '@/domain/team'
import {chooseTeamBadge,uploadTeamBadge,saveTeamBadge,removeTeamBadge,type BadgeDraft} from '@/services/team-badges'
const props=defineProps<{team:ManagedTeam;disabled:boolean}>()
const emit=defineEmits<{locked:[value:boolean];saved:[]}>()
const draft=ref<BadgeDraft|null>(null),busy=ref(false),error=ref(''),uncertain=ref(false),failed=ref(false),removing=ref(false)
const source=computed(()=>removing.value?'':draft.value?.path||props.team.badgeUrl)
let generation=0
function lock(){emit('locked',busy.value||!!draft.value||removing.value||uncertain.value)}
function cancel(){if(busy.value)return;generation++;draft.value=null;removing.value=false;error.value='';failed.value=false;lock()}
async function choose(){
 if(!props.team.badgeUploadEnabled||busy.value||props.disabled||uncertain.value)return
 const serial=++generation;busy.value=true;error.value='';lock()
 try{const selected=await chooseTeamBadge();if(serial===generation&&selected){draft.value=selected;removing.value=false;failed.value=false}}
 catch(e){if(serial===generation)error.value=e instanceof Error?e.message:'队徽选择失败，请重试。'}
 finally{if(serial===generation){busy.value=false;lock()}}
}
function remove(){if(!props.team.badgeUploadEnabled||busy.value||props.disabled||uncertain.value)return;draft.value=null;removing.value=true;error.value='';failed.value=false;lock()}
async function save(){
 if(!props.team.badgeUploadEnabled||busy.value||props.disabled||uncertain.value||failed.value||!draft.value&&!removing.value)return
 const serial=generation;busy.value=true;error.value='';lock();let committing=false
 try{
   if(removing.value){committing=true;await removeTeamBadge(props.team.id,props.team.version)}
   else if(draft.value){const d=draft.value;const image=d.imageId?{id:d.imageId}:await uploadTeamBadge(props.team.id,d,()=>serial===generation);if(serial!==generation)return;committing=true;await saveTeamBadge(props.team.id,props.team.version,image.id)}
   if(serial!==generation)return
   busy.value=false;draft.value=null;removing.value=false;lock();emit('saved')
 }catch(e){if(serial===generation){error.value=e instanceof Error?e.message:'队徽保存失败，请重试。';const code=(e as {code?:string})?.code;uncertain.value=committing&&['SERVICE_UNAVAILABLE','INVALID_RESPONSE','CONFLICT','NOT_FOUND'].includes(code||'')}}
 finally{if(serial===generation){busy.value=false;lock()}}
}
function refresh(){if(!busy.value&&!props.disabled)emit('saved')}
onUnmounted(()=>{generation++;emit('locked',false)})
</script>
<template>
 <view class="panel team-badge-editor">
  <view class="section-heading"><view><text class="h2">球队队徽</text><text class="section-subtitle">选图并预览，保存后同步到球队档案</text></view><text class="team-badge-state">{{ draft||removing?'待保存':team.hasBadge?'已设置':'默认队徽' }}</text></view>
  <view class="team-badge-preview-row"><view class="team-default-crest team-badge-preview"><image v-if="source&&!failed" :src="source" mode="aspectFit" aria-label="球队队徽预览" @error="failed=true"/><text v-else>{{ team.name.slice(0,1) }}</text></view><view class="team-badge-copy"><text class="h3">{{ removing?'保存后恢复默认队徽':draft?'已选择新队徽':team.hasBadge?'当前球队队徽':'使用默认队徽' }}</text><text class="team-form-description">支持JPG、PNG，自动缩小至最长边512像素，处理后不超过256KiB。</text></view></view>
  <view class="team-badge-actions"><button class="ui-button outline-button" :disabled="!team.badgeUploadEnabled||busy||disabled||uncertain" @click="choose">{{ draft||team.hasBadge?'更换队徽':'选择队徽' }}</button><button v-if="team.badgeUploadEnabled&&team.hasBadge&&!removing" class="ui-button text-button" :disabled="busy||disabled||uncertain" @click="remove">恢复默认队徽</button><button v-if="draft||removing" class="ui-button text-button" :disabled="busy||disabled||uncertain" @click="cancel">取消本次修改</button></view>
  <text v-if="!team.badgeUploadEnabled" class="team-form-description">当前环境尚未开放队徽上传，已有队徽仍可查看。开放后可点击上方按钮选择图片。</text>
  <view v-if="busy" class="team-badge-progress" role="status"><progress v-if="draft" :percent="draft.progress" activeColor="#17674c" stroke-width="5"/><text>{{ draft?`正在上传并保存队徽 ${draft.progress}%`:'正在处理队徽…' }}</text></view>
  <text v-if="error" class="team-field-error" role="alert">{{ error }}</text>
  <text v-if="failed&&draft" class="team-field-error" role="alert">选中的图片无法预览，请重新选择或取消本次修改。</text>
  <text v-if="removing" class="team-form-description">保存后将移除当前队徽；取消本次修改可保留原图。</text>
  <button v-if="team.hasBadge&&(!team.badgeUrl||failed&&!draft)||uncertain" class="ui-button outline-button team-badge-refresh" :disabled="busy||disabled" @click="refresh">重新读取队徽</button>
  <button v-if="team.badgeUploadEnabled&&(draft||removing)" class="ui-button primary-button team-save-button" :disabled="busy||disabled||uncertain||failed&&!!draft" :loading="busy" @click="save">{{ busy?'正在保存队徽…':error&&!uncertain?'重试保存队徽':'保存队徽' }}</button>
 </view>
</template>
