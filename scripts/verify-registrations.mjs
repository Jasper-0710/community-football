import {createRequire} from 'node:module'
import {randomBytes} from 'node:crypto'
import {createServer} from 'node:https'
import {execFileSync,spawn} from 'node:child_process'
import {mkdtemp,readFile,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
import {createServer as createViteServer} from 'vite'
import {chromium} from 'playwright'
const require=createRequire(import.meta.url)
const {createAdminService,createAccount}=require('../cloudfunctions/adminAuth/service.js')
const {createHttpHandler}=require('../cloudfunctions/adminAuth/http.js')
const {createUserProfileHandler}=require('../cloudfunctions/userProfile/service.js')
const {createTeamService,APP_ID,userId}=require('../cloudfunctions/teamManagement/service.js')
const {createRegistrationService}=require('../cloudfunctions/teamManagement/registrations.js')
const {createRegistrationFileService}=require('../cloudfunctions/teamManagement/registration-files.js')
const {createRegistrationCleanupService}=require('../cloudfunctions/adminAuth/registration-cleanup.js')
const {createAdminRegistrationService}=require('../cloudfunctions/adminAuth/registrations.js')
const {createCompetitionService,PUBLIC_ACTIONS}=require('../cloudfunctions/adminAuth/competitions.js')
const {createMemoryStore}=require('../tests/helpers/admin-store.cjs')
const {createRegistrationMemory}=require('../tests/helpers/registration-store.cjs')
const out='artifacts/registrations/browser';await mkdir(out,{recursive:true})
// The generated Vite transport lives under the ignored tooling directory. A
// fresh checkout does not contain that directory, so create it before writing
// the temporary config instead of relying on a prior local run.
await mkdir('.tools',{recursive:true})
const certDir=await mkdtemp(join(tmpdir(),'football-d05-'))
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(certDir,'key.pem'),'-out',join(certDir,'cert.pem'),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'})
const password=randomBytes(24).toString('base64url'),authMemory=createMemoryStore(await createAccount('admin',password,Date.now()))
const auth=createAdminService({store:authMemory.store,logger:{error(){}}}),memory=createRegistrationMemory(),identity={APPID:APP_ID,OPENID:'isolated-d05-browser-owner'}
const profile=createUserProfileHandler({cloud:{getWXContext:()=>identity,database:memory.database},logger:{error(){}}})
await profile({action:'getOrCreate'});await profile({action:'update',profile:{nickname:'测试领队'}})
const teams=createTeamService({store:memory.store,context:()=>identity,logger:{error(){}}})
const team=await teams({action:'create',requestId:'a'.repeat(32),form:{name:'上海社区联调足球队',district:'黄浦区',description:'测试球队',contactPhone:'021-55556666'}});assert.equal(team.ok,true)
const clock={value:Date.now()},now=()=>clock.value,storageFiles=new Map()
const storage={path:id=>id,async prepare(path){return path},async upload(path,b){storageFiles.set(path,Buffer.from(b));return path},async download(path){return Buffer.from(storageFiles.get(path))},async remove(ids){ids.forEach(id=>storageFiles.delete(id));return ids},async link(){return 'https://example.test/material.pdf'}}
const registrations=createRegistrationService({store:memory.registrationStore,context:()=>identity,storage,uploadsEnabled:true,now,logger:{error(){}}})
const files=createRegistrationFileService({store:memory.store,context:()=>identity,storage,enabled:true,now,logger:{error(){}}})
const adminRegistrations=createAdminRegistrationService({store:memory.registrationStore,authorize:token=>auth({action:'session',token}),storage,uploadsEnabled:true,now,logger:{error(){}}})
const competitions=createCompetitionService({store:memory.competitionStore,authorize:token=>auth({action:'session',token}),now,logger:{error(){}}})
const cid='c_'+'c'.repeat(32),time=new Date(now()).toISOString()
memory.seed('competitions',cid,{name:'上海赛区社区足球邀请赛',description:'以球会友，共赴绿茵。',format:'group_knockout',formatDescription:'小组循环赛后进入淘汰赛',startDate:'2026-11-20',endDate:'2026-11-25',venue:'上海社区足球场',registrationRequirements:'提交完整球员名单和参赛承诺书，核对球员参赛资格。',registrationStartAt:new Date(now()-86400000).toISOString(),registrationEndAt:new Date(now()+86400000).toISOString(),displayEnabled:true,registrationEnabled:true,registrationConfig:{projects:['男子组'],teamLimit:16,minPlayers:5,maxPlayers:18},version:1,registrationRulesVersion:1,createdAt:now(),updatedAt:now()})
const adminBase='http://127.0.0.1:5196',userBase='http://127.0.0.1:5198'
const cleanup=createRegistrationCleanupService({store:memory.registrationStore,storage,authorize:token=>auth({action:'session',token}),now,logger:{error(){}}})
const http=createHttpHandler(event=>{
 if(event.action==='registrations.review'){
  reviewCalls++
  if(failReview){failReview=false;return {ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'模拟审核服务暂不可用，请重新读取报名核对结果。'}}}
 }
 return event.action==='registrations.cleanup'?cleanup(event):event.action?.startsWith('registrations.')?adminRegistrations(event):event.action?.startsWith('competitions.')?competitions(event):auth(event)
},[adminBase,userBase],PUBLIC_ACTIONS)
let failChunk=true,failSubmit=true,submitCalls=0,reviewCalls=0,failReview=false
const server=createServer({key:await readFile(join(certDir,'key.pem')),cert:await readFile(join(certDir,'cert.pem'))},async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk
 if(req.url.startsWith('/wx/')){
  if(req.headers.origin!==userBase){res.writeHead(403);res.end();return}
  res.setHeader('Access-Control-Allow-Origin',userBase);res.setHeader('Access-Control-Allow-Headers','Content-Type')
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return}res.setHeader('Content-Type','application/json')
  const event=JSON.parse(body)
  if(failChunk&&event.action==='files.chunk'){failChunk=false;res.end(JSON.stringify({ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'模拟传输中断，请重试上传。'}}));return}
  if(event.action==='registrations.submit'){submitCalls++;if(failSubmit){failSubmit=false;res.end(JSON.stringify({ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'模拟报名服务暂不可用，请重新读取报名核对结果。'}}));return}}
  const fn=req.url==='/wx/userProfile'?profile:event.action?.startsWith('registrations.')?registrations:event.action?.startsWith('files.')?files:teams
  res.end(JSON.stringify(await fn(event)))
 }else{const r=await http({httpMethod:req.method,headers:req.headers,body});res.writeHead(r.statusCode,r.headers);res.end(r.body)}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const endpoint=`https://127.0.0.1:${server.address().port}`
