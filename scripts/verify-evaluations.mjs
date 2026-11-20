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
const {createEvaluationService,PUBLIC_ACTIONS}=require('../cloudfunctions/adminAuth/evaluations.js')
const {createSettingsService,PUBLIC_ACTIONS:SETTINGS_PUBLIC}=require('../cloudfunctions/adminAuth/platform-settings.js')
const {createCompetitionService,PUBLIC_ACTIONS:COMPETITION_PUBLIC}=require('../cloudfunctions/adminAuth/competitions.js')
const {createMatchService,PUBLIC_ACTIONS:MATCH_PUBLIC}=require('../cloudfunctions/adminAuth/matches.js')
const {createAdminTeamService}=require('../cloudfunctions/adminAuth/teams.js')
const {createContentService,PUBLIC_ACTIONS:CONTENT_PUBLIC}=require('../cloudfunctions/adminAuth/content.js')
const {createMemoryStore}=require('../tests/helpers/admin-store.cjs')
const {createContentMemoryStore}=require('../tests/helpers/content-store.cjs')
const {createMatchMemoryStore}=require('../tests/helpers/match-store.cjs')
const {registrationId}=require('../cloudfunctions/adminAuth/registration-model.js')
const out='artifacts/evaluations',adminOrigin='http://127.0.0.1:5200',publicOrigin='http://127.0.0.1:5199'
await fs.mkdir(out,{recursive:true});await fs.mkdir('.tools',{recursive:true})
let now=Date.parse('2026-11-20T08:00:00Z'),authNow=now
const password=randomBytes(24).toString('base64url'),auth=createAdminService({store:createMemoryStore(await createAccount('admin',password,now)).store,now:()=>authNow,logger:{error(){}}})
const authorize=token=>auth({action:'session',token}),memory=createContentMemoryStore(),{store,collections}=memory
const cid='c_'+'1'.repeat(32),mid='m_'+'1'.repeat(32),other='m_'+'2'.repeat(32),home='t_'+'a'.repeat(64),away='t_'+'b'.repeat(64)
collections.competitions.set(cid,{_id:cid,name:'评分验收社区杯',description:'隔离浏览器验收',format:'round_robin',formatDescription:'单循环',startDate:'2026-11-20',endDate:'2026-12-31',venue:'社区球场',registrationRequirements:'提交材料',registrationStartAt:null,registrationEndAt:null,registrationEnabled:false,displayEnabled:true,version:1,createdAt:now,updatedAt:now})
for(const[id,name]of[[home,'社区联队'],[away,'邻里星火']]){collections.teams.set(id,{_id:id,name,district:'虹口区',description:'公开球队',contactPhone:'021-11112222',status:'active',version:1,leaderUserId:'test-user',roster:[{id:'p_'+(id===home?'1':'2').repeat(32),name:id===home?'前锋甲':'中场乙',number:id===home?9:8,position:'forward'}],createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()});const rid=registrationId(cid,id);collections.registrations.set(rid,{_id:rid,competitionId:cid,teamId:id,status:'approved'})}
for(const[id,round]of[[mid,1],[other,2]])collections.matches.set(id,{_id:id,competitionId:cid,stage:'group',round,groupId:'A',slot:null,homeTeamId:home,awayTeamId:away,homeFrom:null,awayFrom:null,status:'finished',result:{state:'finished',minute:null,homeScore:0,awayScore:0,penalties:null,goals:[],cards:[],substitutions:[],stats:null},scheduledAt:`2026-11-${20+round}T08:00:00.000Z`,venue:'社区球场',version:1,createdAt:now,updatedAt:now})
const matchMemory=createMatchMemoryStore({competitions:collections.competitions,teams:collections.teams,registrations:collections.registrations,records:collections.matches}),options={store,authorize,now:()=>now,logger:{error(){}}}
const native=createEvaluationService({...options,context:()=>({APPID:'wx3230f06c755cef3a',OPENID:'browser-fixture-user'}),expectedAppId:'wx3230f06c755cef3a'}),evaluations=createEvaluationService({...options,context:()=>null}),settings=createSettingsService(options),content=createContentService(options)
const competitions=createCompetitionService({store:{read:id=>store.read('competitions',id),async list({publicOnly,cursor,limit}){return[...collections.competitions.values()].filter(c=>(!publicOnly||c.displayEnabled)&&(!cursor||c._id>cursor)).slice(0,limit)}},authorize,now:()=>now})
const matches=createMatchService({store:matchMemory.store,authorize,now:()=>now}),teams=createAdminTeamService({store:{read:id=>store.read('teams',id),async user(){return{nickname:'测试领队'}},async list(cursor,limit){return[...collections.teams.values()].filter(t=>!cursor||t._id>cursor).slice(0,limit)}},authorize})
let failPublic=false,failAdmin=false,loseAck=false
const requests=[],router=async event=>{
 requests.push({action:event.action,matchId:event.matchId})
 if(event.action==='evaluation.getPublic'&&failPublic){failPublic=false;return{ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'评分读取失败，请重试。'}}}
 if(event.action==='evaluation.getAdmin'&&failAdmin){failAdmin=false;return{ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'评分读取失败，请重试。'}}}
 return event.action.startsWith('evaluation.')?evaluations(event):event.action.startsWith('settings.')?settings(event):event.action.startsWith('competitions.')?competitions(event):event.action.startsWith('matches.')?matches(event):event.action.startsWith('teams.')?teams(event):/^(news|search|directory|content)\./.test(event.action)?content(event):auth(event)
}
const certDir=await fs.mkdtemp('/tmp/community-football-evaluations-')
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',`${certDir}/key.pem`,'-out',`${certDir}/cert.pem`,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'})
const http=createHttpHandler(router,[adminOrigin,publicOrigin],[...PUBLIC_ACTIONS,...SETTINGS_PUBLIC,...COMPETITION_PUBLIC,...MATCH_PUBLIC,...CONTENT_PUBLIC])
const server=createServer({key:await fs.readFile(`${certDir}/key.pem`),cert:await fs.readFile(`${certDir}/cert.pem`)},async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk
 const r=await http({httpMethod:req.method,headers:req.headers,body});res.writeHead(r.statusCode,r.headers)
 if(loseAck&&body.includes('"action":"evaluation.publishAwards"')){loseAck=false;res.end('{"ok":');return}res.end(r.body)
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const endpoint=`https://127.0.0.1:${server.address().port}/api`
process.env.VITE_ADMIN_API_URL=endpoint
const configFile=resolve('.tools/evaluations-public.vite.config.ts')
await fs.writeFile(configFile,"import base from '../vite.config';export default env=>({...base(env),cacheDir:'.tools/evaluations-public-cache',server:{host:'127.0.0.1',port:5199,strictPort:true,hmr:false}})\n")
const adminVite=await createViteServer({configFile:'admin/vite.config.ts',mode:'test',cacheDir:resolve('.tools/evaluations-admin-cache'),server:{host:'127.0.0.1',port:5200,strictPort:true,hmr:false}});await adminVite.listen()
const publicServer=spawn('node',['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js','--config',configFile,'--host','127.0.0.1','--port','5199'],{detached:true,env:{...process.env,CHOKIDAR_USEPOLLING:'true',VITE_COMPETITION_API_URL:endpoint},stdio:['ignore','pipe','pipe']})
let publicLog='';for(const stream of[publicServer.stdout,publicServer.stderr])stream.on('data',b=>publicLog+=b)
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai',ignoreHTTPSErrors:true})
context.setDefaultTimeout(15000)
const admin=await context.newPage(),user=await context.newPage(),checks=[],errors=[]
for(const page of[admin,user])page.on('pageerror',e=>errors.push(e.message))
const check=name=>{checks.push(name);console.log(`PASS ${name}`)},playerId='p_'+'1'.repeat(32)
let visit=0,token
const waitAdmin=()=>admin.waitForFunction(()=>{const el=document.querySelector('.evaluation-admin [type="submit"]');return el&&!el.disabled&&!el.closest('fieldset').disabled})
const openPublic=async(id=mid)=>{await user.goto(`${publicOrigin}/?testVisit=${++visit}#/pages/match/detail?id=${id}`);await user.getByRole('button',{name:'评分与评论',exact:true}).click();await user.locator('.evaluation-player').first().waitFor()}
const reloadAdmin=async()=>{await admin.getByRole('button',{name:'重新读取评分',exact:true}).click();await waitAdmin()}
const refresh=async()=>{await user.getByRole('button',{name:'刷新评分',exact:true}).click();await user.waitForFunction(()=>{const button=[...document.querySelectorAll('[role="button"]')].find(b=>b.textContent==='刷新评分');return button&&!button.hasAttribute('disabled')})}
const watchdog=setTimeout(()=>{console.error('Evaluation browser watchdog: '+JSON.stringify({checks,errors}));process.exit(1)},180000)
async function call(action,fields={},authorized=true){const r=await context.request.post(endpoint,{headers:authorized?{authorization:`Bearer ${token}`}:{},data:{action,...fields}});return{status:r.status(),...await r.json()}}
try{
 const deadline=Date.now()+30000;for(;;){if(publicServer.exitCode!==null)throw new Error(publicLog);try{if((await fetch(publicOrigin)).ok)break}catch{}if(Date.now()>deadline)throw new Error(publicLog);await new Promise(r=>setTimeout(r,250))}
 await admin.goto(adminOrigin);await admin.getByLabel('管理员账号',{exact:true}).fill('admin');await admin.getByLabel('登录密码',{exact:true}).fill(password);await admin.getByRole('button',{name:'登录管理后台',exact:true}).click();await admin.locator('.workspace').waitFor();token=await admin.evaluate(()=>sessionStorage.getItem('community-football.admin.session.v1'))
 await admin.getByRole('button',{name:'评分与评选',exact:true}).click();await waitAdmin();await openPublic();await user.getByText('赛事方尚未开放评分。',{exact:true}).waitFor();await user.getByText('请在微信小程序中登录后评分或评论。',{exact:true}).waitFor();assert.equal((await call('evaluation.configure',{},false)).status,401);check('后台及真实比赛详情入口可达，默认关闭且H5明确微信参与限制')
 await admin.getByLabel('开放评分',{exact:true}).check();await admin.getByLabel('开放评论',{exact:true}).check();await admin.getByLabel('开始时间（北京时间）',{exact:true}).fill('2026-11-20T15:00');await admin.getByLabel('结束时间（北京时间）',{exact:true}).fill('2026-11-21T22:00');await admin.getByRole('button',{name:'保存窗口',exact:true}).click();await admin.getByText('本赛事评分窗口已保存。',{exact:true}).waitFor();await waitAdmin()
 assert.equal(collections.evaluationConfigs.get(cid).openedAt,'2026-11-20T07:00:00.000Z');assert.equal(await admin.getByLabel('开始时间（北京时间）',{exact:true}).inputValue(),'2026-11-20T15:00');await reloadAdmin();await admin.getByRole('button',{name:'保存窗口',exact:true}).click();await waitAdmin();assert.equal(collections.evaluationConfigs.get(cid).openedAt,'2026-11-20T07:00:00.000Z');await refresh();await user.getByText('评分范围 1–10 分',{exact:true}).waitFor();check('真实表单开启赛事窗口并同步前台，北京时间保存及重读无8小时漂移')
 assert.equal((await native({action:'evaluation.rate',matchId:mid,playerId,score:9,requestId:randomBytes(16).toString('hex')})).ok,true)
 const text='积极跑动\n<script>window.evaluationInjected=true</script>',comment=await native({action:'evaluation.comment',matchId:mid,playerId,content:text,requestId:randomBytes(16).toString('hex')});assert.equal(comment.ok,true)
 await reloadAdmin();await admin.locator('.evaluation-admin-scores').getByText('9.00分',{exact:true}).waitFor();await refresh();await user.locator('.evaluation-player-score').getByText('9.00',{exact:true}).waitFor();assert.equal(await user.locator('.evaluation-comment').count(),0);check('隔离原生业务服务提交评分后前后台汇总一致，新评论等待审核')
 const row=admin.locator(`[data-comment-id="${comment.commentId}"]`)
 await row.getByRole('button',{name:'审核并展示',exact:true}).click();await row.getByRole('button',{name:'隐藏评论',exact:true}).waitFor();await refresh();assert.equal(await user.locator('.evaluation-comment').innerText(),`${text}\n2026-11-20`);assert.equal(await user.evaluate(()=>window.evaluationInjected),undefined)
 await row.getByRole('button',{name:'隐藏评论',exact:true}).click();await row.getByRole('button',{name:'审核并展示',exact:true}).waitFor();await refresh();assert.equal(await user.locator('.evaluation-comment').count(),0)
 await row.getByRole('button',{name:'审核并展示',exact:true}).click();await row.getByRole('button',{name:'隐藏评论',exact:true}).waitFor();await refresh();assert.equal(await user.locator('.evaluation-comment').count(),1);check('后台审核、隐藏、恢复联动客户端，换行和HTML标签安全显示')
 await admin.getByLabel('本场 MVP',{exact:true}).selectOption(playerId);await admin.getByLabel('前锋甲 · 社区联队',{exact:true}).check();await admin.getByLabel('前锋甲的位置（选填）',{exact:true}).fill('前锋');await admin.getByRole('button',{name:'发布评选结果',exact:true}).click();await admin.getByText('本场评选结果已发布。',{exact:true}).waitFor();await waitAdmin();await refresh();await user.getByText('本场 MVP',{exact:true}).waitFor();await user.getByText('本场最佳阵容',{exact:true}).waitFor();await openPublic(other);assert.equal(await user.locator('.evaluation-awards').count(),0);await openPublic();check('本场MVP及阵容位置发布可见，同赛事另一比赛不受影响')
 await admin.getByLabel('本场 MVP',{exact:true}).selectOption('');await admin.getByLabel('前锋甲 · 社区联队',{exact:true}).uncheck();await admin.getByRole('button',{name:'发布评选结果',exact:true}).click();await waitAdmin();await refresh();assert.equal(await user.locator('.evaluation-awards').count(),0);check('清空并发布可撤下本场评选')
 const current=collections.evaluationConfigs.get(cid);assert.equal((await call('evaluation.configure',{competitionId:cid,expectedVersion:current.version,requestId:randomBytes(16).toString('hex'),config:{enabled:false,commentsEnabled:false,scoreMin:1,scoreMax:10,openedAt:null,closedAt:null}})).ok,true)
 await admin.getByRole('button',{name:'保存窗口',exact:true}).click();await admin.getByText('评分配置已更新，请重新读取。',{exact:true}).waitFor();assert.equal(await admin.getByRole('button',{name:'保存窗口',exact:true}).isDisabled(),true);await reloadAdmin();assert.equal(await admin.getByLabel('开放评分',{exact:true}).isChecked(),false);check('过期窗口版本拒绝覆盖，重读云端结果后解除写入锁定')
 loseAck=true;await admin.getByLabel('本场 MVP',{exact:true}).selectOption(playerId);await admin.getByRole('button',{name:'发布评选结果',exact:true}).click();await admin.getByText('请先点击“重新读取评分”核对最新结果，再继续操作。',{exact:true}).waitFor();assert.equal(await admin.getByRole('button',{name:'发布评选结果',exact:true}).isDisabled(),true);await reloadAdmin();assert.equal(await admin.getByLabel('本场 MVP',{exact:true}).inputValue(),playerId);check('写入回执中断后要求重读，不显示未经确认的成功')
 await admin.getByLabel('选择已完赛比赛',{exact:true}).selectOption('');await admin.getByText('请选择一场已完赛比赛读取评分数据。',{exact:true}).waitFor();assert.equal(await admin.locator('.evaluation-admin-comment').count(),0);await admin.getByLabel('选择已完赛比赛',{exact:true}).selectOption(mid);await waitAdmin();check('清空比赛选择后移除上一场数据，重新选择正常恢复')
 failAdmin=true;await admin.getByRole('button',{name:'重新读取评分',exact:true}).click();await admin.getByText('评分读取失败，请重试。',{exact:true}).waitFor();await reloadAdmin()
 failPublic=true;await refresh();await user.getByText('评分读取失败，请重试。',{exact:true}).waitFor();assert.equal(await user.locator('.evaluation-player').count(),0);await refresh();await user.locator('.evaluation-player').first().waitFor();check('前后台读取失败有提示，刷新恢复且不残留旧数据')
 collections.competitions.get(cid).displayEnabled=false;await refresh();await user.getByText('比赛不存在或暂未公开。',{exact:true}).waitFor();assert.equal(await user.locator('.evaluation-comment').count(),0);assert.equal(await user.locator('.evaluation-awards').count(),0);collections.competitions.get(cid).displayEnabled=true;await refresh();check('赛事隐藏后移除旧评论与评选，重新公开可恢复')
 for(const width of[1440,390,320]){await user.setViewportSize({width,height:1000});await admin.setViewportSize({width,height:1000});assert.equal(await user.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await user.locator('.evaluation-panel').screenshot({path:`${out}/public-${width}.png`});await admin.screenshot({path:`${out}/admin-${width}.png`,fullPage:true})}check('后台和客户端1440/390/320px无横向溢出')
 assert.deepEqual(errors,[]);await fs.writeFile(`${out}/report.json`,JSON.stringify({date:'2026-11-20',scope:'Actual Vue UI and HTTP handlers with isolated database/auth/native-context fixtures; not customer-cloud or physical-device acceptance',checks,errors,requestCount:requests.length},null,2)+'\n');console.log(JSON.stringify({passed:checks.length,errors}))
}catch(e){await fs.writeFile(`${out}/failure.txt`,e.stack+'\n'+publicLog.slice(-3000));await fs.writeFile(`${out}/report.json`,JSON.stringify({checks,errors,failure:e.message},null,2));await admin.screenshot({path:`${out}/admin-failure.png`,fullPage:true}).catch(()=>{});await user.screenshot({path:`${out}/public-failure.png`,fullPage:true}).catch(()=>{});throw e}
finally{clearTimeout(watchdog);await browser.close();await adminVite.close();try{process.kill(-publicServer.pid,'SIGTERM')}catch{}server.closeAllConnections();await new Promise(r=>server.close(r))}
