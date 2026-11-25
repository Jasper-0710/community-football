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
const {PNG}=require('pngjs')
const {createAdminService,createAccount}=require('../cloudfunctions/adminAuth/service')
const {createHttpHandler}=require('../cloudfunctions/adminAuth/http')
const {createSettingsService,PUBLIC_ACTIONS}=require('../cloudfunctions/adminAuth/platform-settings')
const {createPlatformImageService}=require('../cloudfunctions/adminAuth/external-entries')
const {createContentService,PUBLIC_ACTIONS:CONTENT_PUBLIC}=require('../cloudfunctions/adminAuth/content')
const {createCompetitionService,PUBLIC_ACTIONS:COMPETITION_PUBLIC}=require('../cloudfunctions/adminAuth/competitions')
const {createMatchService,PUBLIC_ACTIONS:MATCH_PUBLIC}=require('../cloudfunctions/adminAuth/matches')
const {createStandingsService,PUBLIC_ACTIONS:STANDINGS_PUBLIC}=require('../cloudfunctions/adminAuth/standings')
const {createMemoryStore}=require('../tests/helpers/admin-store.cjs')
const {createContentMemoryStore}=require('../tests/helpers/content-store.cjs')
const {createNewsImageStorage}=require('../tests/helpers/news-image-storage.cjs')
const {createMatchMemoryStore}=require('../tests/helpers/match-store.cjs')
const out='artifacts/external-entries',adminOrigin='http://127.0.0.1:5214',publicOrigin='http://127.0.0.1:5213'
await fs.mkdir(out,{recursive:true});await fs.mkdir('.tools',{recursive:true})
const password=randomBytes(24).toString('base64url'),auth=createAdminService({store:createMemoryStore(await createAccount('admin',password,Date.now())).store,logger:{error(){}}}),authorize=token=>auth({action:'session',token})
const {store,collections}=createContentMemoryStore(),files=createNewsImageStorage(),options={store,storage:files.storage,authorize,logger:{error(){}}}
const settings=createSettingsService(options),images=createPlatformImageService({...options,enabled:true}),content=createContentService(options)
const matchesMemory=createMatchMemoryStore({competitions:collections.competitions,teams:collections.teams,registrations:collections.registrations,records:collections.matches})
const competitions=createCompetitionService({store:{read:id=>store.read('competitions',id),async list(){return [...collections.competitions.values()]}},authorize,logger:{error(){}}}),matches=createMatchService({store:matchesMemory.store,authorize,logger:{error(){}}}),standings=createStandingsService({store:matchesMemory.standingsStore,authorize,logger:{error(){}}})
let failPublic=false,loseAck=false,failChunk=false,failImage=false,uploadEnabled=true
const requests=[]
async function router(event){
 requests.push({action:event.action,requestId:event.requestId})
 if(event.action==='settings.getPublic'&&failPublic)return {ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'入口同步暂不可用。'}}
 if(event.action==='settings.images.config'&&!uploadEnabled)return {...await images(event),enabled:false}
 if(event.action==='settings.images.chunk'&&failChunk){failChunk=false;return {ok:false,error:{code:'SERVICE_UNAVAILABLE',message:'模拟分片中断，请重试。'}}}
 return event.action.startsWith('settings.images.')?images(event):event.action.startsWith('settings.')?settings(event):/^(news|search|directory|content)\./.test(event.action)?content(event):event.action.startsWith('competitions.')?competitions(event):event.action.startsWith('matches.')?matches(event):event.action.startsWith('standings.')?standings(event):auth(event)
}
const certDir=await fs.mkdtemp('/tmp/community-football-external-')
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',`${certDir}/key.pem`,'-out',`${certDir}/cert.pem`,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'})
const http=createHttpHandler(router,[adminOrigin,publicOrigin],[...PUBLIC_ACTIONS,...CONTENT_PUBLIC,...COMPETITION_PUBLIC,...MATCH_PUBLIC,...STANDINGS_PUBLIC])
const server=createServer({key:await fs.readFile(`${certDir}/key.pem`),cert:await fs.readFile(`${certDir}/cert.pem`)},async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const r=await http({httpMethod:req.method,headers:req.headers,body});res.writeHead(r.statusCode,r.headers);if(loseAck&&body.includes('"action":"settings.update"')){loseAck=false;res.end('{"ok":');return}res.end(r.body)})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const endpoint=`https://127.0.0.1:${server.address().port}/api`
process.env.VITE_ADMIN_API_URL=endpoint
const config=resolve('.tools/f-public.vite.config.ts')
await fs.writeFile(config,"import base from '../vite.config';export default env=>({...base(env),define:{...base(env).define,'import.meta.env.VITE_PUBLIC_FALLBACK_API_URL':'\"\"','import.meta.env.VITE_PUBLIC_FALLBACK_FUNCTION':'\"\"'},cacheDir:'.tools/f-public-cache',server:{host:'127.0.0.1',port:5213,strictPort:true,hmr:false}})\n")
const adminVite=await createViteServer({configFile:'admin/vite.config.ts',mode:'test',cacheDir:resolve('.tools/f-admin-cache'),server:{host:'127.0.0.1',port:5214,strictPort:true,hmr:false}});await adminVite.listen()
const publicServer=spawn('node',['node_modules/@dcloudio/vite-plugin-uni/bin/uni.js','--config',config,'--host','127.0.0.1','--port','5213'],{detached:true,env:{...process.env,CHOKIDAR_USEPOLLING:'true',VITE_COMPETITION_API_URL:endpoint},stdio:['ignore','pipe','pipe']})
let publicLog='';for(const stream of [publicServer.stdout,publicServer.stderr])stream.on('data',b=>publicLog+=b)
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai',ignoreHTTPSErrors:true})
context.setDefaultTimeout(15000)
await context.route('https://images.example.test/**',async route=>{if(failImage)return route.fulfill({status:503,body:'temporarily unavailable'});const id=new URL(route.request().url()).searchParams.get('id'),bytes=files.objects.get(id);return route.fulfill({status:bytes?200:404,contentType:'image/png',body:bytes||Buffer.from('missing')})})
await context.route('https://example.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>隔离外部服务测试页面</h1>'}))
const admin=await context.newPage(),user=await context.newPage(),checks=[],errors=[]
for(const p of [admin,user])p.on('pageerror',e=>errors.push(e.message))
const check=name=>{checks.push(name);console.log(`PASS ${name}`)},editor=()=>admin.locator('.external-entries-editor'),version=()=>collections.platformSettings.get('primary')?.version||0
const saveButton=()=>admin.getByRole('button',{name:'保存平台设置',exact:true})
const save=async()=>{await saveButton().click();await admin.getByText('平台设置已保存。客户端重新进入页面或回到前台时同步。',{exact:true}).waitFor()}
const sync=async()=>{await user.reload();await user.waitForFunction(v=>Number(document.querySelector('.app-shell')?.getAttribute('data-settings-version'))===v,version())}
async function layout(page,width,name){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${name} ${width}px overflow`);await page.screenshot({path:`${out}/${name}-${width}.png`,fullPage:true})}
function png(color=50){const width=480,height=300,data=Buffer.alloc(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;data[i]=color+x%100;data[i+1]=90+y%100;data[i+2]=70;data[i+3]=255}return PNG.sync.write({width,height,data})}
const uploadFile=async(color=50)=>{await editor().getByLabel('选择投保图片',{exact:true}).setInputFiles({name:'保障介绍.png',mimeType:'image/png',buffer:png(color)})}
const watchdog=setTimeout(()=>{console.error('F browser watchdog');process.exit(1)},180000)
try{
 for(let i=0;i<120;i++){try{if((await fetch(publicOrigin)).ok)break}catch{}if(i===119)throw new Error(publicLog);await new Promise(r=>setTimeout(r,250))}
 for(const action of ['settings.update','settings.images.config','settings.images.start','settings.images.chunk','settings.images.finish','settings.images.get','settings.images.cleanup'])assert.equal((await context.request.post(endpoint,{data:{action}})).status(),401)
 await admin.goto(adminOrigin);await admin.getByLabel('管理员账号',{exact:true}).fill('admin');await admin.getByLabel('登录密码',{exact:true}).fill(password);await admin.getByRole('button',{name:'登录管理后台',exact:true}).click();await admin.locator('.workspace').waitFor();await admin.getByRole('button',{name:'平台设置',exact:true}).click();await admin.getByLabel('启用社区入口',{exact:true}).waitFor();await admin.waitForFunction(()=>!document.querySelector('.platform-settings-form fieldset').disabled)
 await user.goto(publicOrigin);await user.locator('.hero').waitFor();assert.equal(await user.locator('.external-home-section').count(),0)
 check('新后台入口可达，默认关闭隐藏，七个管理动作匿名HTTP均401')
 await admin.getByLabel('启用社区入口',{exact:true}).check();await saveButton().click();await admin.getByRole('alert').filter({hasText:'跳转目标'}).waitFor();assert.equal(version(),0)
 await admin.getByLabel('社区小程序 AppID',{exact:true}).fill('wx0123456789abcdef');await admin.getByLabel('社区页面路径',{exact:true}).fill('pages/index/index?from=football');await admin.getByLabel('启用投保专栏',{exact:true}).check();await saveButton().click();assert.equal(version(),0)
 await admin.getByLabel('启用投保专栏',{exact:true}).uncheck();await save();await sync();await user.getByRole('button',{name:'进入社区',exact:true}).click();await user.getByText('请在微信小程序中打开社区入口。',{exact:true}).waitFor()
 check('未配置社区和无图投保启用被阻止，H5小程序目标显示明确提示')
 await editor().getByLabel('选择投保图片',{exact:true}).setInputFiles({name:'伪图片.png',mimeType:'image/png',buffer:Buffer.from('not an image')});await editor().getByRole('alert').filter({hasText:'格式不符'}).waitFor();assert.equal(collections.platformImages.size,0)
 failChunk=true;await uploadFile();await editor().getByRole('alert').filter({hasText:'模拟分片中断'}).waitFor();const startId=requests.filter(r=>r.action==='settings.images.start').at(-1).requestId
 await editor().getByRole('button',{name:'重试上传投保图片',exact:true}).click();await editor().getByText('图片已上传，保存平台设置后客户端生效。',{exact:true}).waitFor();assert.equal(requests.filter(r=>r.action==='settings.images.start').at(-1).requestId,startId)
 assert.equal(collections.platformSettings.get('primary').form.external.insurance.images.length,0)
 check('假图片被拒绝，真实PNG分片中断原请求重试，上传未保存不影响客户端')
 await admin.getByLabel('启用投保专栏',{exact:true}).check();await admin.getByLabel('投保图片说明 1',{exact:true}).fill('测试保障介绍，非实际保险产品');await admin.getByLabel('投保目标类型',{exact:true}).selectOption('https');await admin.getByLabel('投保网页地址',{exact:true}).fill('https://example.com/insurance/#/intro');await save();await sync()
 await user.getByRole('button',{name:'查看保障介绍',exact:true}).click();await user.locator('.insurance-page .insurance-image').waitFor();await user.getByText('测试保障介绍，非实际保险产品',{exact:true}).waitFor();assert.equal(collections.platformImages.values().next().value.referenced,true)
 await user.getByRole('button',{name:'查看投保入口',exact:true}).click();await user.getByText('留在这里',{exact:true}).click();await user.getByText('已取消打开，仍停留在保障介绍。',{exact:true}).waitFor();assert.ok(user.url().includes('/pages/insurance/index'))
 check('后台保存后首页与投保详情同步，图片引用受保护，取消外跳保留原页面')
 for(const width of [1440,390,320])await layout(user,width,'insurance')
 await user.getByRole('button',{name:'查看投保入口',exact:true}).click();await user.getByText('继续打开',{exact:true}).click();await user.getByRole('heading',{name:'隔离外部服务测试页面'}).waitFor();await user.goBack();await user.locator('.insurance-page').waitFor()
 check('HTTPS确认后到达隔离目标并可返回，投保页1440/390/320px无横向溢出')
 failImage=true;await user.reload();await user.getByText('部分介绍图片暂时无法加载，链接可能已过期。',{exact:true}).waitFor();failImage=false;await user.getByRole('button',{name:'重新加载投保图片',exact:true}).click();await user.locator('.insurance-image').waitFor();await user.waitForFunction(()=>!document.querySelector('.insurance-image-missing'));check('真实图片加载失败可重新签名读取恢复')
 await user.locator('.insurance-image').click();await user.locator('#u-a-p > div').waitFor();await user.keyboard.press('Escape');await user.locator('#u-a-p > div').waitFor({state:'hidden'});await user.goto(publicOrigin)
 check('投保图片可打开原图预览')
 const original=collections.platformSettings.get('primary').form.external.insurance.images[0].imageId
 const chooser=admin.waitForEvent('filechooser');await editor().getByRole('button',{name:'替换投保图片 1',exact:true}).click();await (await chooser).setFiles({name:'替换图.png',mimeType:'image/png',buffer:png(150)});await editor().getByText('图片已上传，保存平台设置后客户端生效。',{exact:true}).waitFor();assert.equal(collections.platformSettings.get('primary').form.external.insurance.images[0].imageId,original)
 await save();const replacement=collections.platformSettings.get('primary').form.external.insurance.images[0].imageId;assert.notEqual(original,replacement);assert.equal(collections.platformImages.get(original).referenced,false);assert.ok(collections.platformImages.get(original).expiresAt>Date.now())
 await editor().locator('summary').click();await editor().getByRole('button',{name:'检查待清理投保图片',exact:true}).click();await editor().getByRole('status').filter({hasText:'扫描'}).waitFor();assert.equal(collections.platformImages.get(replacement).referenced,true)
 check('替换仅保存后切换引用，旧图进入24小时保留期，维护检查保护现图')
 loseAck=true;const before=version();await admin.getByLabel('投保专栏标题',{exact:true}).fill('社区运动保障');await saveButton().click();await admin.locator('.platform-settings-admin > [role="alert"]').waitFor();assert.equal(version(),before+1);const lostId=requests.filter(r=>r.action==='settings.update').at(-1).requestId;await save();assert.equal(version(),before+1);assert.equal(requests.filter(r=>r.action==='settings.update').at(-1).requestId,lostId)
 check('保存成功后损坏响应，原请求重试只增加一次设置版本')
 await sync();failPublic=true;await user.reload();await user.locator('.recovery-notice-title').getByText('正在显示本机公开快照',{exact:true}).waitFor();assert.equal(await user.getByRole('button',{name:'进入社区',exact:true}).isDisabled(),true);assert.equal(await user.getByRole('button',{name:'查看保障介绍',exact:true}).isDisabled(),true);failPublic=false;await user.getByRole('button',{name:'重新连接',exact:true}).click();await user.locator('.recovery-notice').waitFor({state:'hidden'});assert.equal(await user.getByRole('button',{name:'进入社区',exact:true}).isEnabled(),true)
 check('故障快照禁用外跳，恢复连接后实时同步重新开放入口')
 const token=await admin.evaluate(()=>sessionStorage.getItem('community-football.admin.session.v1')),current=collections.platformSettings.get('primary')
 const concurrent=await settings({action:'settings.update',token,expectedVersion:current.version,requestId:randomBytes(16).toString('hex'),form:{...structuredClone(current.form),title:'并发设置'}});assert.equal(concurrent.ok,true)
 await admin.getByLabel('投保专栏标题',{exact:true}).fill('过期编辑');await saveButton().click();await admin.getByText('设置已有新版本，请重新读取后修改。',{exact:true}).waitFor();assert.equal(await saveButton().isDisabled(),true);await admin.getByRole('button',{name:'重新读取设置',exact:true}).click();await admin.waitForFunction(()=>!document.querySelector('.platform-settings-form fieldset').disabled)
 check('并发版本冲突阻止覆盖外部配置并要求重新读取')
 for(const width of [1440,390,320]){await layout(admin,width,'admin');await layout(user,width,'home')}
 await admin.getByLabel('启用社区入口',{exact:true}).uncheck();await admin.getByLabel('启用投保专栏',{exact:true}).uncheck();await save();await sync();assert.equal(await user.locator('.external-home-section').count(),0)
 await user.goto(`${publicOrigin}/#/pages/insurance/index`);await user.getByText('保障介绍暂未开放',{exact:true}).waitFor();assert.equal(await user.locator('.insurance-image').count(),0)
 check('两端桌面/390/320px无溢出，关闭后首页隐藏且直接访问专栏显示未开放')
 assert.deepEqual(errors,[])
 await fs.writeFile(`${out}/report.json`,JSON.stringify({date:'2026-11-25',generatedAt:new Date().toISOString(),checks,errors,scope:'Real Vue admin/H5 and HTTPS handlers with isolated transactional stores and byte storage. External HTTPS destination intercepted only in this test context. No customer cloud writes, real mini-program jumps or physical-device acceptance.'},null,2))
 console.log(`Verified ${checks.length} F browser flows.`)
}catch(e){console.error(e.stack||String(e));await fs.writeFile(`${out}/failure.txt`,`ADMIN\n${await admin.locator('body').innerText().catch(()=>'')}\nCLIENT\n${await user.locator('body').innerText().catch(()=>'')}\nERRORS\n${JSON.stringify(errors)}\nLOG\n${publicLog}`);await user.screenshot({path:`${out}/failure.png`,fullPage:true}).catch(()=>{});throw e}
finally{clearTimeout(watchdog);await browser.close();await adminVite.close();try{process.kill(-publicServer.pid,'SIGTERM')}catch{}server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(certDir,{recursive:true,force:true})}