process.env.VITE_ADMIN_API_URL=endpoint+'/api';process.env.VITE_COMPETITION_API_URL=endpoint+'/api'
const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF'),testConfig=resolve('.tools/d05-browser.vite.config.ts')
const transport=`export class WechatCloudError extends Error {}\nexport function initializeWechatCloud() {}\nexport async function callWechatCloudFunction(name,data){const r=await fetch(${JSON.stringify(endpoint+'/wx/')}+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return r.json()}`
const chooser=`export async function chooseRegistrationFiles(count:number):Promise<UploadDraft[]>{return [{requestId:teamRequestId(),path:'isolated-material.pdf',name:'球队参赛名单.pdf',size:${pdf.length},progress:0,error:''}]}\n`
await writeFile(testConfig,`import {defineConfig} from 'vite';import uni from '@dcloudio/vite-plugin-uni';export default defineConfig({cacheDir:'.tools/d05-vite-cache',plugins:[{name:'isolated-d05-transport',enforce:'pre',transform(code,id){if(id.endsWith('/src/services/wechat-cloud.ts'))return ${JSON.stringify(transport)};if(id.endsWith('/src/services/user-profile.ts'))return code.replace(/export function supportsWechatProfile\\(\\): boolean \\{[\\s\\S]*?\\n\\}/,'export function supportsWechatProfile(): boolean { return true }');if(id.endsWith('/src/services/registrations.ts'))return code.replace(/export async function chooseRegistrationFiles[\\s\\S]*?(?=export async function uploadRegistrationFile)/,${JSON.stringify(chooser)}).replace("let data=''",${JSON.stringify('let data='+JSON.stringify(pdf.toString('base64')))});}},uni()],server:{host:'127.0.0.1',port:5198,strictPort:true,hmr:false}})`)
const vite=await createViteServer({configFile:'admin/vite.config.ts',mode:'test',cacheDir:resolve('.tools/d05-admin-vite-cache'),server:{host:'127.0.0.1',port:5196,strictPort:true,watch:{usePolling:true},hmr:false}});await vite.listen()
const userServer=spawn('node',['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js','--config',testConfig,'--host','127.0.0.1','--port','5198'],{detached:true,env:{...process.env,CHOKIDAR_USEPOLLING:'true'},stdio:['ignore','pipe','pipe']})
let previewLog='';userServer.stdout.on('data',d=>{previewLog+=d});userServer.stderr.on('data',d=>{previewLog+=d})
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai',ignoreHTTPSErrors:true});context.setDefaultTimeout(12000)
const admin=await context.newPage(),user=await context.newPage(),errors=[],checks=[]
for(const page of [admin,user])page.on('pageerror',e=>errors.push(e.message))
admin.on('dialog',d=>void d.accept())
const check=name=>{checks.push(name);console.log('PASS '+name)}
const click=text=>user.getByText(text,{exact:true}).click()
const fill=(id,value)=>user.locator(`#${id} input,input#${id}`).fill(value)
const noOverflow=async page=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
const snapshot=async(page,name)=>{await page.bringToFront();await page.screenshot({path:`${out}/${name}.png`,fullPage:true,animations:'disabled',timeout:10000})}
const saved=()=>[...memory.records].filter(([k])=>k.startsWith('registrations/')).map(([,r])=>r)[0]
try{
 const deadline=Date.now()+30000;while(true){if(userServer.exitCode!==null)throw Error(previewLog.slice(-3000));try{if((await fetch(userBase,{signal:AbortSignal.timeout(1000)})).ok)break}catch{}if(Date.now()>deadline)throw Error(previewLog.slice(-3000));await new Promise(r=>setTimeout(r,250))}
 await user.goto(userBase+'/#/pages/competition/detail?id='+cid,{waitUntil:'networkidle'});await click('为我的球队报名');await click('微信登录');await user.locator('.registration-form').waitFor()
 await user.setViewportSize({width:320,height:844})
 assert.equal(await user.getByRole('button',{name:'选择报名项目',exact:true}).innerText(),'男子组')
 const feedback=user.locator('.registration-submit-feedback')
 const visibleFeedback=async text=>{await feedback.filter({hasText:text}).waitFor();await user.waitForFunction(()=>{const box=document.querySelector('.registration-submit-feedback')?.getBoundingClientRect();return box&&box.top>=0&&box.bottom<=innerHeight});const box=await feedback.boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=844,'submission feedback must be visible next to the button at 320px')}
 await click('提交报名，等待审核');await visibleFeedback('请填写领队姓名。');assert.equal(saved(),undefined);assert.equal(submitCalls,0)
 await fill('registration-leader','张领队');await fill('registration-phone','abc');await click('提交报名，等待审核');await visibleFeedback('请填写有效的联系方式');assert.equal(submitCalls,0)
 await fill('registration-phone','021-55556666');await click('提交报名，等待审核');await visibleFeedback('请上传至少一份报名材料');assert.equal(submitCalls,0)
 await click('＋ 选择报名材料（0/5）');await user.getByText('模拟传输中断，请重试上传。',{exact:true}).waitFor();await click('提交报名，等待审核');await visibleFeedback('有材料上传失败');assert.equal(submitCalls,0)
 await click('重试上传');await user.getByText(/上传完成/).waitFor();assert.equal(storageFiles.size,2)
 check('single project defaults correctly; missing leader, invalid phone, missing material and failed upload show visible feedback at 320px without submitting')
 for(const width of [390,320]){await user.setViewportSize({width,height:844});await noOverflow(user);await snapshot(user,`form-${width}`);const small=await user.locator('.registration-page').evaluate(el=>[...el.querySelectorAll('*')].filter(e=>e.textContent.trim()&&e.children.length===0&&getComputedStyle(e).display!=='none'&&parseFloat(getComputedStyle(e).fontSize)<14).map(e=>e.textContent));assert.deepEqual(small,[])}
 check('320px and 390px form sections, files and buttons have no horizontal overflow and text is at least 14px')
 await click('提交报名，等待审核');await user.locator('.uni-modal__btn').filter({hasText:'取消'}).click();assert.equal(saved(),undefined);assert.equal(submitCalls,0)
 await click('提交报名，等待审核');await user.locator('.uni-modal__btn').filter({hasText:'确认提交'}).click();await visibleFeedback('模拟报名服务暂不可用');assert.equal(saved(),undefined);assert.equal(submitCalls,1)
 assert.equal(await user.locator('.registration-submit .primary-button').getAttribute('disabled'),'true');await click('提交报名，等待审核');assert.equal(submitCalls,1);await snapshot(user,'submit-failure-320')
 await click('重新读取报名');await user.locator('.registration-form').waitFor();await fill('registration-leader','张领队');await click('＋ 选择报名材料（0/5）');await user.getByText(/上传完成/).waitFor()
 await click('提交报名，等待审核');await user.locator('.uni-modal__btn').filter({hasText:'确认提交'}).click();await user.locator('.registration-summary').waitFor();assert.equal(saved().status,'pending');assert.equal(submitCalls,2);await snapshot(user,'pending-320')
 check('cancel confirmation writes nothing; submission failure stays visible and blocks duplicate submissions until explicit reload; retry reaches pending review')
 await admin.goto(adminBase,{waitUntil:'networkidle'});await admin.getByLabel('管理员账号',{exact:true}).fill('admin');await admin.getByLabel('登录密码',{exact:true}).fill(password);await admin.getByRole('button',{name:'登录管理后台'}).click();await admin.locator('.workspace').waitFor()
 await admin.getByRole('button',{name:'赛事管理',exact:true}).click();await admin.getByRole('button',{name:'编辑赛事'}).click();await admin.getByLabel('报名项目 *（每行一个）').fill('男子组\n女子组\n青年组');await admin.getByLabel('球队上限',{exact:true}).fill('20');await admin.getByLabel('每队人数下限 *',{exact:true}).fill('2');await admin.getByLabel('每队人数上限 *',{exact:true}).fill('18');await admin.getByRole('button',{name:'保存赛事'}).click();await admin.locator('.competition-form').waitFor({state:'detached'});assert.deepEqual(memory.read('competitions',cid).registrationConfig,{projects:['男子组','女子组','青年组'],teamLimit:20,minPlayers:2,maxPlayers:18})
 await admin.getByRole('button',{name:'报名审核',exact:true}).click();await admin.locator('.registration-inbox-item').click()
 await admin.setViewportSize({width:320,height:844})
 const visibleReviewFeedback=async(decision,text)=>{
  const feedback=admin.locator(`#review-feedback-${decision}`)
  await feedback.filter({hasText:text}).waitFor()
  await admin.waitForFunction(id=>{const box=document.getElementById(id)?.getBoundingClientRect();return box&&box.top>=0&&box.bottom<=innerHeight},`review-feedback-${decision}`)
  assert.equal(await feedback.getAttribute('role'),'alert')
 }
 await admin.getByRole('button',{name:'审核通过',exact:true}).click();await visibleReviewFeedback('approved','请填写核对后的参赛人数');assert.equal(reviewCalls,0);assert.equal(saved().status,'pending')
 assert.match(await admin.locator('#verified-count-help').innerText(),/2–18/);assert.match(await admin.locator('.review-requirements').innerText(),/5–18/)
 for(const invalid of ['0','19','2.5']){
  await admin.getByLabel('核对后的参赛人数 *').fill(invalid)
  await admin.getByRole('button',{name:'审核通过',exact:true}).click();await visibleReviewFeedback('approved','2–18人的整数');assert.equal(reviewCalls,0)
 }
 await admin.getByLabel('核对后的参赛人数 *').fill('8');await admin.getByRole('button',{name:'审核通过',exact:true}).click();await visibleReviewFeedback('approved','请先核对报名材料，再勾选');assert.equal(reviewCalls,0);await noOverflow(admin);await snapshot(admin,'review-missing-confirmation-320')
 await admin.getByRole('button',{name:'驳回报名',exact:true}).click();await visibleReviewFeedback('rejected','请填写具体驳回原因');assert.equal(reviewCalls,0)
 check('approval uses the current event player range and requires material confirmation; each missing or invalid field shows nearby visible feedback at 320px without writing a review')
 await admin.getByLabel('核对后的参赛人数 *').fill('2');await admin.getByLabel('已核对报名材料与参赛要求').check()
 await admin.getByRole('button',{name:'审核通过',exact:true}).click();await admin.getByRole('status').filter({hasText:'审核通过'}).waitFor()
 assert.equal(saved().status,'approved');assert.equal(saved().competitionSnapshot.minPlayers,5);assert.equal(saved().review.playerCount,2);assert.equal(saved().review.rules.minPlayers,2)
 await snapshot(admin,'current-rules-approved-320')
 await click('重新读取');await user.locator('.registration-summary .application-status.approved').waitFor()
 check('registration submitted under 5–18 is approved for 2 players after the event changes to 2–18; original submission and approval ranges are both retained and the leader can read the result')
 await click('修改报名资料');await click('保存修改并重新审核');await user.locator('.uni-modal__btn').filter({hasText:'确认提交'}).click();await user.locator('.registration-summary').waitFor();assert.equal(saved().status,'pending')
 await admin.getByRole('button',{name:'刷新报名',exact:true}).click();await admin.locator('.registration-inbox-item').click()
 // Change the live rules after the admin already opened this detail.
 const current=memory.read('competitions',cid)
 memory.seed('competitions',cid,{...current,registrationConfig:{...current.registrationConfig,minPlayers:4},registrationRulesVersion:current.registrationRulesVersion+1})
 const beforeTightened=reviewCalls
 await admin.getByLabel('核对后的参赛人数 *').fill('2');await admin.getByLabel('已核对报名材料与参赛要求').check()
 await admin.getByRole('button',{name:'审核通过',exact:true}).click();await visibleReviewFeedback('approved','4–18人的整数')
 assert.match(await admin.locator('#verified-count-help').innerText(),/4–18/);assert.equal(reviewCalls,beforeTightened);assert.equal(saved().status,'pending')
 await snapshot(admin,'current-rules-tightened-320')
 check('a detail left open during another settings change reloads current rules before validation; 2 players is rejected after tightening to 4–18, with no review write')
 await admin.getByLabel('驳回原因（驳回时必填）').fill('请补充球员参赛承诺书。');await admin.getByRole('button',{name:'驳回报名'}).click();await admin.getByRole('status').filter({hasText:'已驳回'}).waitFor();assert.equal(saved().status,'rejected');assert.equal(memory.read('competitions',cid).registrationStats.occupied,0)
 await click('重新读取');await user.getByText('请补充球员参赛承诺书。',{exact:true}).first().waitFor();await snapshot(user,'rejected-320');check('admin can edit event configuration, reject with reason and release a place; leader sees rejection')
 await click('重新报名');await user.locator('.registration-form').waitFor();await click('保存修改并重新审核');await user.locator('.uni-modal__btn').filter({hasText:'确认提交'}).click();await user.locator('.registration-summary').waitFor();assert.equal(saved().status,'pending')
 await admin.getByRole('button',{name:'刷新报名',exact:true}).click();await admin.locator('.registration-inbox-item').click();await admin.getByLabel('核对后的参赛人数 *').fill('8');await admin.getByLabel('已核对报名材料与参赛要求').check();await admin.setViewportSize({width:1440,height:1000});await noOverflow(admin);await snapshot(admin,'review-desktop')
 for(const width of [390,320]){await admin.setViewportSize({width,height:844});await noOverflow(admin);await snapshot(admin,`review-${width}`)}
 failReview=true
 const beforeReviewFailure=reviewCalls
 await admin.getByRole('button',{name:'审核通过',exact:true}).click();await visibleReviewFeedback('approved','模拟审核服务暂不可用');assert.equal(saved().status,'pending');assert.equal(reviewCalls,beforeReviewFailure+1)
 assert.equal(await admin.getByRole('button',{name:'审核通过',exact:true}).isDisabled(),true)
 await admin.getByRole('button',{name:'审核通过',exact:true}).evaluate(el=>el.click());assert.equal(reviewCalls,beforeReviewFailure+1)
 await admin.waitForFunction(()=>{const box=[...document.querySelectorAll('.review-reload button')].find(el=>el.textContent==='重新读取当前报名')?.getBoundingClientRect();return box&&box.top>=0&&box.bottom<=innerHeight})
 await snapshot(admin,'review-service-failure-320')
 await admin.getByRole('button',{name:'重新读取当前报名',exact:true}).click();await admin.getByLabel('核对后的参赛人数 *').fill('8');await admin.getByLabel('已核对报名材料与参赛要求').check()
 await admin.getByRole('button',{name:'审核通过',exact:true}).click();await admin.getByRole('status').filter({hasText:'审核通过'}).waitFor();assert.equal(saved().status,'approved');assert.equal(reviewCalls,beforeReviewFailure+2)
 await admin.waitForFunction(()=>{const box=document.querySelector('.review-result')?.getBoundingClientRect();return box&&box.top>=0&&box.bottom<=innerHeight})
 await snapshot(admin,'review-approved-320')
 check('uncertain review failures show a visible reload action and disable repeat decisions until reloaded; a confirmed retry approves exactly once and displays the result')
 await admin.getByLabel('报名状态',{exact:true}).selectOption('approved');await admin.locator('.registration-inbox-item').waitFor();assert.equal(await admin.locator('.registration-inbox-item').count(),1)
 check('resubmission returns to review; verified player count and approval feed the final participant list')
 await click('重新读取');await user.locator('.registration-summary .application-status.approved').waitFor();await click('修改报名资料');await fill('registration-leader','更新后的领队');await click('保存修改并重新审核');await user.locator('.uni-modal__btn').filter({hasText:'确认提交'}).click();await user.locator('.registration-summary').waitFor();assert.equal(saved().status,'pending');assert.equal(memory.read('competitions',cid).registrationStats.approved,0)
 await user.locator('.registration-summary').getByText('撤销报名',{exact:true}).click();await user.locator('.uni-modal__btn').filter({hasText:'取消'}).click();assert.equal(saved().status,'pending');await user.locator('.registration-summary').getByText('撤销报名',{exact:true}).click();await user.locator('.uni-modal__btn').filter({hasText:'撤销报名'}).click();await user.locator('.registration-summary .application-status.cancelled').waitFor();assert.equal(memory.read('competitions',cid).registrationStats.occupied,0)
 check('editing approved information clears approval; cancellation requires confirmation and releases capacity')
 await user.goto(userBase+'/#/pages/registration/mine',{waitUntil:'networkidle'});await user.locator('.registration-list-card').waitFor();await click('查看报名与材料 →');await user.locator('.registration-summary').waitFor()
 clock.value=Date.parse(memory.read('competitions',cid).registrationEndAt);await click('重新读取');await user.getByText('报名已截止，资料修改与撤销已锁定。',{exact:true}).waitFor();assert.equal(await user.getByText('重新报名',{exact:true}).count(),0)
 check('my registrations restores private records and deadline locks self-service actions')
 memory.failures.read=true;await click('重新读取');await user.getByText('暂时无法读取报名信息',{exact:true}).waitFor();assert.equal(await user.locator('.registration-summary').count(),0);memory.failures.read=false;await click('重新加载');await user.locator('.registration-summary').waitFor()
 check('read failures hide stale records and recover through explicit retry')
 // Use an isolated expired upload, keeping the submitted attachment as a control.
 const orphanId='f_'+'0'.repeat(32),orphanPath='registration-materials/'+'0'.repeat(48)+'.pdf'
 memory.seed('registrationFiles',orphanId,{ownerUserId:userId(APP_ID,'browser-leader'),competitionId:cid,status:'ready',name:'过期测试.pdf',size:pdf.length,extension:'pdf',chunks:[],fileID:orphanPath,expiresAt:now()-1,createdAt:now()-86400000})
 storageFiles.set(orphanPath,pdf)
 const retained=saved().attachments[0].fileID,beforeMaintenance=storageFiles.size
 await admin.locator('.material-maintenance summary').click()
 await admin.getByRole('button',{name:'检查本批临时材料',exact:true}).click()
 await admin.getByText('以上是检查结果，尚未删除文件。清理后不会影响球队报名和审核记录。',{exact:true}).waitFor()
 assert.equal(storageFiles.size,beforeMaintenance)
 for(const width of [1440,390,320]){await admin.setViewportSize({width,height:width===1440?1000:844});await noOverflow(admin);await snapshot(admin,`maintenance-${width}`)}
 await admin.getByRole('button',{name:'清理本批临时材料',exact:true}).click()
 await admin.locator('.material-maintenance [role="status"]').waitFor()
 assert.equal(storageFiles.has(orphanPath),false);assert.equal(storageFiles.has(retained),true)
 check('authenticated maintenance previews without deletion, removes expired temporary files, and retains submitted material at desktop/390/320 widths')
 assert.deepEqual(errors,[])
 await writeFile(`${out}/report.json`,JSON.stringify({checks,errors,validation:'Real Vue pages and actual registration, attachment, competition and admin handlers over an isolated transactional store. File chooser and WeChat transport are test-only adapters; not native/cloud validation.',generatedAt:new Date().toISOString()},null,2))
 console.log(`Verified ${checks.length} registration browser flows.`)
}catch(error){await snapshot(user,'failure-user').catch(()=>{});await snapshot(admin,'failure-admin').catch(()=>{});await writeFile(`${out}/failure.txt`,await user.locator('body').innerText()+'\nADMIN\n'+await admin.locator('body').innerText());throw error}
finally{await browser.close();await vite.close();try{process.kill(-userServer.pid,'SIGTERM')}catch{}server.closeAllConnections();await new Promise(r=>server.close(r));await rm(testConfig,{force:true});await rm(certDir,{recursive:true,force:true})}
