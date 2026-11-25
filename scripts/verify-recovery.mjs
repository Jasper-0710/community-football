import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createRequire} from 'node:module'
import {createServer} from 'node:https'
import {randomBytes} from 'node:crypto'
import {execFileSync,spawn} from 'node:child_process'
import {resolve} from 'node:path'
import {createServer as createViteServer} from 'vite'
import {chromium} from 'playwright'
const require=createRequire(import.meta.url)
const {createAdminService,createAccount}=require('../cloudfunctions/adminAuth/service')
const {createHttpHandler}=require('../cloudfunctions/adminAuth/http')
const {createMemoryStore}=require('../tests/helpers/admin-store.cjs')
const {createRecoveryMemory}=require('../tests/helpers/recovery-store.cjs')
const {createRecoveryService}=require('../cloudfunctions/adminAuth/recovery')
const {createRecoveryGuard}=require('../cloudfunctions/adminAuth/recovery-guard')
const {createPublicCache}=require('../cloudfunctions/adminAuth/public-cache')
const {createPublicReadService,PUBLIC_ACTIONS:PUBLIC_CACHE}=require('../cloudfunctions/publicRead/service')
const {createCompetitionService,PUBLIC_ACTIONS:COMPETITION_PUBLIC}=require('../cloudfunctions/adminAuth/competitions')
const {createMatchService,PUBLIC_ACTIONS:MATCH_PUBLIC}=require('../cloudfunctions/adminAuth/matches')
const {createContentService,PUBLIC_ACTIONS:CONTENT_PUBLIC}=require('../cloudfunctions/adminAuth/content')
const {createSettingsService,PUBLIC_ACTIONS:SETTINGS_PUBLIC}=require('../cloudfunctions/adminAuth/platform-settings')
const {createStandingsService,PUBLIC_ACTIONS:STANDINGS_PUBLIC}=require('../cloudfunctions/adminAuth/standings')
const {createMatchMemoryStore}=require('../tests/helpers/match-store.cjs')
const M=require('../cloudfunctions/adminAuth/recovery-model')
const out='artifacts/recovery',adminOrigin='http://127.0.0.1:5202',publicOrigin='http://127.0.0.1:5201'
await fs.mkdir(out,{recursive:true});await fs.mkdir('.tools',{recursive:true})
const memory=createRecoveryMemory(),{store,collections}=memory,now=Date.now,put=(name,row)=>collections[name].set(row._id,row)
const password=randomBytes(24).toString('base64url'),auth=createAdminService({store:createMemoryStore(await createAccount('admin',password,now())).store,logger:{error(){}}}),authorize=token=>auth({action:'session',token})
const uid='a'.repeat(64),home='t_'+'a'.repeat(64),away='t_'+'b'.repeat(64),cid='c_'+'1'.repeat(32),mid='m_'+'1'.repeat(32)
put('users',{_id:uid,appId:'isolated-test',openId:'isolated-test',nickname:'测试领队',role:'leader',avatarFileId:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()})
for(const[id,name]of[[home,'原始社区联队'],[away,'邻里星火']]){const pid='p_'+(id===home?'1':'2').repeat(32);put('teams',{_id:id,leaderUserId:uid,name,district:'虹口区',description:'隔离验收球队',contactPhone:'021-11112222',status:'active',version:1,roster:[{id:pid,name:id===home?'前锋甲':'中场乙',number:id===home?9:8,position:'forward'}],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});put('players',{_id:pid,teamId:id,name:'球员',number:9,position:'forward'});put('registrations',{_id:'r_'+(id===home?'a':'b').repeat(64),competitionId:cid,teamId:id,ownerUserId:uid,status:'approved',attachments:[]})}
put('leaderTeamBindings',{_id:uid,teamId:home})
put('competitions',{_id:cid,name:'备份恢复验收杯',description:'独立隔离浏览器验收',format:'knockout',formatDescription:'淘汰赛',startDate:'2026-11-20',endDate:'2026-12-31',venue:'社区球场',registrationRequirements:'上传材料',registrationStartAt:null,registrationEndAt:null,registrationEnabled:false,displayEnabled:true,version:1,createdAt:now(),updatedAt:now()})
put('matches',{_id:mid,competitionId:cid,stage:'final',round:1,groupId:null,slot:1,homeTeamId:home,awayTeamId:away,homeFrom:null,awayFrom:null,status:'scheduled',result:null,scheduledAt:'2026-12-01T08:00:00.000Z',venue:'社区球场',version:1,createdAt:now(),updatedAt:now()})
const readStore={async scan(name){return[...collections[name].values()]},async read(name,id){return collections[name].get(id)},atomic:store.atomic}
const recovery=createRecoveryService({...memory,authorize,enabled:true,probe:async()=>true,logger:{error(){}}}),guard=createRecoveryGuard({control:memory.control,logger:{error(){}}})
const competitionStore={async read(id){return collections.competitions.get(id)},async list({publicOnly,cursor,limit}){return[...collections.competitions.values()].filter(c=>(!publicOnly||c.displayEnabled)&&(!cursor||c._id>cursor)).sort((a,b)=>a._id.localeCompare(b._id)).slice(0,limit)}}
const competitions=createCompetitionService({store:competitionStore,authorize}),matchMemory=createMatchMemoryStore({competitions:collections.competitions,teams:collections.teams,registrations:collections.registrations,records:collections.matches,revisions:collections.resultRevisions}),matches=createMatchService({store:matchMemory.store,authorize}),content=createContentService({store:readStore,authorize}),settings=createSettingsService({store:readStore,authorize}),standings=createStandingsService({store:matchMemory.standingsStore,authorize})
const publicActions=[...new Set([...COMPETITION_PUBLIC,...MATCH_PUBLIC,...CONTENT_PUBLIC,...SETTINGS_PUBLIC,...STANDINGS_PUBLIC])]
let failPrimary=false,failFallback=false,loseAck=false,loseEarlyAck=false,holdRestore=false,legacyReceipt=false,token,releaseRestore,restoreEntered
let restoreGate
const uploadStored=memory.storage.upload
memory.storage.upload=async(path,bytes)=>{if(holdRestore&&path.endsWith('/snapshot.json')){holdRestore=false;restoreEntered();await restoreGate}return uploadStored(path,bytes)}
const requests=[],cache=createPublicCache({storage:memory.storage,environment:memory.environment,enabled:true,logger:{error(){}}})
const fallback=createPublicReadService({environment:memory.environment,storage:{download:path=>memory.storage.download(`cloud://${memory.environment}/${path}`)},logger:{error(){}}})
const business=event=>event.action.startsWith('competitions.')?competitions(event):event.action.startsWith('matches.')?matches(event):event.action.startsWith('standings.')?standings(event):event.action.startsWith('settings.')?settings(event):/^(news|search|directory|content)\./.test(event.action)?content(event):auth(event)
const router=async event=>{requests.push({action:event.action});if(legacyReceipt&&event.action==='backup.result')return{ok:true,status:'preview',rollbackId:null,completedAt:null};if(failPrimary&&publicActions.includes(event.action))return{ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'隔离主服务故障'}};return event.action.startsWith('backup.')?recovery(event):cache(event,e=>['login','overview','session','logout'].includes(e.action)?business(e):guard(e,business,publicActions.includes(e.action)))}
const certDir=await fs.mkdtemp('/tmp/community-football-recovery-')
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',`${certDir}/key.pem`,'-out',`${certDir}/cert.pem`,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'})
const origins=[adminOrigin,publicOrigin],http=createHttpHandler(router,origins,publicActions),fallbackHttp=createHttpHandler(async event=>failFallback?{ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'隔离备用故障'}}:fallback(event),origins,PUBLIC_CACHE)
const server=createServer({key:await fs.readFile(`${certDir}/key.pem`),cert:await fs.readFile(`${certDir}/cert.pem`)},async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk
 const handling=(req.url==='/fallback'?fallbackHttp:http)({httpMethod:req.method,headers:req.headers,body})
 if(loseEarlyAck&&body.includes('"action":"backup.apply"')){loseEarlyAck=false;res.writeHead(200,{'content-type':'application/json','access-control-allow-origin':adminOrigin});res.end('{"ok":');await handling;return}
 const response=await handling
 if(body&&failPrimary)console.log('RECOVERY_REQUEST',req.url,JSON.parse(body).action,response.statusCode)
 res.writeHead(response.statusCode,response.headers)
 if(loseAck&&body.includes('"action":"backup.apply"')&&response.statusCode===200){loseAck=false;res.end('{"ok":');return}
 res.end(response.body)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const endpoint=`https://127.0.0.1:${server.address().port}/api`,fallbackEndpoint=endpoint.replace('/api','/fallback')
process.env.VITE_ADMIN_API_URL=endpoint
const publicConfig=resolve('.tools/recovery-public.vite.config.ts')
await fs.writeFile(publicConfig,`import base from '../vite.config';export default env=>{const c=base(env);return{...c,define:{...c.define,'import.meta.env.VITE_PUBLIC_FALLBACK_API_URL':${JSON.stringify(JSON.stringify(fallbackEndpoint))}},cacheDir:'.tools/recovery-public-cache',server:{host:'127.0.0.1',port:5201,strictPort:true,hmr:false}}}\n`)
const adminVite=await createViteServer({configFile:'admin/vite.config.ts',mode:'test',cacheDir:resolve('.tools/recovery-admin-cache'),server:{host:'127.0.0.1',port:5202,strictPort:true,hmr:false}});await adminVite.listen()
const publicServer=spawn('node',['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js','--config',publicConfig,'--host','127.0.0.1','--port','5201'],{detached:true,env:{...process.env,VITE_COMPETITION_API_URL:endpoint,CHOKIDAR_USEPOLLING:'true'},stdio:['ignore','pipe','pipe']});let publicLog='';for(const stream of[publicServer.stdout,publicServer.stderr])stream.on('data',bytes=>publicLog+=bytes)
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai',ignoreHTTPSErrors:true,acceptDownloads:true});context.setDefaultTimeout(15000)
const admin=await context.newPage(),user=await context.newPage(),checks=[],errors=[];for(const page of[admin,user])page.on('pageerror',error=>errors.push(error.message))
const check=name=>{checks.push(name);console.log('PASS '+name)},notice=()=>admin.locator('.backup-admin .notice.success'),upload=async(path)=>{await admin.locator('#backup-json').setInputFiles(path);await admin.locator('.backup-preview').waitFor()},apply=async()=>{const phrase=await admin.locator('.backup-preview label').innerText();await admin.locator('#backup-confirmation').fill(phrase.match(/“(.+)”/)[1]);await admin.getByRole('button',{name:'确认执行恢复',exact:true}).click()}
async function refreshSchedule(){await user.getByRole('button',{name:'刷新赛程',exact:true}).click();await user.waitForFunction(()=>{const button=[...document.querySelectorAll('[role="button"]')].find(b=>b.textContent==='刷新赛程');return button&&!button.hasAttribute('disabled')})}
const watchdog=setTimeout(()=>{console.error('D13 browser watchdog: '+JSON.stringify({checks,requests:requests.slice(-12),errors}));process.exit(1)},180000)
try{
 const deadline=Date.now()+30000;for(;;){if(publicServer.exitCode!==null)throw new Error(publicLog);try{if((await fetch(publicOrigin)).ok)break}catch{}if(Date.now()>deadline)throw new Error(publicLog);await new Promise(resolve=>setTimeout(resolve,250))}
 await admin.goto(adminOrigin);await admin.getByLabel('管理员账号',{exact:true}).fill('admin');await admin.getByLabel('登录密码',{exact:true}).fill(password);await admin.getByRole('button',{name:'登录管理后台',exact:true}).click();await admin.locator('.workspace').waitFor();token=await admin.evaluate(()=>sessionStorage.getItem('community-football.admin.session.v1'));await admin.getByRole('button',{name:'备份与恢复',exact:true}).click();await admin.getByRole('button',{name:'生成并下载JSON备份',exact:true}).waitFor();await admin.waitForFunction(()=>!document.querySelector('.backup-admin .primary-button').disabled)
 assert.equal((await context.request.post(endpoint,{data:{action:'backup.list'}})).status(),401);check('侧栏入口、部署能力与管理员权限正确')
 const downloaded=admin.waitForEvent('download');await admin.getByRole('button',{name:'生成并下载JSON备份',exact:true}).click();const download=await downloaded,path=resolve(out,'backup.json');await download.saveAs(path);await notice().getByText(/备份已生成/).waitFor();const saved=JSON.parse(await fs.readFile(path,'utf8'));assert.equal(saved.format,'community-football-backup');assert.equal(Object.keys(saved.collections).length,20);assert.equal(saved.collections.adminAccounts,undefined);assert.equal(JSON.stringify(saved).includes(password),false);check('真实表单导出20类业务JSON（含投保图片），分片下载及校验成功')
 collections.teams.get(home).name='修改后的球队';collections.teams.get(home).version=7
 put('newsArticles',{_id:'n_'+'2'.repeat(32),title:'恢复时删除的新增草稿',body:[],status:'draft',version:1})
 await upload(path);await admin.getByText('球队资料',{exact:true}).waitFor();assert.equal(await admin.getByRole('button',{name:'确认执行恢复',exact:true}).isEnabled(),false);assert.equal(await admin.locator('.backup-preview tbody tr').count(),2);check('上传JSON后预览替换和删除，确认文字未填写时不能执行')
 await apply();await notice().getByText(/恢复完成/).waitFor();assert.equal(collections.teams.get(home).name,'原始社区联队');assert.equal(collections.teams.get(home).version,8);assert.equal(collections.newsArticles.size,0);assert.equal((await store.history()).filter(row=>row.kind==='before_restore').length,1);check('原子恢复、自动回退备份及版本递增通过')
 const invalidPath=resolve(out,'wrong-environment.json');await fs.writeFile(invalidPath,JSON.stringify({...saved,environment:'other'}));await admin.locator('#backup-json').setInputFiles(invalidPath);await admin.getByRole('alert').getByText(/云环境不匹配/).waitFor();assert.equal(await admin.locator('.backup-preview').count(),0);check('错误环境备份在本机校验阶段拒绝')
 collections.teams.get(home).name='新业务';collections.teams.get(home).version++
 await upload(path);collections.users.get(uid).nickname='预览后新提交';await apply();await admin.getByRole('alert').getByText(/数据已发生变化/).waitFor();assert.equal(collections.teams.get(home).name,'新业务');legacyReceipt=true;await admin.getByRole('button',{name:'检查恢复结果',exact:true}).click();await notice().getByText('云端恢复回执需要更新，请完成云函数部署后再检查。',{exact:true}).waitFor();assert.equal(await admin.locator('#backup-json').isDisabled(),true);check('旧云端仅返回预览时保留待确认任务，等待匹配版本部署');legacyReceipt=false;await admin.getByRole('button',{name:'检查恢复结果',exact:true}).click();await notice().getByText(/重新选择JSON/).waitFor();check('预览后有新提交时拒绝覆盖，保留业务状态')
 await upload(path);loseAck=true;await apply();await admin.getByText('本次执行结果尚未确认，请先检查恢复结果，再决定下一步。',{exact:true}).waitFor();assert.equal(await admin.getByRole('button',{name:'确认执行恢复',exact:true}).isEnabled(),false);await admin.getByRole('button',{name:'检查恢复结果',exact:true}).click();await notice().getByText(/恢复已完成/).waitFor();assert.equal(collections.teams.get(home).name,'原始社区联队');check('恢复成功但响应丢失时，先检查回执再解除执行锁定')
 collections.teams.get(home).name='执行中临时修改';collections.teams.get(home).version++
 await upload(path)
 const entered=new Promise(resolve=>restoreEntered=resolve);restoreGate=new Promise(resolve=>releaseRestore=resolve);holdRestore=true;loseEarlyAck=true
 try{
  await apply();await entered;await admin.getByText('本次执行结果尚未确认，请先检查恢复结果，再决定下一步。',{exact:true}).waitFor()
  await admin.getByRole('button',{name:'检查恢复结果',exact:true}).click();await notice().getByText('恢复仍在进行，请稍后再次检查恢复结果。',{exact:true}).waitFor()
  assert.equal(await admin.locator('#backup-json').isDisabled(),true);assert.equal(await admin.getByRole('button',{name:'确认执行恢复',exact:true}).isDisabled(),true)
  check('响应丢失时能区分执行中任务，保持恢复和文件选择锁定')
  await admin.reload();await admin.locator('.workspace').waitFor();await admin.getByRole('button',{name:'备份与恢复',exact:true}).click()
  await notice().getByText('上次恢复的结果尚未确认，请先检查恢复结果。',{exact:true}).waitFor();assert.equal(await admin.locator('#backup-json').isDisabled(),true)
  await admin.getByRole('button',{name:'检查恢复结果',exact:true}).click();await notice().getByText(/恢复仍在进行/).waitFor()
  check('刷新后台后仍保留当前会话的待确认任务，不允许重复恢复')
 }finally{releaseRestore()}
 // The status check below is bounded by the browser assertion timeout and reads
 // the original task until the server has atomically committed its receipt.
 const pendingPlan=await admin.evaluate(()=>JSON.parse(Object.keys(sessionStorage).filter(k=>k.startsWith('community-football.pending-restore.v1:')).map(k=>sessionStorage.getItem(k)).find(Boolean)).plan.id)
 await admin.waitForFunction(async({endpoint,token,planId})=>{const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({action:'backup.result',planId})});const value=await r.json();return value.status==='completed'},{endpoint,token,planId:pendingPlan})
 await admin.getByRole('button',{name:'检查恢复结果',exact:true}).click();await notice().getByText(/恢复已完成/).waitFor()
 assert.equal(collections.teams.get(home).name,'原始社区联队');assert.equal(await admin.locator('#backup-json').isEnabled(),true)
 assert.equal(await admin.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('community-football.pending-restore.v1:'))),false)
 check('执行中任务完成后回读同一回执并清除待确认状态')
 await user.goto(`${publicOrigin}/#/pages/index/index?tab=tournament`);await user.getByRole('button',{name:'真实赛程',exact:true}).click();await user.locator('.public-schedule-card').first().waitFor();await user.locator('.public-schedule-card').getByText('原始社区联队',{exact:true}).waitFor();await refreshSchedule();check('恢复后真实客户端赛程与后台使用同一份业务数据')
 failPrimary=true;await refreshSchedule();await user.locator('.recovery-notice-title').getByText('正在使用云端备用读取',{exact:true}).waitFor();await user.locator('.public-schedule-card').first().waitFor();check('主服务故障后独立只读云函数回退，明确显示备用来源')
 failFallback=true;await refreshSchedule();await user.locator('.recovery-notice-title').getByText('正在显示本机公开快照',{exact:true}).waitFor();await user.locator('.recovery-notice').getByText(/北京时间/).waitFor();await user.locator('.public-schedule-card').first().waitFor();check('主备均失败后展示带原始时间的本机公开快照')
 for(const width of[1440,390,320]){await admin.setViewportSize({width,height:1000});await user.setViewportSize({width,height:1000});assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await user.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await admin.locator('.backup-admin').screenshot({path:`${out}/admin-${width}.png`});await user.screenshot({path:`${out}/snapshot-${width}.png`,fullPage:true})}check('备份页面与快照提示1440/390/320px无横向溢出')
 failPrimary=false;failFallback=false;await user.getByRole('button',{name:'重新连接',exact:true}).click();await user.locator('.recovery-notice').waitFor({state:'hidden'});await user.locator('.public-schedule-card').first().waitFor();check('重新连接主动刷新当前页面，主服务恢复后撤下快照提示')
 failPrimary=true;failFallback=true;const cold=await browser.newContext({ignoreHTTPSErrors:true}),page=await cold.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(`${publicOrigin}/#/pages/index/index?tab=tournament`);await page.getByRole('button',{name:'真实赛程',exact:true}).click();await page.locator('.public-schedule [role="alert"]').waitFor();assert.equal(await page.locator('.public-schedule-card').count(),0);check('首次离线且没有快照时显示失败，不回退为演示赛程')
 await page.goto(`${publicOrigin}/#/pages/match/detail?id=${mid}`);await page.locator('.match-read-error').getByText('隔离主服务故障',{exact:true}).waitFor();assert.equal(await page.locator('.match-detail-page').count(),0);assert.equal(await page.getByText('没有找到这场比赛',{exact:true}).count(),0)
 await page.getByRole('button',{name:'重新读取比赛',exact:true}).click();await page.locator('.match-read-error').getByText('隔离主服务故障',{exact:true}).waitFor();failPrimary=false;failFallback=false;await page.getByRole('button',{name:'重新读取比赛',exact:true}).click();await page.locator('.match-detail-page').waitFor();await page.locator('.detail-team').getByText('原始社区联队',{exact:true}).waitFor();assert.equal(await page.locator('.match-read-error').count(),0);await cold.close();check('无缓存比赛详情显示连接失败而非比赛不存在，恢复服务后可原页重试')
 failPrimary=false;failFallback=false;await admin.getByRole('button',{name:'账号与访问',exact:true}).click();await admin.getByRole('button',{name:'退出登录',exact:true}).click();await admin.getByRole('button',{name:'登录管理后台',exact:true}).waitFor();const old=await context.request.post(endpoint,{headers:{authorization:`Bearer ${token}`},data:{action:'backup.list'}});assert.equal(old.status(),401);check('退出后备份接口拒绝原会话')
 assert.deepEqual(errors,[]);await fs.writeFile(`${out}/report.json`,JSON.stringify({date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),scope:'Actual Vue UI and HTTPS services with isolated database/storage/auth and two separate HTTP handlers; not customer-cloud or physical-device acceptance',checks,errors,requestCount:requests.length},null,2)+'\n');console.log(JSON.stringify({passed:checks.length,errors}))
}catch(error){await fs.writeFile(`${out}/failure.txt`,error.stack+'\n'+publicLog.slice(-3000));await fs.writeFile(`${out}/report.json`,JSON.stringify({checks,errors,failure:error.message},null,2));await admin.screenshot({path:`${out}/admin-failure.png`,fullPage:true}).catch(()=>{});await user.screenshot({path:`${out}/public-failure.png`,fullPage:true}).catch(()=>{});throw error}
finally{clearTimeout(watchdog);await browser.close();await adminVite.close();try{process.kill(-publicServer.pid,'SIGTERM')}catch{}server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
