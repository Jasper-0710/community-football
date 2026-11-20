export interface BackupSummary { id:string; createdAt:string; kind:'manual'|'before_restore'; digest:string; bytes:number; records:number; assetCount:number; environment:string }
export interface RestorePlan { id:string; backupId:string; expiresAt:string; totalChanges:number; assetCount:number; confirmation:string; summary:{collection:string;created:number;updated:number;removed:number;unchanged:number}[] }
export interface BackupStatus { enabled:boolean; guardsReady:boolean; environment:string; limits:{records:number;jsonBytes:number;changes:number;assets:number;assetBytes:number} }
const integer=(v:unknown,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=max
const iso=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))
export class BackupClientError extends Error {constructor(message='备份服务回执异常，请重新读取。'){super(message)}}
export function parseBackup(value:any):BackupSummary{
 if(!value||!/^b_[a-f0-9]{32}$/.test(value.id)||!iso(value.createdAt)||!['manual','before_restore'].includes(value.kind)||!/^[a-f0-9]{64}$/.test(value.digest)||!integer(value.bytes,2*1024*1024)||!integer(value.records,2000)||!integer(value.assetCount,32)||typeof value.environment!=='string'||!value.environment)throw new BackupClientError()
 return{id:value.id,createdAt:value.createdAt,kind:value.kind,digest:value.digest,bytes:value.bytes,records:value.records,assetCount:value.assetCount,environment:value.environment}
}
export function parseBackupStatus(value:any):BackupStatus{
 if(value?.ok!==true||typeof value.enabled!=='boolean'||typeof value.guardsReady!=='boolean'||typeof value.environment!=='string'||!value.limits||!['records','jsonBytes','changes','assets','assetBytes'].every(key=>integer(value.limits[key])))throw new BackupClientError()
 return{enabled:value.enabled,guardsReady:value.guardsReady,environment:value.environment,limits:{...value.limits}}
}
export function parseRestorePlan(value:any):RestorePlan{
 if(!value||!/^rp_[a-f0-9]{32}$/.test(value.id)||!/^b_[a-f0-9]{32}$/.test(value.backupId)||!iso(value.expiresAt)||!integer(value.totalChanges,80)||!integer(value.assetCount,32)||value.confirmation!==`恢复 ${value.backupId}`||!Array.isArray(value.summary)||value.summary.length!==19)throw new BackupClientError()
 const names=new Set<string>(),summary=value.summary.map((row:any)=>{if(typeof row.collection!=='string'||names.has(row.collection)||!['created','updated','removed','unchanged'].every(key=>integer(row[key],2000)))throw new BackupClientError();names.add(row.collection);return{collection:row.collection,created:row.created,updated:row.updated,removed:row.removed,unchanged:row.unchanged}})
 if(summary.reduce((n:number,r:any)=>n+r.created+r.updated+r.removed,0)!==value.totalChanges)throw new BackupClientError()
 return{id:value.id,backupId:value.backupId,expiresAt:value.expiresAt,totalChanges:value.totalChanges,assetCount:value.assetCount,confirmation:value.confirmation,summary}
}
export function canonicalBackup(value:any):string{if(Array.isArray(value))return'['+value.map(canonicalBackup).join(',')+']';if(value&&typeof value==='object')return'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalBackup(value[key])).join(',')+'}';return JSON.stringify(value)}
