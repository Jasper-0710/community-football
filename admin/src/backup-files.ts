import {canonicalBackup,BackupClientError,type BackupSummary} from '../../src/domain/recovery'
export async function backupDigest(text:string){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('')}
export async function inspectBackupFile(file:File,environment:string){
 if(file.size>2*1024*1024||!file.name.toLowerCase().endsWith('.json'))throw new BackupClientError('请选择不超过2MiB的原始JSON备份。')
 let payload:any
 try{payload=JSON.parse(await file.text())}catch{throw new BackupClientError('JSON无法解析，请选择完整备份文件。')}
 if(payload?.format!=='community-football-backup'||payload.schemaVersion!==1||!/^b_[a-f0-9]{32}$/.test(payload.id)||payload.environment!==environment||!payload.collections||!Array.isArray(payload.assets))throw new BackupClientError('备份版本或云环境不匹配。')
 const text=canonicalBackup(payload)
 if(new TextEncoder().encode(text).length>2*1024*1024)throw new BackupClientError('JSON备份超过2MiB。')
 return{id:payload.id as string,digest:await backupDigest(text)}
}
export async function downloadBackup(backup:BackupSummary,read:(index:number)=>Promise<{index:number;total:number;data:string}>){
 const total=Math.ceil(backup.bytes/32768),parts:Uint8Array[]=[];let size=0
 for(let index=0;index<total;index++){
  const page=await read(index)
  if(page.index!==index||page.total!==total||typeof page.data!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(page.data)||page.data.length>43692)throw new BackupClientError('备份分片返回异常，请重新下载。')
  const bytes=Uint8Array.from(atob(page.data),ch=>ch.charCodeAt(0));size+=bytes.length;parts.push(bytes)
 }
 if(size!==backup.bytes)throw new BackupClientError('备份下载不完整。')
 const all=new Uint8Array(size);let offset=0;for(const part of parts){all.set(part,offset);offset+=part.length}
 const text=new TextDecoder('utf-8',{fatal:true}).decode(all)
 if(await backupDigest(text)!==backup.digest)throw new BackupClientError('备份校验失败，请重新下载。')
 const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download=`${backup.id}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
