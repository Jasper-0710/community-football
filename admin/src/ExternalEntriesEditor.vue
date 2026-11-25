<script setup lang="ts">
import {computed,onMounted,onUnmounted,reactive,ref} from 'vue'
import type {ExternalEntries,PlatformDisplayImage} from '../../src/domain/external-entries'
import {PLATFORM_IMAGE_LIMIT} from '../../src/domain/external-entries'
import type {NewsImageCleanup,NewsImageConfig} from '../../src/domain/news-image'
import type {createAdminAuth} from './auth'
import {prepareNewsImage,type NewsImageDraft} from './news-images'
import {uploadPlatformImage} from './platform-images'
import ExternalTargetEditor from './ExternalTargetEditor.vue'
const props=defineProps<{modelValue:ExternalEntries;images:readonly PlatformDisplayImage[];auth:ReturnType<typeof createAdminAuth>;disabled:boolean}>()
const emit=defineEmits<{'update:modelValue':[value:ExternalEntries];busy:[value:boolean]}>()
const config=ref<NewsImageConfig|null>(null),error=ref(''),notice=ref(''),busy=ref(false),draft=ref<NewsImageDraft|null>(null),replaceAt=ref(-1),cleanup=ref<NewsImageCleanup|null>(null),cursor=ref<string|undefined>(),fileInput=ref<HTMLInputElement|null>(null)
const previews=reactive<Record<string,string>>({}),failed=ref<string[]>([])
let disposed=false
const urls=computed(()=>({...Object.fromEntries(props.images.map(x=>[x.id,x.url])),...previews}))
const locked=computed(()=>props.disabled||busy.value)
function working(value:boolean){busy.value=value;emit('busy',value)}
async function loadConfig(){if(busy.value)return;working(true);error.value='';try{const next=await props.auth.authorized((api,token)=>api.platformImageConfig(token));if(!disposed)config.value=next}catch(e){if(!disposed)error.value=e instanceof Error?e.message:'图片配置读取失败。'}finally{if(!disposed)working(false)}}
function choose(index=-1){if(locked.value||!config.value?.enabled||index<0&&props.modelValue.insurance.images.length>=PLATFORM_IMAGE_LIMIT)return;replaceAt.value=index;fileInput.value?.click()}
async function selected(event:Event){const input=event.target as HTMLInputElement,file=input.files?.[0];input.value='';if(!file)return;draft.value=null;error.value='';notice.value='';working(true);try{draft.value=await prepareNewsImage(file);if(!disposed)await upload()}catch(e){if(!disposed)error.value=e instanceof Error?e.message:'图片上传失败。'}finally{if(!disposed)working(false)}}
async function upload(){if(!draft.value)return;working(true);error.value='';try{
 const image=await uploadPlatformImage(draft.value,props.auth.authorized,()=>!disposed)
 if(disposed)return
 const images=props.modelValue.insurance.images.map(x=>({...x})),entry={imageId:image.id,caption:images[replaceAt.value]?.caption||''}
 if(replaceAt.value>=0){if(!images[replaceAt.value])throw new Error('待替换图片已变化，请重新选择。');images[replaceAt.value]=entry}else{if(images.length>=PLATFORM_IMAGE_LIMIT)throw new Error('最多保留6张图片，请先移除一张。');images.push(entry)}
 previews[image.id]=image.url;emit('update:modelValue',{...props.modelValue,insurance:{...props.modelValue.insurance,images}});draft.value=null;notice.value='图片已上传，保存平台设置后客户端生效。';cleanup.value=null
 }catch(e){if(!disposed)error.value=e instanceof Error?e.message:'图片上传失败，可重试。'}finally{if(!disposed)working(false)}}
