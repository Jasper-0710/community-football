<script setup lang="ts">
import {computed,onMounted,onUnmounted,reactive,ref} from 'vue'
import {defaultPlatformForm,parsePlatformForm,themeTokens,themes,navigationIcons,type PlatformSettings} from '../../src/domain/platform-settings'
import type {createAdminAuth} from './auth'
import ExternalEntriesEditor from './ExternalEntriesEditor.vue'
const props=defineProps<{auth:ReturnType<typeof createAdminAuth>}>()
const iconNames:Record<string,string>={home:'首页',calendar:'赛历',news:'新闻',trophy:'奖杯',search:'搜索',user:'个人',ball:'足球',users:'球队',bracket:'对阵'}
const form=reactive(defaultPlatformForm()),record=ref<PlatformSettings|null>(null),busy=ref(false),error=ref(''),notice=ref(''),needsRead=ref(false)
const preview=computed(()=>themeTokens(form)),dirty=computed(()=>record.value&&JSON.stringify(form)!==JSON.stringify(record.value.form))
const imageBusy=ref(false),readRevision=ref(0)
const locked=computed(()=>busy.value||imageBusy.value)
let disposed=false,requestId='',payload=''
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v))
async function load(){if(locked.value)return;busy.value=true;error.value='';notice.value='';try{const next=await props.auth.authorized((api,token)=>api.platformSettings(token));if(disposed)return;record.value=next;readRevision.value++;Object.assign(form,clone(next.form));needsRead.value=false;requestId='';payload=''}catch(e){if(!disposed)error.value=e instanceof Error?e.message:'平台设置读取失败。'}finally{if(!disposed)busy.value=false}}
async function save(){
 if(locked.value||!record.value||needsRead.value)return
 error.value='';notice.value=''
 try{parsePlatformForm(form)}catch(e){error.value=e instanceof Error?e.message:'请检查平台设置。';return}
 const submitted=clone(form),signature=JSON.stringify({version:record.value.version,form:submitted})
 if(payload!==signature){payload=signature;requestId=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')}
 busy.value=true
 try{const next=await props.auth.authorized((api,token)=>api.savePlatformSettings(token,record.value!.version,requestId,submitted));if(disposed)return;record.value=next;Object.assign(form,clone(next.form));notice.value='平台设置已保存。客户端重新进入页面或回到前台时同步。';requestId='';payload=''}
 catch(e){if(disposed)return;error.value=e instanceof Error?e.message:'保存结果暂不确定，请重新读取确认。';if(e&&typeof e==='object'&&'code'in e&&e.code==='CONFLICT')needsRead.value=true}
 finally{if(!disposed)busy.value=false}
}
function move(index:number,delta:number){const target=index+delta;if(target<0||target>=6)return;const [item]=form.navigation.splice(index,1);form.navigation.splice(target,0,item)}
function defaults(){const external=clone(form.external);Object.assign(form,defaultPlatformForm(),{external});notice.value='已恢复默认外观预览，社区与投保内容保留，保存后生效。'}
onMounted(load);onUnmounted(()=>{disposed=true})
</script>
<template>
 <section class="platform-settings-admin">
  <div class="workspace-heading"><div><span class="eyebrow">平台外观</span><h1>平台设置</h1><p class="muted">统一客户端外观、站内导航、社区入口和投保图片专栏。</p></div><button class="secondary-button" :disabled="locked" @click="load">重新读取设置</button></div>
  <p v-if="error" class="notice" role="alert">{{error}}</p><p v-if="notice" class="notice success" role="status">{{notice}}</p>
  <p v-if="!record&&!error" role="status">正在读取平台设置…</p>
  <div v-if="record" class="platform-settings-layout">
   <form class="account-card competition-form platform-settings-form" @submit.prevent="save">
    <fieldset :disabled="locked">
     <div class="card-heading"><h2>平台资料</h2><span class="muted">{{record.version?`版本 ${record.version}`:'尚未保存，使用默认设置'}}</span></div>
     <label>平台名称<input v-model="form.title" maxlength="32" required placeholder="中国社超" /></label>
     <label>平台副标题<input v-model="form.subtitle" maxlength="48" required placeholder="上海赛区赛事平台" /></label>
     <h2>默认主题</h2><div class="settings-theme-grid"><button v-for="theme in themes" :key="theme.id" type="button" class="settings-theme-choice" :aria-pressed="form.theme===theme.id" @click="form.theme=theme.id"><span :style="{background:theme.color}"></span>{{theme.name}}</button></div>
     <div class="form-grid"><label>配色方式<select v-model="form.theme" aria-label="配色方式"><option v-for="theme in themes" :key="theme.id" :value="theme.id">{{theme.name}}</option><option value="custom">自选颜色</option></select></label><label>自选主色<input v-model="form.customColor" maxlength="7" pattern="#[0-9a-fA-F]{6}" placeholder="#1e6b48" :disabled="form.theme!=='custom'" /></label><label>明暗模式<select v-model="form.mode" aria-label="明暗模式"><option value="light">浅色</option><option value="dark">深色</option></select></label><label>圆角风格<select v-model="form.radius" aria-label="圆角风格"><option value="square">直角</option><option value="soft">柔和</option><option value="round">圆润</option></select></label></div>
     <h2>六个站内入口</h2><p class="muted">调整名称、图标和顺序。入口分别连接首页、赛事、动态、数据、搜索和个人中心。</p>
     <div v-for="(item,index) in form.navigation" :key="item.id" class="settings-nav-row"><span class="settings-nav-index">{{index+1}}</span><label>导航名称<input v-model="item.label" :aria-label="`导航名称 ${item.id}`" maxlength="8" required /></label><label>导航图标<select v-model="item.icon" :aria-label="`导航图标 ${item.id}`"><option v-for="icon in navigationIcons" :key="icon" :value="icon">{{iconNames[icon]}}</option></select></label><div class="settings-order"><button class="secondary-button" type="button" :aria-label="`上移 ${item.id}`" :disabled="index===0" @click="move(index,-1)">上移</button><button class="secondary-button" type="button" :aria-label="`下移 ${item.id}`" :disabled="index===5" @click="move(index,1)">下移</button></div></div>
     <ExternalEntriesEditor :key="readRevision" v-model="form.external" :images="record.insuranceImages||[]" :auth="auth" :disabled="busy||needsRead" @busy="imageBusy=$event" />
     <div class="content-actions"><button class="primary-button" type="submit" :disabled="needsRead||(!dirty&&record.version>0)">{{busy?'正在保存…':'保存平台设置'}}</button><button class="secondary-button" type="button" @click="defaults">恢复默认预览</button></div>
     <p v-if="needsRead" class="notice">设置已有新版本，请重新读取后修改。</p><p v-else class="muted">外观与外部入口的修改仅在保存后生效。读取会以已保存内容替换当前编辑。</p>
    </fieldset>
   </form>
   <aside class="settings-preview" :class="{'settings-preview-dark':form.mode==='dark'}" :style="preview" aria-label="客户端外观预览"><div class="settings-preview-top"><img src="/brand.png" alt="" /><div><strong>{{form.title}}</strong><span>{{form.subtitle}}</span></div></div><div class="settings-preview-body"><span class="settings-preview-label">客户端预览</span><h2>社区足球，每周相见</h2><p>赛事、动态与球队，汇聚在这里。</p><div class="settings-preview-card"><strong>周末社区杯</strong><span>赛程与对阵</span><button type="button" tabindex="-1">查看赛事</button></div></div><div class="settings-preview-nav"><div v-for="(item,index) in form.navigation" :key="item.id" :class="{'preview-active':index===0}"><span :class="{'settings-preview-icon-black':index===0&&preview['--on-accent']==='#000000'}"><img :src="`/icons/${item.icon}-${index===0?(preview['--on-accent']==='#ffffff'?'white':'ink'):(form.mode==='dark'?'white':'muted')}.png`" alt="" /></span><small>{{item.label}}</small></div></div><p class="settings-preview-caption">{{dirty?'未保存的预览':'当前已保存设置'}}</p></aside>
  </div>
 </section>
</template>
