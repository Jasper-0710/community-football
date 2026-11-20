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
const {createAdminService,createAccount}=require('../cloudfunctions/adminAuth/service.js')
const {createHttpHandler}=require('../cloudfunctions/adminAuth/http.js')
const {createLiveService,PUBLIC_ACTIONS}=require('../cloudfunctions/adminAuth/match-live.js')
const {createLiveImageService}=require('../cloudfunctions/adminAuth/match-live-images.js')
const {createSettingsService,PUBLIC_ACTIONS:SETTINGS_PUBLIC}=require('../cloudfunctions/adminAuth/platform-settings.js')
const {createCompetitionService,PUBLIC_ACTIONS:COMPETITION_PUBLIC}=require('../cloudfunctions/adminAuth/competitions.js')
const {createMatchService,PUBLIC_ACTIONS:MATCH_PUBLIC}=require('../cloudfunctions/adminAuth/matches.js')
const {createAdminTeamService}=require('../cloudfunctions/adminAuth/teams.js')
const {createContentService,PUBLIC_ACTIONS:CONTENT_PUBLIC}=require('../cloudfunctions/adminAuth/content.js')
const {createMemoryStore}=require('../tests/helpers/admin-store.cjs')
const {createContentMemoryStore}=require('../tests/helpers/content-store.cjs')
const {createMatchMemoryStore}=require('../tests/helpers/match-store.cjs')
const {createNewsImageStorage}=require('../tests/helpers/news-image-storage.cjs')
const {registrationId}=require('../cloudfunctions/adminAuth/registration-model.js')
const {PNG}=createRequire(resolve('cloudfunctions/adminAuth/package.json'))('pngjs')
const out='artifacts/match-live',adminOrigin='http://127.0.0.1:5198',publicOrigin='http://127.0.0.1:5197'
await fs.mkdir(out,{recursive:true});await fs.mkdir('.tools',{recursive:true})
let now=Date.parse('2026-11-18T08:00:00Z'),authNow=now
const password=randomBytes(24).toString('base64url'),auth=createAdminService({store:createMemoryStore(await createAccount('admin',password,now)).store,now:()=>authNow,logger:{error(){}}})
const authorize=token=>auth({action:'session',token}),memory=createContentMemoryStore(),{store,collections}=memory,imageMemory=createNewsImageStorage()
const cid='c_'+'1'.repeat(32),mid='m_'+'1'.repeat(32),other='m_'+'2'.repeat(32),home='t_'+'a'.repeat(64),away='t_'+'b'.repeat(64)
collections.competitions.set(cid,{_id:cid,name:'图文直播社区杯',description:'隔离浏览器验收',format:'round_robin',formatDescription:'单循环',startDate:'2026-11-20',endDate:'2026-12-31',venue:'社区球场',registrationRequirements:'提交材料',registrationStartAt:null,registrationEndAt:null,registrationEnabled:false,displayEnabled:true,version:1,createdAt:now,updatedAt:now})
for(const[id,name]of[[home,'社区联队'],[away,'邻里星火']]){collections.teams.set(id,{_id:id,name,district:'虹口区',description:'公开球队',contactPhone:'021-11112222',status:'active',version:1,leaderUserId:'test-user',roster:[],createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()});const rid=registrationId(cid,id);collections.registrations.set(rid,{_id:rid,competitionId:cid,teamId:id,status:'approved'})}
for(const[id,round]of[[mid,1],[other,2]])collections.matches.set(id,{_id:id,competitionId:cid,stage:'group',round,groupId:'A',slot:null,homeTeamId:home,awayTeamId:away,homeFrom:null,awayFrom:null,status:'scheduled',homeScore:null,awayScore:null,scheduledAt:`2026-11-${20+round}T08:00:00.000Z`,venue:'社区球场',version:1,createdAt:now,updatedAt:now})
const matchMemory=createMatchMemoryStore({competitions:collections.competitions,teams:collections.teams,registrations:collections.registrations,records:collections.matches}),options={store,storage:imageMemory.storage,authorize,now:()=>now,logger:{error(){}}}
const live=createLiveService(options),images=createLiveImageService({...options,enabled:true}),settings=createSettingsService(options),content=createContentService(options)
const competitions=createCompetitionService({store:{read:id=>store.read('competitions',id),async list({publicOnly,cursor,limit}){return[...collections.competitions.values()].filter(c=>(!publicOnly||c.displayEnabled)&&(!cursor||c._id>cursor)).slice(0,limit)}},authorize,now:()=>now})
const matches=createMatchService({store:matchMemory.store,authorize,now:()=>now}),teams=createAdminTeamService({store:{read:id=>store.read('teams',id),async user(){return{nickname:'测试领队'}},async list(cursor,limit){return[...collections.teams.values()].filter(t=>!cursor||t._id>cursor).slice(0,limit)}},authorize})
let failRead=false,failImage=false,failChunk=false,delayChunk=false,loseAck=false,readCount=0
const requests=[],router=async event=>{
 requests.push({action:event.action,matchId:event.matchId})
 if(event.action.startsWith('live.images.')){if(delayChunk&&event.action==='live.images.chunk')await new Promise(r=>setTimeout(r,250));const r=await images(event);if(failChunk&&event.action==='live.images.chunk'&&event.index===1){failChunk=false;return{ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'分片连接中断，请重试上传。'}}}return r}
 if(event.action==='live.listPublic'){readCount++;if(failRead){failRead=false;return{ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'直播读取失败，请重试。'}}}}
 if(event.action.startsWith('live.'))return live(event)
 return event.action.startsWith('settings.')?settings(event):event.action.startsWith('competitions.')?competitions(event):event.action.startsWith('matches.')?matches(event):event.action.startsWith('teams.')?teams(event):/^(news|search|directory|content)\./.test(event.action)?content(event):auth(event)
}
const certDir=await fs.mkdtemp('/tmp/community-football-live-')
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',`${certDir}/key.pem`,'-out',`${certDir}/cert.pem`,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'})
const http=createHttpHandler(router,[adminOrigin,publicOrigin],[...PUBLIC_ACTIONS,...SETTINGS_PUBLIC,...COMPETITION_PUBLIC,...MATCH_PUBLIC,...CONTENT_PUBLIC])
const server=createServer({key:await fs.readFile(`${certDir}/key.pem`),cert:await fs.readFile(`${certDir}/cert.pem`)},async(req,res)=>{
 if(req.url?.startsWith('/image?')){const id=new URL(req.url,'https://localhost').searchParams.get('id'),bytes=imageMemory.objects.get(id);if(failImage||!bytes){res.writeHead(404);res.end();return}res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});res.end(bytes);return}
 let body='';for await(const chunk of req)body+=chunk
 const r=await http({httpMethod:req.method,headers:req.headers,body});res.writeHead(r.statusCode,r.headers)
 if(loseAck&&body.includes('"action":"live.publish"')){loseAck=false;res.end('{"ok":');return}res.end(r.body)
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const endpoint=`https://127.0.0.1:${server.address().port}/api`
imageMemory.storage.link=async id=>{if(imageMemory.controls.linkFails||!imageMemory.objects.has(id))throw new Error('Image link unavailable');return endpoint.replace('/api',`/image?id=${encodeURIComponent(id)}&v=${++imageMemory.controls.version}`)}
process.env.VITE_ADMIN_API_URL=endpoint
const config=resolve('.tools/live-public.vite.config.ts')
await fs.writeFile(config,"import base from '../vite.config';export default env=>({...base(env),cacheDir:'.tools/live-public-cache',server:{host:'127.0.0.1',port:5197,strictPort:true,hmr:false}})\n")
const adminVite=await createViteServer({configFile:'admin/vite.config.ts',mode:'test',cacheDir:resolve('.tools/live-admin-cache'),server:{host:'127.0.0.1',port:5198,strictPort:true,hmr:false}});await adminVite.listen()
const publicServer=spawn('node',['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js','--config',config,'--host','127.0.0.1','--port','5197'],{detached:true,env:{...process.env,CHOKIDAR_USEPOLLING:'true',VITE_COMPETITION_API_URL:endpoint},stdio:['ignore','pipe','pipe']})
let publicLog='';for(const stream of[publicServer.stdout,publicServer.stderr])stream.on('data',b=>publicLog+=b)
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai',ignoreHTTPSErrors:true})
context.setDefaultTimeout(15000)
const admin=await context.newPage(),user=await context.newPage(),checks=[],errors=[]
await user.clock.install({time:new Date('2026-11-18T08:00:00Z')})
for(const page of[admin,user])page.on('pageerror',e=>errors.push(e.message))
const check=name=>{checks.push(name);console.log(`PASS ${name}`)},entry=id=>admin.locator(`[data-live-id="${id}"]`)
let visit=0,token
const openPublic=async(id=mid)=>{await user.goto(`${publicOrigin}/?testVisit=${++visit}#/pages/match/detail?id=${id}`);await user.getByRole('button',{name:'图文直播',exact:true}).click();await user.locator('.match-live-feed').waitFor()}
const waitAdmin=()=>admin.waitForFunction(()=>!document.querySelector('.live-admin-actions .primary-button')?.disabled)
const refresh=async()=>{await user.getByRole('button',{name:'刷新直播',exact:true}).click();await user.waitForFunction(()=>{const button=[...document.querySelectorAll('[role="button"]')].find(b=>b.textContent==='刷新直播');return button&&!button.hasAttribute('disabled')})}
const watchdog=setTimeout(()=>{console.error('Live browser watchdog: '+JSON.stringify({checks,errors}));process.exit(1)},180000)
async function call(action,fields={},authorized=true){const r=await context.request.post(endpoint,{headers:authorized?{authorization:`Bearer ${token}`}:{},data:{action,...fields}});return{status:r.status(),...await r.json()}}
async function publish(text,minute=''){await admin.getByRole('button',{name:'发布新动态',exact:true}).click();await admin.getByLabel('直播文字',{exact:true}).fill(text);await admin.getByLabel('比赛分钟',{exact:true}).fill(minute);await admin.getByRole('button',{name:'确认发布直播',exact:true}).click();await admin.locator('.live-admin-editor').waitFor({state:'detached'});await waitAdmin();return[...collections.matchLiveEntries.values()].filter(e=>!e.deletedAt).sort((a,b)=>b.createdAt-a.createdAt).find(e=>e.text===text)._id}
try{
 const deadline=Date.now()+30000;for(;;){if(publicServer.exitCode!==null)throw new Error(publicLog);try{if((await fetch(publicOrigin)).ok)break}catch{}if(Date.now()>deadline)throw new Error(publicLog);await new Promise(r=>setTimeout(r,250))}
 await admin.goto(adminOrigin);await admin.getByLabel('管理员账号',{exact:true}).fill('admin');await admin.getByLabel('登录密码',{exact:true}).fill(password);await admin.getByRole('button',{name:'登录管理后台',exact:true}).click();await admin.locator('.workspace').waitFor();token=await admin.evaluate(()=>sessionStorage.getItem('community-football.admin.session.v1'))
 await admin.getByRole('button',{name:'图文直播',exact:true}).click();await waitAdmin();await openPublic();await user.getByText('暂无图文直播',{exact:true}).waitFor();assert.equal((await call('live.publish',{},false)).status,401);check('后台直播入口与客户端比赛详情入口可达，空态和匿名管理隔离正确')
 const raw='开场精彩瞬间\n<script>window.liveInjected=true</script>',original=structuredClone(collections.matches.get(mid)),first=await publish(raw,'12')
 await refresh();await user.locator(`[data-live-id="${first}"]`).waitFor();assert.equal(await user.locator('.live-entry-text').innerText(),raw);assert.equal(await user.evaluate(()=>window.liveInjected),undefined);assert.deepEqual(collections.matches.get(mid),original);check('后台文字发布后客户端刷新可见，换行和标签安全显示，比分事件不被改写')
 await entry(first).getByRole('button',{name:'更正直播',exact:true}).click();await admin.getByLabel('直播文字',{exact:true}).fill('官方更正：精彩配合');await admin.getByRole('button',{name:'保存直播更正',exact:true}).click();await admin.locator('.live-admin-editor').waitFor({state:'detached'});await refresh();await user.getByText('官方更正：精彩配合',{exact:true}).waitFor();await user.getByText('· 已更正',{exact:false}).waitFor();check('直播更正保持发布顺序，客户端显示更正标记')
 await entry(first).getByRole('button',{name:'更正直播',exact:true}).click();const old=collections.matchLiveEntries.get(first);assert.equal((await call('live.correct',{matchId:mid,id:first,expectedVersion:old.version,requestId:randomBytes(16).toString('hex'),form:{text:'另一管理员更正',minute:null,images:[]}})).ok,true);await admin.getByLabel('直播文字',{exact:true}).fill('过期编辑');await admin.getByRole('button',{name:'保存直播更正',exact:true}).click();await admin.getByText('直播已被其他管理员修改，请重新读取后编辑。',{exact:true}).waitFor();assert.equal(await admin.getByRole('button',{name:'保存直播更正',exact:true}).isDisabled(),true);assert.equal(collections.matchLiveEntries.get(first).text,'另一管理员更正');await admin.getByRole('button',{name:'重新读取直播',exact:true}).click();await entry(first).getByText('另一管理员更正',{exact:true}).waitFor();check('多管理员版本冲突阻止覆盖，重新读取后可继续维护')
 loseAck=true;now++;await admin.getByRole('button',{name:'发布新动态',exact:true}).click();await admin.getByLabel('直播文字',{exact:true}).fill('响应中断的动态');await admin.getByRole('button',{name:'确认发布直播',exact:true}).click();await admin.getByText('请先点击“重新读取直播”确认云端结果，再继续编辑。',{exact:true}).waitFor();assert.equal(collections.matchLiveEntries.size,2);await admin.getByRole('button',{name:'重新读取直播',exact:true}).click();await admin.getByText('响应中断的动态',{exact:true}).waitFor();assert.equal(collections.matchLiveEntries.size,2);check('发布响应中断不显示虚假成功，重新读取确认已提交且不重复发布')
 await entry(first).getByRole('button',{name:'删除直播',exact:true}).click();assert.equal(await admin.getByRole('button',{name:'确认删除直播',exact:true}).isDisabled(),true);await admin.getByLabel('输入“删除”确认',{exact:true}).fill('删除');await admin.getByRole('button',{name:'确认删除直播',exact:true}).click();await entry(first).waitFor({state:'detached'});await refresh();assert.equal(await user.locator(`[data-live-id="${first}"]`).count(),0);check('删除需明确确认，软删除后客户端刷新移除')
 await admin.getByRole('button',{name:'发布新动态',exact:true}).click();await admin.getByLabel('直播文字',{exact:true}).fill('赛场双图动态');await admin.getByRole('button',{name:'添加直播图片',exact:true}).click()
 const bytes=PNG.sync.write({width:300,height:300,data:randomBytes(360000)});failChunk=true;delayChunk=true
 await admin.getByLabel('直播图1上传图片',{exact:true}).setInputFiles({name:'赛场.png',mimeType:'image/png',buffer:bytes});await admin.getByText('分片连接中断，请重试上传。',{exact:true}).waitFor();assert.equal(await admin.getByRole('button',{name:'确认发布直播',exact:true}).isDisabled(),true);assert.equal(await admin.getByLabel('选择直播比赛',{exact:true}).isDisabled(),true);await admin.getByRole('button',{name:'重试上传',exact:true}).click();await admin.getByRole('button',{name:'刷新图片链接',exact:true}).waitFor();delayChunk=false
 await admin.getByLabel('图片1说明',{exact:true}).fill('主场球迷');await admin.getByRole('button',{name:'添加直播图片',exact:true}).click();const small=PNG.sync.write({width:6,height:4,data:Buffer.alloc(96,150)});await admin.getByLabel('直播图2上传图片',{exact:true}).setInputFiles({name:'客场.png',mimeType:'image/png',buffer:small});await admin.getByLabel('图片2说明',{exact:true}).fill('客队入场');await admin.locator('.live-admin-image').nth(1).getByRole('button',{name:'刷新图片链接',exact:true}).waitFor();await admin.getByRole('button',{name:'上移图片2',exact:true}).click();await admin.getByRole('button',{name:'确认发布直播',exact:true}).click();await admin.locator('.live-admin-editor').waitFor({state:'detached'});const photo=[...collections.matchLiveEntries.values()].find(e=>e.text==='赛场双图动态');assert.equal(photo.images[0].caption,'客队入场');assert.ok(photo.images.every(i=>!i.url));check('本地图片分片中断可续传，上传未结束禁止发布和切换，双图顺序正确且不持久化签名链接')
 await refresh();await user.locator(`[data-live-id="${photo._id}"] .live-image-button`).first().waitFor();assert.equal(await user.locator(`[data-live-id="${photo._id}"] .live-image-button`).count(),2);const projection=await call('live.listPublic',{matchId:mid},false);assert.equal(JSON.stringify(projection.entries).includes('imageId'),false);assert.equal(JSON.stringify(projection.entries).includes('entryId'),false);check('图文发布后客户端读取真实上传图片，公开投影隐藏管理信息和图片关联ID')
 for(const width of[1440,390,320]){await user.setViewportSize({width,height:1000});await user.locator(`[data-live-id="${photo._id}"]`).screenshot({path:`${out}/public-photos-${width}.png`});await admin.setViewportSize({width,height:1000});await admin.getByRole('button',{name:'发布新动态',exact:true}).click();await admin.getByRole('button',{name:'添加直播图片',exact:true}).click();assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await admin.locator('.live-admin-editor').screenshot({path:`${out}/admin-editor-${width}.png`});await admin.getByRole('button',{name:'取消编辑',exact:true}).click()}
 await user.setViewportSize({width:1440,height:1000});await admin.setViewportSize({width:1440,height:1000})
 failImage=true;await refresh();await user.getByText('图片暂不可用',{exact:true}).first().waitFor();failImage=false;await refresh();await user.locator(`[data-live-id="${photo._id}"] .live-image-button`).first().waitFor();check('图片加载失败有占位，刷新签名链接后可恢复')
 failRead=true;await refresh();await user.locator('.recovery-notice-title').getByText('正在显示本机公开快照',{exact:true}).waitFor();assert.equal(await user.locator('.live-feed-entry').count(),2);await refresh();await user.locator('.recovery-notice').waitFor({state:'hidden'});check('直播暂时失败保留已确认快照并标明来源，手动刷新恢复实时读取')
 const count=readCount;now++;await publish('自动更新动态');await user.clock.fastForward(15001);await user.getByText('自动更新动态',{exact:true}).waitFor();assert.ok(readCount>count);check('前台每15秒自动读取最新直播')
 await user.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}));await user.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));const paused=readCount;await user.clock.fastForward(45000);assert.equal(readCount,paused);await user.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>false}));await user.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await user.waitForFunction(()=>!document.querySelector('.live-feed-heading button')?.hasAttribute('disabled'));assert.ok(readCount>paused);check('页面进入后台停止轮询，回到前台立即同步')
 const latest=[...collections.matchLiveEntries.values()].find(e=>e.text==='自动更新动态');assert.ok(latest)
 for(let n=0;n<22;n++){now++;assert.equal((await call('live.publish',{matchId:mid,requestId:randomBytes(16).toString('hex'),form:{text:`历史动态${n}`,minute:null,images:[]}})).ok,true)}
 await refresh();assert.equal(await user.locator('.live-feed-entry').count(),20);await user.getByRole('button',{name:'加载更早动态',exact:true}).click();await user.waitForFunction(()=>document.querySelectorAll('.live-feed-entry').length===25);const historyCount=readCount;await user.clock.fastForward(30000);assert.equal(readCount,historyCount);check('时间排序分页无重复，查看更早动态时暂停自动刷新以保留阅读位置')
 await admin.getByLabel('选择直播比赛',{exact:true}).selectOption(other);await waitAdmin();assert.equal(await admin.locator('.live-admin-entry').count(),0);await openPublic(other);await user.getByText('暂无图文直播',{exact:true}).waitFor();check('切换比赛清空上一场内容，两场直播相互隔离')
 await openPublic(mid);await refresh();collections.competitions.get(cid).displayEnabled=false;await refresh();await user.getByText('比赛不存在或暂未公开。',{exact:true}).waitFor();assert.equal(await user.locator('.live-feed-entry').count(),0);collections.competitions.get(cid).displayEnabled=true;await refresh();await user.locator('.live-feed-entry').first().waitFor();check('赛事隐藏后公开直播拒绝并移除旧内容，重新公开可恢复')
 await admin.getByLabel('选择直播比赛',{exact:true}).selectOption(mid);await waitAdmin();await admin.locator('.live-image-maintenance summary').click();await admin.getByRole('button',{name:'检查待清理直播图片',exact:true}).click();await admin.getByText(/保护 2 张图片/).waitFor();assert.equal(imageMemory.removed.filter(id=>id.includes('/files/')).length,0);check('图片维护真实检查已发布引用保护，未到期图片不误删')
 for(const width of[1440,390,320]){await user.setViewportSize({width,height:1000});await admin.setViewportSize({width,height:1000});assert.equal(await user.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await user.locator('.match-live-feed').screenshot({path:`${out}/public-${width}.png`});await admin.screenshot({path:`${out}/admin-${width}.png`,fullPage:true})}check('后台与客户端直播在1440/390/320px布局无横向溢出')
 assert.deepEqual(errors,[]);await fs.writeFile(`${out}/report.json`,JSON.stringify({date:'2026-11-18',scope:'Actual Vue UI, HTTP routing and cloud business handlers with isolated transactional/database/storage fixtures; not customer-cloud or physical-device acceptance',checks,errors,requestCount:requests.length},null,2)+'\n')
 console.log(JSON.stringify({passed:checks.length,errors}))
}catch(e){await fs.writeFile(`${out}/failure.txt`,e.stack+'\n'+publicLog.slice(-3000));await fs.writeFile(`${out}/report.json`,JSON.stringify({checks,errors,failure:e.message},null,2));await admin.screenshot({path:`${out}/admin-failure.png`,fullPage:true}).catch(()=>{});await user.screenshot({path:`${out}/public-failure.png`,fullPage:true}).catch(()=>{});throw e}
finally{clearTimeout(watchdog);await browser.close();await adminVite.close();try{process.kill(-publicServer.pid,'SIGTERM')}catch{}server.closeAllConnections();await new Promise(r=>server.close(r))}
