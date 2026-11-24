import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createRequire} from 'node:module'
import {createServer} from 'node:https'
import {execFileSync,spawn} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {resolve} from 'node:path'
import {createServer as createViteServer} from 'vite'
import {chromium} from 'playwright'
const require=createRequire(import.meta.url)
const {createMaintenanceFixture}=require('../tests/helpers/team-maintenance-fixture.cjs')
const {createAdminService,createAccount}=require('../cloudfunctions/adminAuth/service')
const {createMemoryStore}=require('../tests/helpers/admin-store.cjs')
const {createAdminTeamService}=require('../cloudfunctions/adminAuth/teams')
const {createHttpHandler}=require('../cloudfunctions/adminAuth/http')
const {PUBLIC_ACTIONS}=require('../cloudfunctions/adminAuth/content')
const {createSettingsService,PUBLIC_ACTIONS:SETTINGS_ACTIONS}=require('../cloudfunctions/adminAuth/platform-settings')
const f=await createMaintenanceFixture(),out='artifacts/team-maintenance',adminBase='http://127.0.0.1:5215',userBase='http://127.0.0.1:5216'
await fs.mkdir(out,{recursive:true});await fs.mkdir('.tools',{recursive:true})
const password=randomBytes(24).toString('base64url'),accounts=createMemoryStore(await createAccount('admin',password,Date.now()))
const auth=createAdminService({store:accounts.store,logger:{error(){}}}),authorize=token=>auth({action:'session',token})
const teams=createAdminTeamService({store:f.adminStore,authorize,logger:{error(){}}}),settings=createSettingsService({store:f.contentStore,authorize,logger:{error(){}}})
const mutations=[],checks=[],errors=[],unexpected=[]
let loseMutation=false
const http=createHttpHandler(e=>e.action?.startsWith('teams.')?teams(e):e.action?.startsWith('settings.')?settings(e):PUBLIC_ACTIONS.includes(e.action)?f.content(e):auth(e),[adminBase,userBase],[...PUBLIC_ACTIONS,...SETTINGS_ACTIONS])
const cert=await fs.mkdtemp('/tmp/community-football-team-maintenance-')
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',`${cert}/key.pem`,'-out',`${cert}/cert.pem`,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'})
const server=createServer({key:await fs.readFile(`${cert}/key.pem`),cert:await fs.readFile(`${cert}/cert.pem`)},async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk
 let event;try{event=JSON.parse(body)}catch{}
 const mutation=event?.action?.startsWith('teams.')&&!['teams.listAdmin','teams.getAdmin','teams.leadersAdmin','teams.checkDissolutionAdmin'].includes(event.action)
 if(mutation)mutations.push(structuredClone(event))
 const r=await http({httpMethod:req.method,headers:req.headers,body})
 if(mutation&&loseMutation&&r.statusCode===200){loseMutation=false;res.writeHead(200,r.headers);res.end('{"ok":');return}
 res.writeHead(r.statusCode,r.headers);res.end(r.body)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const endpoint=`https://127.0.0.1:${server.address().port}/api`,config=resolve('.tools/team-maintenance.vite.config.ts')
process.env.VITE_ADMIN_API_URL=endpoint
const adminVite=await createViteServer({configFile:'admin/vite.config.ts',mode:'test',cacheDir:resolve('.tools/team-maintenance-admin-cache'),server:{host:'127.0.0.1',port:5215,strictPort:true,hmr:false}})
await adminVite.listen()
// Both previews use only loopback handlers and isolated records. No customer
// URL or identity is used, including the frontend's fallback transport.
await fs.writeFile(config,`import base from '../vite.config';export default env=>{const c=base(env);return{...c,define:{...c.define,'import.meta.env.VITE_COMPETITION_API_URL':${JSON.stringify(JSON.stringify(endpoint))},'import.meta.env.VITE_PUBLIC_FALLBACK_API_URL':${JSON.stringify(JSON.stringify(endpoint))}},cacheDir:'.tools/team-maintenance-user-cache',server:{host:'127.0.0.1',port:5216,strictPort:true,hmr:false}}}\n`)
const preview=spawn('node',['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js','--config',config,'--host','127.0.0.1','--port','5216'],{detached:true,env:{...process.env,CHOKIDAR_USEPOLLING:'true'},stdio:['ignore','pipe','pipe']})
let log='',browser,context,admin,user
for(const stream of [preview.stdout,preview.stderr])stream.on('data',chunk=>{log+=chunk})
const check=name=>{checks.push(name);console.log('PASS '+name)}
const currentTeam=()=>f.read('teams',f.id)
const form=()=>admin.locator('.team-maintenance-form')
const click=name=>admin.getByRole('button',{name,exact:true}).click()
const saved=()=>admin.locator('.team-saved-notice').waitFor()
const noOverflow=async page=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
const shot=async(name)=>admin.screenshot({path:`${out}/${name}.png`,fullPage:true,animations:'disabled'})
async function addPlayer(name,number){await click('添加球员');await admin.getByLabel('球员姓名',{exact:true}).fill(name);await admin.getByLabel('球衣号码',{exact:true}).fill(number);await admin.getByLabel('场上位置',{exact:true}).selectOption('forward');await click('保存球员');await saved()}
let navigation=0
async function publicTeam(){await user.goto(`${userBase}/?case=${++navigation}#/pages/team/detail?id=${f.id}`);await user.locator('.public-team-profile .page-title').waitFor();await user.locator('.record-metric-value').first().waitFor()}
try{
 const deadline=Date.now()+30000
 for(;;){if(preview.exitCode!==null)throw new Error(log.slice(-3000));try{if((await fetch(userBase,{signal:AbortSignal.timeout(1000)})).ok)break}catch{}if(Date.now()>deadline)throw new Error('Preview timeout: '+log.slice(-3000));await new Promise(r=>setTimeout(r,250))}
 browser=await chromium.launch({channel:'chrome',headless:true})
 context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai',ignoreHTTPSErrors:true})
 context.setDefaultTimeout(15000)
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.protocol.startsWith('http')&&!['127.0.0.1','localhost'].includes(url.hostname)){unexpected.push(url.origin);return route.abort()}return route.continue()})
 admin=await context.newPage();user=await context.newPage()
 for(const page of [admin,user])page.on('pageerror',error=>errors.push(error.message))
 await admin.goto(adminBase);await admin.getByLabel('管理员账号',{exact:true}).fill('admin');await admin.getByLabel('登录密码',{exact:true}).fill(password);await click('登录管理后台');await admin.locator('.workspace').waitFor();await click('球队档案')
 await admin.locator(`[data-team-id="${f.id}"]`).getByRole('button').click();await admin.locator('.admin-team-detail').waitFor()
 await click('编辑球队资料');const initialMutationCount=mutations.length
 await admin.getByLabel('球队名称',{exact:true}).fill('');await click('保存球队资料');await form().getByRole('alert').filter({hasText:'请填写队名'}).waitFor();assert.equal(mutations.length,initialMutationCount)
 await admin.getByLabel('球队名称',{exact:true}).fill('【验收】后台维护联动队');await admin.getByLabel('领队联系电话',{exact:true}).fill('021-12345678');await click('保存球队资料');await saved()
 assert.equal((await f.owner()({action:'mine'})).team.name,'【验收】后台维护联动队')
 await publicTeam();await user.locator('.public-team-profile .page-title').getByText('【验收】后台维护联动队',{exact:true}).waitFor()
 check('管理员资料维护校验必填项，并同步真实领队处理器和公开Vue档案')
 await click('添加球员');await click('保存球员');await form().getByRole('alert').filter({hasText:'请填写球员姓名'}).waitFor()
 await admin.getByLabel('球员姓名',{exact:true}).fill('【验收】后台新增球员');await admin.getByLabel('球衣号码',{exact:true}).fill('7');await admin.getByLabel('场上位置',{exact:true}).selectOption('forward');const beforeDuplicate=mutations.length
 await click('保存球员');await form().getByRole('alert').filter({hasText:'该球衣号码已被'}).waitFor();assert.equal(mutations.length,beforeDuplicate)
 await admin.getByLabel('球衣号码',{exact:true}).fill('9');await click('保存球员');await saved()
 const added=currentTeam().roster.find(p=>p.name==='【验收】后台新增球员');assert.ok(added)
 await publicTeam();await user.getByText(added.name,{exact:true}).waitFor();await shot('roster-desktop')
 check('后台添加球员有就近错误提示和同队重号校验，客户端名单同步')
 await admin.getByRole('button',{name:'编辑球员 '+added.name,exact:true}).click();await admin.getByLabel('球员姓名',{exact:true}).fill('【验收】管理员更名球员');await admin.getByLabel('球衣号码',{exact:true}).fill('10')
 loseMutation=true;await click('保存球员');await form().getByRole('status').filter({hasText:'提交结果尚未确认'}).waitFor()
 const lostVersion=currentTeam().version,lostHistory=currentTeam().adminHistory.length
 assert.equal(await admin.getByLabel('球员姓名',{exact:true}).isDisabled(),true)
 await click('重试本次提交');await saved();assert.equal(currentTeam().version,lostVersion);assert.equal(currentTeam().adminHistory.length,lostHistory);assert.deepEqual(mutations.at(-1),mutations.at(-2))
 check('真实保存后损坏回执，表单锁定并重试原请求，版本和维护记录只增加一次')
 await admin.getByRole('button',{name:'编辑球员 【验收】管理员更名球员',exact:true}).click();await admin.getByLabel('球衣号码',{exact:true}).fill('12')
 const beforeLeader=currentTeam();assert.equal((await f.owner()({action:'update',expectedVersion:beforeLeader.version,form:{name:beforeLeader.name,district:beforeLeader.district,contactPhone:beforeLeader.contactPhone,description:'领队并发修改'}})).ok,true)
 await click('保存球员');await form().getByRole('alert').filter({hasText:'球队已在其他页面更新'}).waitFor();assert.equal(await admin.getByRole('button',{name:'保存球员',exact:true}).isDisabled(),true)
 await click('重新读取球队');await admin.getByText('领队并发修改',{exact:true}).waitFor();assert.equal(currentTeam().roster.find(p=>p.id===added.id).number,10)
 check('领队并发修改使后台旧表单409，重读前不能覆盖新版本')
 const original=currentTeam().roster.find(p=>p.id===f.pid(1)),historical=await f.contentStore.scan('matches'),registrationFacts=await f.contentStore.scan('registrations')
 await admin.getByRole('button',{name:'移出球员 '+original.name,exact:true}).click();await click('取消');assert.equal(f.read('players',original.id).status,'active')
 await admin.getByRole('button',{name:'移出球员 '+original.name,exact:true}).click()
 for(const width of [390,320]){await admin.setViewportSize({width,height:844});await noOverflow(admin);await shot(`remove-confirm-${width}`)}
 await click('确认移出');await saved();assert.equal(f.read('players',original.id).status,'removed');assert.deepEqual(await f.contentStore.scan('matches'),historical);assert.deepEqual(await f.contentStore.scan('registrations'),registrationFacts)
 await publicTeam();assert.deepEqual(await user.locator('.record-metric-value').allTextContents(),['3','2','1','0','4','2','2']);assert.equal(await user.getByText(original.name,{exact:true}).count(),0)
 check('移出可取消，确认后保留球员档案及完整历史赛果，球队统计不变')
 await admin.setViewportSize({width:1440,height:1000});await click('解散球队');await form().getByRole('alert').filter({hasText:'球队已有关联报名'}).waitFor();assert.equal(await admin.getByRole('button',{name:'确认解散',exact:true}).isDisabled(),true);await click('重新读取球队')
 await click('更换领队');await admin.getByLabel('新领队',{exact:true}).selectOption(f.users[1]._id);await admin.getByLabel('输入完整球队名称确认',{exact:true}).fill(currentTeam().name);await click('确认更换领队');await form().getByRole('alert').filter({hasText:'球队已有关联报名'}).waitFor();await click('取消')
 assert.equal(currentTeam().leaderUserId,f.users[0]._id)
 check('已关联报名和赛程的球队禁止解散及换领队，原归属与数据保持不变')
 await click('← 返回球队列表');await click('新建球队');await admin.getByLabel('球队领队',{exact:true}).selectOption(f.users[1]._id)
 assert.equal(await admin.locator(`#admin-team-leader option[value="${f.users[0]._id}"]`).isDisabled(),true)
 await admin.getByLabel('球队名称',{exact:true}).fill('【验收】后台代建新球队');await admin.getByLabel('所属区',{exact:true}).selectOption('徐汇区');await admin.getByLabel('领队联系电话',{exact:true}).fill('13800000001')
 for(const width of [390,320]){await admin.setViewportSize({width,height:844});await noOverflow(admin);await shot(`create-${width}`)}
 await click('创建球队');await saved()
 const created=(await f.owner(1)({action:'mine'})).team;assert.ok(created);assert.equal(created.name,'【验收】后台代建新球队')
 check('选择已登录且无球队的微信领队代建，已有球队用户不可选，390/320px表单无溢出')
 await addPlayer('【验收】归档球员','15');await noOverflow(admin);await shot('editable-roster-320')
 await admin.setViewportSize({width:1440,height:1000});await click('更换领队');await admin.getByLabel('新领队',{exact:true}).selectOption(f.users[2]._id);await admin.getByLabel('输入完整球队名称确认',{exact:true}).fill('错误名称');await click('确认更换领队');await form().getByRole('alert').filter({hasText:'请输入完整且一致'}).waitFor()
 await admin.getByLabel('输入完整球队名称确认',{exact:true}).fill(created.name);await click('确认更换领队');await saved();await admin.locator('.admin-team-info').getByText(f.users[2].nickname,{exact:true}).waitFor()
 assert.equal((await f.owner(1)({action:'mine'})).team,null);assert.equal((await f.owner(2)({action:'mine'})).team.id,created.id)
 check('无业务关联球队换领队需核对队名，保存后原领队释放名额、新领队接管当前名单')
 await click('解散球队');await form().getByLabel('输入完整球队名称确认',{exact:true}).waitFor();await click('取消');assert.equal(f.read('teams',created.id).status,'active')
 await click('解散球队');await admin.getByLabel('输入完整球队名称确认',{exact:true}).fill('错误队名');await click('确认解散');await form().getByRole('alert').filter({hasText:'请输入完整且一致'}).waitFor();await admin.getByLabel('输入完整球队名称确认',{exact:true}).fill(created.name);await click('确认解散');await saved()
 await admin.getByText('已解散',{exact:true}).waitFor();assert.equal(await admin.getByRole('button',{name:'编辑球队资料',exact:true}).count(),0);assert.equal(await admin.getByRole('button',{name:'添加球员',exact:true}).count(),0);assert.equal(f.read('teams',created.id).roster.length,1);assert.equal((await f.owner(2)({action:'mine'})).team,null);await shot('archived-desktop')
 check('球队解散可取消且须精确队名，成功后保留只读名单并释放领队绑定')
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[])
 await fs.writeFile(`${out}/report.json`,JSON.stringify({checks,errors,unexpected,mutationCount:mutations.length,scope:'Actual admin/H5 Vue, HTTPS authorization and production handlers with isolated transactional records. No customer deployment, customer writes or physical device verification.',generatedAt:new Date().toISOString()},null,2))
 console.log(`Verified ${checks.length} team maintenance browser flows.`)
}catch(error){if(admin){await shot('failure-admin').catch(()=>{});await fs.writeFile(`${out}/failure.txt`,JSON.stringify({errors,unexpected},null,2)+'\n'+await admin.locator('body').innerText()).catch(()=>{})}throw error}
finally{await browser?.close();await adminVite.close();try{process.kill(-preview.pid,'SIGTERM')}catch{}server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(config,{force:true});await fs.rm(cert,{recursive:true,force:true})}