function remove(index:number){const images=props.modelValue.insurance.images.filter((_,i)=>i!==index);emit('update:modelValue',{...props.modelValue,insurance:{...props.modelValue.insurance,images}});notice.value='已从编辑内容移除，保存后生效。旧图在保留期后才能清理。';draft.value=null;cleanup.value=null}
function move(index:number,step:number){const images=[...props.modelValue.insurance.images],target=index+step;if(target<0||target>=images.length)return;[images[index],images[target]]=[images[target],images[index]];emit('update:modelValue',{...props.modelValue,insurance:{...props.modelValue.insurance,images}});draft.value=null}
async function checkCleanup(next=false,execute=false){if(locked.value)return;working(true);error.value='';try{if(!next&&!execute)cursor.value=undefined;if(next)cursor.value=cleanup.value?.nextCursor||undefined;const result=await props.auth.authorized((api,token)=>api.cleanupPlatformImages(token,!execute,cursor.value));if(!disposed){cleanup.value=result;notice.value=execute?'已按实际引用重新检查并清理本页到期文件。':''}}catch(e){if(!disposed)error.value=e instanceof Error?e.message:'图片清理失败。'}finally{if(!disposed)working(false)}}
onMounted(loadConfig);onUnmounted(()=>{disposed=true})
</script>
<template>
 <div class="external-entries-editor">
  <h2>社区入口</h2><p class="muted">配置独立社区入口，保存并启用后展示在客户端首页。</p>
  <label class="external-toggle"><input v-model="modelValue.community.enabled" type="checkbox" />启用社区入口</label>
  <div class="form-grid"><label>社区入口名称<input v-model="modelValue.community.label" maxlength="24" required /></label><label>社区入口说明<input v-model="modelValue.community.description" maxlength="200" /></label></div>
  <ExternalTargetEditor v-model="modelValue.community.target" label="社区" />
  <h2>投保图片专栏</h2><p class="muted">仅提供图片介绍和外部入口。图片上传后需保存设置，不含保单或支付功能。</p>
  <label class="external-toggle"><input v-model="modelValue.insurance.enabled" type="checkbox" />启用投保专栏</label>
  <div class="form-grid"><label>投保专栏标题<input v-model="modelValue.insurance.title" maxlength="40" required /></label><label>投保按钮文字<input v-model="modelValue.insurance.buttonLabel" maxlength="24" required /></label></div>
  <label>投保专栏说明<textarea v-model="modelValue.insurance.description" maxlength="400" rows="3" /></label>
  <ExternalTargetEditor v-model="modelValue.insurance.target" label="投保" allow-none />
  <p v-if="error" class="notice" role="alert">{{error}}</p><p v-if="notice" class="notice success" role="status">{{notice}}</p>
  <p v-if="config&&!config.enabled" class="notice">投保图片上传尚未开放，请在 adminAuth 配置 PLATFORM_IMAGE_UPLOADS_ENABLED=true。</p>
  <button v-if="!config" type="button" class="secondary-button" :disabled="locked" @click="loadConfig">重新读取投保图片配置</button>
  <div class="platform-image-grid"><div v-for="(image,index) in modelValue.insurance.images" :key="image.imageId" class="platform-image-card">
   <img v-if="urls[image.imageId]&&!failed.includes(image.imageId)" :src="urls[image.imageId]" :alt="image.caption||`投保介绍图片 ${index+1}`" @error="failed.push(image.imageId)" /><p v-else class="muted">图片预览暂不可用，请重新读取设置。</p>
   <label>图片说明 {{index+1}}<input v-model="image.caption" :aria-label="`投保图片说明 ${index+1}`" maxlength="200" /></label>
   <div class="content-actions"><button type="button" class="secondary-button" :disabled="locked||!config?.enabled" :aria-label="`替换投保图片 ${index+1}`" @click="choose(index)">替换</button><button type="button" class="secondary-button" :disabled="locked" :aria-label="`移除投保图片 ${index+1}`" @click="remove(index)">移除</button><button type="button" class="secondary-button" :disabled="locked||index===0" :aria-label="`上移投保图片 ${index+1}`" @click="move(index,-1)">上移</button><button type="button" class="secondary-button" :disabled="locked||index===modelValue.insurance.images.length-1" :aria-label="`下移投保图片 ${index+1}`" @click="move(index,1)">下移</button></div>
  </div></div>
  <input ref="fileInput" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" class="platform-file-input" aria-label="选择投保图片" @change="selected" />
  <div class="content-actions"><button type="button" class="secondary-button" :disabled="locked||!config?.enabled||modelValue.insurance.images.length>=PLATFORM_IMAGE_LIMIT" @click="choose()">上传投保图片</button><button v-if="draft" type="button" class="secondary-button" :disabled="locked" @click="upload">重试上传投保图片</button></div>
  <p class="muted">{{modelValue.insurance.images.length}} / 6 张 · JPG / PNG，每张不超过2MB，边长不超过4096像素，总像素不超过800万。{{draft?`本次上传 ${draft.progress}%`:''}}</p>
  <details class="platform-image-cleanup"><summary>投保图片维护</summary><p class="muted">已保存引用的图片受保护。移除图片后保留24小时；分片还需等待上传租约结束。每次检查最多20条。</p><div class="content-actions"><button type="button" class="secondary-button" :disabled="locked" @click="checkCleanup()">检查待清理投保图片</button><button v-if="cleanup?.nextCursor" type="button" class="secondary-button" :disabled="locked" @click="checkCleanup(true)">检查下一页投保图片</button><button v-if="cleanup?.dryRun&&cleanup.eligibleObjects" type="button" class="secondary-button" :disabled="locked" @click="checkCleanup(false,true)">清理本页到期投保图片</button></div><p v-if="cleanup" role="status">扫描 {{cleanup.scanned}} 张；保护 {{cleanup.protectedImages}} 张；可清理 {{cleanup.eligibleObjects}} 个文件；已清理 {{cleanup.removedObjects}} 个；延后 {{cleanup.deferredImages}} 张。</p></details>
 </div>
</template>
<style scoped>
.external-toggle { display:flex; align-items:center; gap:10px; margin:16px 0; }.external-toggle input { width:18px; min-height:18px; height:18px; margin:0; }.external-target-editor { padding:16px; margin:16px 0; background:#f5f7f5; border-radius:8px; }.platform-image-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }.platform-image-card { min-width:0; padding:12px; border:1px solid #dce4dd; border-radius:8px; }.platform-image-card img { width:100%; height:160px; object-fit:contain; background:#f5f7f5; }.platform-image-card .content-actions { gap:6px; flex-wrap:wrap; }.platform-image-card button { padding:8px 10px; }.platform-file-input { display:none; }.platform-image-cleanup { margin:24px 0; padding:16px; border:1px solid #dce4dd; border-radius:8px; }.platform-image-cleanup summary { cursor:pointer; font-weight:600; }@media(max-width:600px){.platform-image-grid { grid-template-columns:minmax(0,1fr); }}
</style>
