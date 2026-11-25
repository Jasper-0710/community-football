<script setup lang="ts">
import type {ExternalTarget} from '../../src/domain/external-entries'
const props=defineProps<{modelValue:ExternalTarget;label:string;allowNone?:boolean}>()
const emit=defineEmits<{ 'update:modelValue':[value:ExternalTarget] }>()
function kind(event:Event){emit('update:modelValue',{kind:(event.target as HTMLSelectElement).value as ExternalTarget['kind'],appId:'',path:'',url:''})}
</script>
<template>
 <div class="external-target-editor">
  <label>{{label}}目标类型<select :value="modelValue.kind" :aria-label="`${label}目标类型`" @change="kind"><option v-if="allowNone" value="none">仅图片介绍，不跳转</option><option value="miniProgram">微信小程序</option><option value="https">HTTPS 网页</option></select></label>
  <template v-if="modelValue.kind==='miniProgram'"><label>{{label}}小程序 AppID<input v-model="props.modelValue.appId" :aria-label="`${label}小程序 AppID`" maxlength="18" placeholder="wx 开头的18位 AppID" /></label><label>{{label}}页面路径<input v-model="props.modelValue.path" :aria-label="`${label}页面路径`" maxlength="1024" placeholder="pages/index/index（留空打开首页）" /></label><p class="muted">打开目标小程序的正式版；页面路径可附带查询参数。</p></template>
  <template v-else-if="modelValue.kind==='https'"><label>{{label}}网页地址<input v-model="props.modelValue.url" :aria-label="`${label}网页地址`" maxlength="2000" placeholder="https://…" /></label><p class="muted">微信端使用内置网页，需配置目标站点的业务域名；H5 在当前页面打开。</p></template>
 </div>
</template>
