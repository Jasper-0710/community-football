import {onScopeDispose,ref,watch,type Ref} from 'vue'
import {RegistrationClientError,type RegistrationDetail,type RegistrationFileHistory,type RegistrationHistoricalFile} from '../domain/registration'

export function useRegistrationFileHistory(record:Ref<RegistrationDetail|null>,read:(id:string,version:number,cursor?:string)=>Promise<RegistrationFileHistory>){
 const expanded=ref(false),loaded=ref(false),loading=ref(false),error=ref(''),stale=ref(false)
 const files=ref<RegistrationHistoricalFile[]>([]),cursor=ref<string|null>(null)
 let generation=0
 function reset(){generation++;expanded.value=false;loaded.value=false;loading.value=false;error.value='';stale.value=false;files.value=[];cursor.value=null}
 watch(()=>[record.value?.id,record.value?.version],reset,{flush:'sync'})
 onScopeDispose(reset)
 async function load(more=false){
  const r=record.value
  if(!r||loading.value||stale.value||more&&!cursor.value)return
  const current=generation,previous=more?cursor.value:null
  loading.value=true;error.value=''
  if(!more){files.value=[];cursor.value=null;loaded.value=false}
  try{
   const page=await read(r.id,r.version,previous||undefined)
   if(current!==generation)return
   if(page.registrationId!==r.id||page.version!==r.version||previous&&page.nextCursor&&page.nextCursor<=previous||page.files.some(f=>(previous&&f.id<=previous)||r.attachments.some(a=>a.id===f.id)||files.value.some(a=>a.id===f.id)))throw new RegistrationClientError('INVALID_RESPONSE','历史材料返回异常，请重新读取报名。')
   files.value=more?[...files.value,...page.files]:page.files;cursor.value=page.nextCursor;loaded.value=true
  }catch(e){
   if(current!==generation)return
   stale.value=(e as {code?:string})?.code==='CONFLICT'
   if(stale.value){files.value=[];cursor.value=null;loaded.value=false}
   error.value=e instanceof Error?e.message:'历史材料读取失败，请重试。'
  }finally{if(current===generation)loading.value=false}
 }
 async function toggle(){expanded.value=!expanded.value;if(expanded.value&&!loaded.value)await load()}
 return {expanded,loaded,loading,error,stale,files,cursor,load,toggle}
}
