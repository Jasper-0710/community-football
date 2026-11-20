'use strict'
const cloud=require('wx-server-sdk')
const tcb=require('@cloudbase/node-sdk')
const {createPublicReadService,PUBLIC_ACTIONS}=require('./service')
const {createHttpHandler}=require('./http')
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV})
const environment=process.env.TCB_ENV||cloud.getWXContext().ENV||process.env.SCF_NAMESPACE
const metadata=tcb.init({env:tcb.SYMBOL_CURRENT_ENV})
const service=createPublicReadService({environment,storage:{async download(path){const result=await metadata.getUploadMetadata({cloudPath:path});const fileID=result?.data?.fileId;if(typeof fileID!=='string'||!fileID.startsWith('cloud://')||!fileID.endsWith('/'+path))throw new Error('Invalid storage metadata');return(await cloud.downloadFile({fileID})).fileContent}}})
const origins=['http://127.0.0.1:5173','http://localhost:5173',...(process.env.PUBLIC_ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean)]
const http=createHttpHandler(service,origins,PUBLIC_ACTIONS)
exports.main=event=>event&&typeof event.httpMethod==='string'?http(event):service(event)
