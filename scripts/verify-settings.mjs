import {createRequire} from 'node:module'
import {randomBytes} from 'node:crypto'
import {createServer} from 'node:https'
import {createServer as createViteServer} from 'vite'
import {chromium} from 'playwright'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {execFileSync,spawn} from 'node:child_process'
const require=createRequire(import.meta.url)
const {createAdminService,createAccount}=require('../cloudfunctions/adminAuth/service.js')
const {createHttpHandler}=require('../cloudfunctions/adminAuth/http.js')
const {createSettingsService,PUBLIC_ACTIONS}=require('../cloudfunctions/adminAuth/platform-settings.js')
const {createContentService,PUBLIC_ACTIONS:CONTENT_PUBLIC}=require('../cloudfunctions/adminAuth/content.js')
const {createCompetitionService,PUBLIC_ACTIONS:COMPETITION_PUBLIC}=require('../cloudfunctions/adminAuth/competitions.js')
const {createMatchService,PUBLIC_ACTIONS:MATCH_PUBLIC}=require('../cloudfunctions/adminAuth/matches.js')
const {createStandingsService,PUBLIC_ACTIONS:STANDINGS_PUBLIC}=require('../cloudfunctions/adminAuth/standings.js')
const {createMemoryStore}=require('../tests/helpers/admin-store.cjs')
const {createContentMemoryStore}=require('../tests/helpers/content-store.cjs')
const {createMatchMemoryStore}=require('../tests/helpers/match-store.cjs')
const defaults=require('../src/domain/platform-settings-schema.json').defaults
const out='artifacts/settings';await fs.mkdir(out,{recursive:true});await fs.mkdir('.tools',{recursive:true})
const now=Date.parse('2026-11-18T02:00:00Z'),password=randomBytes(24).toString('base64url')
const auth=createAdminService({store:createMemoryStore(await createAccount('admin',password,now)).store,now:()=>now,logger:{error(){}}})
const authorize=token=>auth({action:'session',token}),memory=createContentMemoryStore(),{store,collections}=memory
const settings=createSettingsService({store,authorize,now:()=>now,logger:{error(){}}}),content=createContentService({store,authorize,now:()=>now,logger:{error(){}}})
const cid='c_'+'1'.repeat(32),mid='m_'+'1'.repeat(32),home='t_'+'1'.repeat(64),away='t_'+'2'.repeat(64)
collections.competitions.set(cid,{_id:cid,name:'主题验收社区杯',description:'隔离浏览器数据',format:'round_robin',formatDescription:'单循环',startDate:'2026-11-20',endDate:'2026-12-31',venue:'社区球场',registrationRequirements:'提交材料',registrationStartAt:null,registrationEndAt:null,registrationEnabled:false,displayEnabled:true,version:1,createdAt:now,updatedAt:now})
for(const [id,name] of [[home,'邻里联队'],[away,'社区星火']])collections.teams.set(id,{_id:id,name,status:'active',district:'虹口区',description:'社区球队',version:1,roster:[]})
collections.matches.set(mid,{_id:mid,competitionId:cid,stage:'group',round:1,groupId:'A',slot:null,homeTeamId:home,awayTeamId:away,homeFrom:null,awayFrom:null,status:'scheduled',homeScore:null,awayScore:null,scheduledAt:'2026-11-20T08:00:00.000Z',venue:'社区球场',version:1,createdAt:now,updatedAt:now})
const matchesMemory=createMatchMemoryStore({competitions:collections.competitions,teams:collections.teams,registrations:collections.registrations,records:collections.matches})
const competitions=createCompetitionService({store:{read:id=>store.read('competitions',id),async list(){return [...collections.competitions.values()]}},authorize,now:()=>now,logger:{error(){}}})
const matches=createMatchService({store:matchesMemory.store,authorize,now:()=>now,logger:{error(){}}}),standings=createStandingsService({store:matchesMemory.standingsStore,authorize,now:()=>now,logger:{error(){}}})
let failPublic=false,loseAck=false,holdSave=false;const saves=[]
const router=async event=>{
 if(event.action==='settings.getPublic'&&failPublic)return {ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'同步暂不可用，请重试。'}}
 if(event.action==='settings.update'){saves.push(structuredClone(event));if(holdSave)await new Promise(r=>setTimeout(r,350))}
 return event.action.startsWith('settings.')?settings(event):/^(news|search|directory|content)\./.test(event.action)?content(event):event.action.startsWith('competitions.')?competitions(event):event.action.startsWith('matches.')?matches(event):event.action.startsWith('standings.')?standings(event):auth(event)
}
const adminOrigin='http://127.0.0.1:5194',publicOrigin='http://127.0.0.1:5193',certDir=await fs.mkdtemp('/tmp/community-football-settings-')
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',`${certDir}/key.pem`,'-out',`${certDir}/cert.pem`,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'})
const http=createHttpHandler(router,[adminOrigin,publicOrigin],[...PUBLIC_ACTIONS,...CONTENT_PUBLIC,...COMPETITION_PUBLIC,...MATCH_PUBLIC,...STANDINGS_PUBLIC])
const server=createServer({key:await fs.readFile(`${certDir}/key.pem`),cert:await fs.readFile(`${certDir}/cert.pem`)},async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk
 const result=await http({httpMethod:req.method,headers:req.headers,body})
 if(loseAck&&body.includes('"action":"settings.update"')){loseAck=false;res.writeHead(result.statusCode,result.headers);res.end('{"ok":');return}
 res.writeHead(result.statusCode,result.headers);res.end(result.body)
})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const endpoint=`https://127.0.0.1:${server.address().port}/api`
process.env.VITE_ADMIN_API_URL=endpoint
const config=resolve('.tools/d10-public.vite.config.ts')
await fs.writeFile(config,"import base from '../vite.config'; export default env => ({ ...base(env), cacheDir: '.tools/d10-public-cache', server: { host: '127.0.0.1', port: 5193, strictPort: true, hmr: false } })\n")
const adminVite=await createViteServer({configFile:'admin/vite.config.ts',mode:'test',cacheDir:resolve('.tools/d10-admin-cache'),server:{host:'127.0.0.1',port:5194,strictPort:true,hmr:false}});await adminVite.listen()
const publicServer=spawn('node',['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js','--config',config,'--host','127.0.0.1','--port','5193'],{detached:true,env:{...process.env,CHOKIDAR_USEPOLLING:'true',VITE_COMPETITION_API_URL:endpoint},stdio:['ignore','pipe','pipe']})
let publicLog='';for(const stream of [publicServer.stdout,publicServer.stderr])stream.on('data',b=>publicLog+=b)
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai',ignoreHTTPSErrors:true})
context.setDefaultTimeout(15000)
const admin=await context.newPage(),user=await context.newPage(),checks=[],errors=[]
for(const p of [admin,user])p.on('pageerror',e=>errors.push(e.message))
const check=name=>{checks.push(name);console.log(`PASS ${name}`)}
const version=()=>collections.platformSettings.get('primary')?.version||0
const waitVersion=v=>user.waitForFunction(v=>Number(document.querySelector('.app-shell')?.getAttribute('data-settings-version'))===v,v)
const refreshUser=async()=>{await user.bringToFront();await user.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))}
const saveButton=()=>admin.getByRole('button',{name:'保存平台设置',exact:true})
const save=async()=>{const before=version();await saveButton().click();await admin.getByText('平台设置已保存。客户端重新进入页面或回到前台时同步。',{exact:true}).waitFor();assert.equal(version(),before+1)}
async function layout(page,width){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${width}px overflow`)}
try{
 for(let i=0;i<120;i++){try{const r=await fetch(publicOrigin);if(r.ok)break}catch{}await new Promise(r=>setTimeout(r,250));if(i===119)throw new Error(publicLog)}
 const denied=await context.request.post(endpoint,{data:{action:'settings.update',form:defaults}});assert.equal(denied.status(),401)
 await admin.goto(adminOrigin);await admin.getByLabel('管理员账号',{exact:true}).fill('admin');await admin.getByLabel('登录密码',{exact:true}).fill(password);await admin.getByRole('button',{name:'登录管理后台'}).click();await admin.locator('.workspace').waitFor();await admin.getByRole('button',{name:'平台设置',exact:true}).click();await admin.getByLabel('平台名称',{exact:true}).waitFor()
 await user.goto(publicOrigin);await user.locator('.hero').waitFor();await waitVersion(0);assert.equal(await user.locator('.brand-title').innerText(),'中国社超');assert.equal(await user.locator('.desktop-nav .nav-item').count(),6)
 check('管理员设置入口、匿名写入拒绝和无配置默认外观正常')
 await admin.getByLabel('平台名称',{exact:true}).fill('上海社区足球');await admin.getByLabel('平台副标题',{exact:true}).fill('邻里赛事服务');await admin.getByRole('button',{name:'海湾蓝',exact:true}).click();await admin.getByLabel('导航名称 search',{exact:true}).fill('找球');await admin.getByLabel('导航图标 search',{exact:true}).selectOption('ball');await admin.getByRole('button',{name:'上移 search',exact:true}).click()
 assert.equal(await admin.locator('.settings-preview-top strong').innerText(),'上海社区足球');await refreshUser();await waitVersion(0);assert.equal(await user.locator('.brand-title').innerText(),'中国社超');assert.equal(version(),0)
 check('未保存修改只更新后台预览，名称图标和排序不提前影响客户端')
 holdSave=true;await saveButton().click();await admin.getByRole('button',{name:'正在保存…',exact:true}).waitFor();assert.equal(await admin.getByLabel('平台名称',{exact:true}).isDisabled(),true);await admin.getByText('平台设置已保存。客户端重新进入页面或回到前台时同步。',{exact:true}).waitFor();holdSave=false
 assert.equal(saves.length,1);await refreshUser();await waitVersion(1);assert.equal(await user.locator('.brand-title').innerText(),'上海社区足球');assert.equal(await user.locator('.desktop-nav .nav-item').nth(3).innerText(),'找球');assert.equal(await user.locator('.app-shell').evaluate(e=>getComputedStyle(e).getPropertyValue('--accent').trim()),'#176390')
 await user.reload();await waitVersion(1);check('真实HTTPS保存后客户端回到前台及重新加载同步，同一保存无重复提交')
 await user.locator('.desktop-nav').getByRole('button',{name:'找球',exact:true}).click();await user.locator('.search-panel').waitFor();await user.getByRole('button',{name:'关闭搜索',exact:true}).click();await user.locator('.desktop-nav').getByRole('button',{name:'赛事',exact:true}).click();await user.locator('.public-competition-card').waitFor();await user.locator('.desktop-nav').getByRole('button',{name:'动态',exact:true}).click();await user.locator('.public-news').waitFor();await user.locator('.desktop-nav').getByRole('button',{name:'数据',exact:true}).click();await user.locator('.public-standings').waitFor();await user.locator('.desktop-nav').getByRole('button',{name:'我的',exact:true}).click();await user.locator('.profile-page').waitFor();await user.locator('.desktop-nav').getByRole('button',{name:'首页',exact:true}).click()
 check('六个可配置入口保留真实站内目标，搜索仍打开现有搜索面板')
 await admin.getByLabel('明暗模式',{exact:true}).selectOption('dark');await admin.getByLabel('圆角风格',{exact:true}).selectOption('round');await admin.getByLabel('配色方式',{exact:true}).selectOption('custom');await admin.getByLabel('自选主色',{exact:true}).fill('#ffffff');await save();await refreshUser();await waitVersion(2)
 for(const width of [1440,390,320]){await layout(user,width);await user.screenshot({path:`${out}/dark-custom-${width}.png`,fullPage:true})}
 const tone=await user.locator('.mobile-nav-item.active .app-icon img').getAttribute('src');assert.ok(tone.includes('-ink.png'))
 await user.locator('.mobile-nav').getByRole('button',{name:'找球',exact:true}).click();await user.locator('.search-panel').waitFor();await user.screenshot({path:`${out}/dark-search-320.png`,fullPage:true});await layout(user,320);await user.getByRole('button',{name:'关闭搜索',exact:true}).click()
 check('深色/自选白色/圆角同步，白底选中图标保留深色，320/390/1440px无横向溢出')
 failPublic=true;await user.reload();await user.locator('.recovery-notice-title').getByText('正在显示本机公开快照',{exact:true}).waitFor();await waitVersion(2);assert.equal(await user.locator('.brand-title').innerText(),'上海社区足球');failPublic=false;await user.getByRole('button',{name:'重新连接',exact:true}).click();await user.locator('.recovery-notice').waitFor({state:'hidden'})
 check('网络失败保留已确认的平台设置快照与来源，重新连接后恢复实时同步')
 loseAck=true;await admin.getByLabel('平台副标题',{exact:true}).fill('保存重试验收');await saveButton().click();await admin.locator('.platform-settings-admin [role="alert"]').waitFor();assert.equal(version(),3);const firstId=saves.at(-1).requestId;await saveButton().click();await admin.getByText('平台设置已保存。客户端重新进入页面或回到前台时同步。',{exact:true}).waitFor();assert.equal(version(),3);assert.equal(saves.at(-1).requestId,firstId)
 check('服务端已提交但响应中断时重试复用请求，版本只增加一次')
 const session=await admin.evaluate(()=>sessionStorage.getItem('community-football.admin.session.v1'))
 const concurrent=await settings({action:'settings.update',token:session,expectedVersion:3,requestId:randomBytes(16).toString('hex'),form:{...defaults,title:'另一个管理员'}});assert.equal(concurrent.ok,true)
 await admin.getByLabel('平台名称',{exact:true}).fill('过期编辑');await saveButton().click();await admin.getByText('设置已有新版本，请重新读取后修改。',{exact:true}).waitFor();assert.equal(version(),4);assert.equal(await saveButton().isDisabled(),true);await admin.getByRole('button',{name:'重新读取设置',exact:true}).click();await admin.waitForFunction(()=>document.querySelector('.platform-settings-form input').value==='另一个管理员')
 check('并发版本冲突阻止覆盖，重新读取后恢复正确内容')
 await admin.getByLabel('平台名称',{exact:true}).fill('名称'.repeat(8));await admin.getByLabel('平台副标题',{exact:true}).fill('赛事平台'.repeat(6));await admin.getByLabel('配色方式',{exact:true}).selectOption('custom');await admin.getByLabel('自选主色',{exact:true}).fill('#');assert.equal(await admin.locator('.settings-preview').evaluate(e=>e.style.cssText.includes('NaN')),false);await admin.getByLabel('自选主色',{exact:true}).fill('#000000');await admin.getByLabel('明暗模式',{exact:true}).selectOption('light');await admin.getByLabel('圆角风格',{exact:true}).selectOption('square');for(const id of ['home','tournament','news','stats','search','profile'])await admin.getByLabel(`导航名称 ${id}`,{exact:true}).fill('四字导航');await save();await refreshUser();await waitVersion(5)
 for(const width of [1440,1024,390,320]){await layout(user,width);await user.screenshot({path:`${out}/long-labels-${width}.png`,fullPage:true})}
 for(const width of [1440,390,320]){await layout(admin,width);await admin.screenshot({path:`${out}/admin-${width}.png`,fullPage:true})}
 check('最长名称/副标题/六个四字导航和未填完整颜色安全预览，两端窄屏与桌面无溢出')
 await admin.getByRole('button',{name:'恢复默认预览',exact:true}).click();assert.equal(version(),5);await save();await user.reload();await waitVersion(6);assert.deepEqual(collections.platformSettings.get('primary').form,defaults);check('恢复默认先预览再保存，客户端与后台回读一致')

 // Personal choices are stored locally and composed with the same live platform settings.
 await layout(user,1440);await user.locator('.desktop-nav').getByRole('button',{name:'我的',exact:true}).click();await user.locator('.profile-page').waitFor()
 await user.getByRole('button',{name:'设置个人外观',exact:true}).click();await user.locator('.appearance-page').waitFor()
 const personal=()=>user.locator('.appearance-page'),shell=()=>user.locator('.app-shell').filter({has:personal()})
 const token=key=>shell().evaluate((e,key)=>getComputedStyle(e).getPropertyValue(key).trim(),key)
 const press=name=>personal().getByRole('button',{name,exact:true}).click()
 const savePersonal=async()=>{await press('保存外观设置');await personal().getByText('外观已保存并生效。',{exact:true}).waitFor()}
 assert.match(await personal().locator('.appearance-scope').innerText(),/游客/)
 assert.equal(await personal().getByRole('button',{name:'跟随平台明暗',exact:true}).getAttribute('aria-pressed'),'true')
 await press('海湾蓝');await press('深色');await press('圆润')
 assert.equal(await token('--accent'),'#1e6b48');assert.equal(await shell().evaluate(e=>e.classList.contains('theme-dark')),false)
 assert.equal(await personal().locator('.appearance-preview').evaluate(e=>getComputedStyle(e).getPropertyValue('--accent').trim()),'#176390')
 await savePersonal();assert.equal(await token('--accent'),'#176390');assert.equal(await token('--radius'),'20px');assert.equal(await shell().evaluate(e=>e.classList.contains('theme-dark')),true)
 check('我的外观入口可达，游客说明准确，个人未保存仅预览，保存才全局应用')

 await user.reload();await personal().waitFor();assert.equal(await token('--accent'),'#176390');assert.equal(await token('--radius'),'20px')
 await press('← 返回个人中心')
 await user.locator('.profile-page').waitFor();assert.equal(await user.locator('.app-shell').last().evaluate(e=>getComputedStyle(e).getPropertyValue('--accent').trim()),'#176390')
 await user.goto(`${publicOrigin}/#/pages/competition/detail?id=${cid}`);await user.getByText('主题验收社区杯',{exact:true}).first().waitFor();assert.equal(await user.locator('.app-shell').evaluate(e=>getComputedStyle(e).getPropertyValue('--accent').trim()),'#176390')
 await user.goto(`${publicOrigin}/#/pages/profile/appearance`);await personal().waitFor()
 check('本机个人选择在刷新、返回个人中心及进入赛事详情后保持')

 await press('自选主色');await personal().locator('.appearance-custom input').fill('#f');await press('保存外观设置')
 await personal().getByRole('alert').filter({hasText:'六位十六进制'}).waitFor();assert.equal(await token('--accent'),'#176390')
 await press('放弃修改');assert.equal(await personal().getByRole('button',{name:'海湾蓝',exact:true}).getAttribute('aria-pressed'),'true')
 await press('玫瑰红');await user.reload();await personal().waitFor();assert.equal(await token('--accent'),'#176390');assert.equal(await personal().getByRole('button',{name:'海湾蓝',exact:true}).getAttribute('aria-pressed'),'true')
 check('无效自选色保存被拒绝，放弃修改及未保存离页不改变已保存外观')

 await press('跟随平台配色');await savePersonal()
 await admin.getByLabel('平台名称',{exact:true}).fill('平台联动复验');await admin.getByRole('button',{name:'玫瑰红',exact:true}).click();await admin.getByLabel('明暗模式',{exact:true}).selectOption('light');await admin.getByLabel('圆角风格',{exact:true}).selectOption('square');await admin.getByLabel('导航名称 search',{exact:true}).fill('找球');await save();await refreshUser();await waitVersion(7)
 assert.equal(await token('--accent'),'#aa3e62');assert.equal(await token('--radius'),'20px');assert.equal(await shell().evaluate(e=>e.classList.contains('theme-dark')),true)
 assert.equal(await shell().locator('.brand-title').innerText(),'平台联动复验');assert.match(await personal().locator('.appearance-preview-nav').innerText(),/找球/)
 await press('海湾蓝');await press('跟随平台明暗');await press('跟随平台圆角');await savePersonal()
 await admin.getByRole('button',{name:'暖阳橙',exact:true}).click();await admin.getByLabel('明暗模式',{exact:true}).selectOption('dark');await admin.getByLabel('圆角风格',{exact:true}).selectOption('soft');await save();await refreshUser();await waitVersion(8)
 assert.equal(await token('--accent'),'#176390');assert.equal(await token('--radius'),'10px');assert.equal(await shell().evaluate(e=>e.classList.contains('theme-dark')),true)
 check('三项独立优先级正确：平台更新只改变跟随项，名称与六导航始终同步')

 await press('自选主色');await personal().locator('.appearance-custom input').fill('#ffffff');await press('圆润');await savePersonal()
 for(const width of [1440,390,320]){await layout(user,width);await user.screenshot({path:`${out}/personal-appearance-${width}.png`,fullPage:true})}
 assert.ok((await personal().locator('.appearance-preview-action .app-icon img').getAttribute('src')).includes('-ink.png'))
 await press('全部跟随平台');assert.equal(await token('--accent'),'#ffffff');await savePersonal();assert.equal(await token('--accent'),'#925517');assert.equal(await token('--radius'),'10px')
 await admin.getByRole('button',{name:'恢复默认预览',exact:true}).click();await save();await refreshUser();await waitVersion(9);assert.equal(await token('--accent'),'#1e6b48');assert.equal(await shell().evaluate(e=>e.classList.contains('theme-dark')),false)
 check('个人自选白色/深色/圆角在320/390/1440px无溢出，全部跟随先预览再保存')

 await user.evaluate(()=>{window.__appearanceOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('community-football.appearance.'))throw new DOMException('Simulated storage quota','QuotaExceededError');return window.__appearanceOriginalSetItem.call(this,key,value)}})
 await press('海湾蓝');await press('保存外观设置');await personal().getByRole('alert').filter({hasText:'本机保存失败'}).waitFor();assert.equal(await token('--accent'),'#1e6b48')
 await user.evaluate(()=>{Storage.prototype.setItem=window.__appearanceOriginalSetItem;delete window.__appearanceOriginalSetItem})
 await savePersonal();assert.equal(await token('--accent'),'#176390')
 check('真实页面存储写入失败不改变当前外观，恢复存储后可重试保存')

 await user.evaluate(()=>{const key=Object.keys(localStorage).find(k=>k.startsWith('community-football.appearance.'));if(!key)throw new Error('Missing appearance cache');localStorage.setItem(key,JSON.stringify({type:'object',data:{version:1,owner:'another-account',form:{theme:'ocean'}}}))})
 await user.reload();await personal().waitFor();await personal().getByRole('alert').filter({hasText:'无法读取'}).waitFor();assert.equal(await token('--accent'),'#1e6b48')
 await press('湖水青');await savePersonal();assert.equal(await token('--accent'),'#14746c');await press('全部跟随平台');await savePersonal();await user.reload();await personal().waitFor();assert.equal(await personal().getByRole('alert').count(),0)
 check('损坏或身份不匹配的本机记录安全回退，可重新保存修复')
 assert.deepEqual(errors,[]);await fs.writeFile(`${out}/report.json`,JSON.stringify({date:'2026-11-18',generatedAt:new Date().toISOString(),checks,errors,scope:'Real Vue clients and HTTPS handler with real services, isolated transactional memory stores; not customer cloud or physical device acceptance.'},null,2));console.log(`Verified ${checks.length} D10 browser flows.`)
}catch(e){await fs.writeFile(`${out}/failure.txt`,`ADMIN\n${await admin.locator('body').innerText().catch(()=>'')}\nCLIENT\n${await user.locator('body').innerText().catch(()=>'')}\nERRORS\n${JSON.stringify(errors)}\nLOG\n${publicLog}`);throw e}
finally{await browser.close();await adminVite.close();try{process.kill(-publicServer.pid,'SIGTERM')}catch{}server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(certDir,{recursive:true,force:true})}
