'use strict'
const M=require('./registration-model')
const date=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=8640000000000000?new Date(value).toISOString():typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null
const belongs=(file,r)=>file&&file.registrationId===r._id&&file.ownerUserId===r.ownerUserId&&file.competitionId===r.competitionId
const available=file=>file.status==='ready'&&typeof file.fileID==='string'&&file.fileID.length>0&&!(file.removedFileIDs||[]).includes(file.fileID)
async function historyFiles(store,r,event){
 if(!Number.isSafeInteger(event.expectedVersion)||event.expectedVersion<1||event.cursor!=null&&!M.FID.test(event.cursor))M.fail('INVALID_ARGUMENT','材料分页请求无效，请重新读取报名。')
 if(event.expectedVersion!==r.version)M.fail('CONFLICT','报名记录已更新，请重新读取后查看历史材料。')
 const rows=await store.listBoundFiles({registrationId:r._id,cursor:event.cursor||null,limit:21})
 if(rows.length>21||rows.some((f,i)=>!belongs(f,r)||!M.FID.test(f._id)||event.cursor&&f._id<=event.cursor||i>0&&f._id<=rows[i-1]._id))throw new Error('Unexpected registration file page')
 const current=await store.read(r._id)
 if(!current||current.version!==r.version)M.fail('CONFLICT','报名记录已更新，请重新读取后查看历史材料。')
 const ids=new Set(r.attachments.map(f=>f.id))
 return {ok:true,registrationId:r._id,version:r.version,files:rows.slice(0,20).filter(f=>!ids.has(f._id)&&available(f)).map(f=>({...M.fileView(f),uploadedAt:date(f.createdAt),firstSubmittedAt:date(f.firstSubmittedAt)})),nextCursor:rows.length>20?rows[19]._id:null}
}
async function findFile(store,r,id){
 if(typeof id!=='string'||!M.FID.test(id))M.fail('NOT_FOUND','附件不存在。')
 const current=r.attachments.find(f=>f.id===id)
 if(current)return current
 const file=await store.transaction(tx=>tx.get('registrationFiles',id))
 if(!belongs(file,r)||!available(file))M.fail('NOT_FOUND','附件不存在。')
 return file
}
module.exports={historyFiles,findFile}
