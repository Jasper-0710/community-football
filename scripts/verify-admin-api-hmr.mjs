import {createRequire} from 'node:module'
import {randomBytes} from 'node:crypto'
import {createServer} from 'node:http'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
import {createServer as createViteServer} from 'vite'
import {chromium} from 'playwright'

// Isolated regression for an already-authenticated page whose retained API
// predates cleanupTeamBadges. No customer requests or filesystem edits.
const require=createRequire(import.meta.url)
const {createAdminService,createAccount}=require('../cloudfunctions/adminAuth/service.js')
const {createAdminTeamService}=require('../cloudfunctions/adminAuth/teams.js')
const {createTeamBadgeCleanup}=require('../cloudfunctions/adminAuth/team-badge-cleanup.js')
const {createHttpHandler}=require('../cloudfunctions/adminAuth/http.js')
const {createMemoryStore}=require('../tests/helpers/admin-store.cjs')
const out='artifacts/admin-hmr',base='http://127.0.0.1:5190'
await mkdir(out,{recursive:true})
const password=randomBytes(24).toString('base64url')
const auth=createAdminService({store:createMemoryStore(await createAccount('admin',password,Date.now())).store,logger:{error(){}}})
const authorize=token=>auth({action:'session',token})
const teams=createAdminTeamService({store:{list:async()=>[]},authorize})
const cleanup=createTeamBadgeCleanup({store:{listBadges:async()=>[]},storage:{},authorize})
let cleanupCalls=0,legacy=true
const http=createHttpHandler(event=>{
  if(event.action==='teams.badges.cleanup'){cleanupCalls++;return cleanup(event)}
  return event.action?.startsWith('teams.')?teams(event):auth(event)
},[base])
const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk
  const result=await http({httpMethod:req.method,headers:req.headers,body})
  res.writeHead(result.statusCode,result.headers);res.end(result.body)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
process.env.VITE_ADMIN_API_URL=`http://127.0.0.1:${server.address().port}/admin`
const vite=await createViteServer({configFile:'admin/vite.config.ts',mode:'test',cacheDir:resolve('.tools/admin-hmr-cache'),plugins:[{
  name:'isolated-legacy-api',enforce:'pre',transform(code,id){
    if(!legacy||!id.endsWith('/admin/src/api.ts'))return
    const old=code.replace(/^    async cleanupTeamBadges\([^\n]+\n/m,'')
    assert.notEqual(old,code,'fixture must remove only the legacy missing method')
    return old
  },
}],server:{host:'127.0.0.1',port:5190,strictPort:true,hmr:true}})
await vite.listen()
const browser=await chromium.launch({channel:'chrome',headless:true})
const context=await browser.newContext({locale:'zh-CN',viewport:{width:1280,height:960}})
const page=await context.newPage(),errors=[],checks=[]
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message))
const check=name=>{checks.push(name);console.log('PASS '+name)}
async function checkBadges(){
  await page.getByRole('button',{name:'球队档案',exact:true}).click()
  await page.getByText('暂时还没有球队',{exact:true}).waitFor()
  await page.getByText('队徽存储维护',{exact:true}).click()
  await page.getByRole('button',{name:'检查待清理队徽',exact:true}).click()
}
try{
  await page.goto(base,{waitUntil:'networkidle'})
  await page.getByLabel('管理员账号',{exact:true}).fill('admin');await page.getByLabel('登录密码',{exact:true}).fill(password)
  await page.getByRole('button',{name:'登录管理后台'}).click();await page.locator('.workspace').waitFor()
  const token=await page.evaluate(()=>sessionStorage.getItem('community-football.admin.session.v1'))
  await checkBadges()
  await page.getByRole('alert').filter({hasText:'api.cleanupTeamBadges is not a function'}).waitFor()
  assert.equal(cleanupCalls,0)
  check('reproduced a retained legacy API object missing the cleanup method before any server call')
  legacy=false
  const module=await vite.moduleGraph.getModuleByUrl('/src/api.ts')
  assert.ok(module);vite.moduleGraph.invalidateModule(module)
  const reload=page.waitForEvent('domcontentloaded')
  vite.ws.send({type:'update',updates:[{type:'js-update',path:'/src/api.ts',acceptedPath:'/src/api.ts',timestamp:Date.now()}]})
  await reload;await page.locator('.workspace').waitFor()
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('community-football.admin.session.v1')),token)
  check('API hot replacement reloads the page and revalidates the existing session with a current API instance')
  await checkBadges()
  await page.locator('.team-badge-maintenance').getByRole('status').filter({hasText:'本批检查0张队徽'}).waitFor()
  assert.equal(cleanupCalls,1);assert.equal(await page.getByRole('alert').count(),0);assert.deepEqual(errors,[])
  check('cleanup preview reaches the real authenticated cleanup handler after hot replacement')
  await writeFile(`${out}/report.json`,JSON.stringify({checks,errors,customerRequests:false,validation:'Real Vue/Vite HMR and real auth/cleanup handlers, isolated account and empty badge store.',generatedAt:new Date().toISOString()},null,2))
  console.log(`Verified ${checks.length} admin API hot-reload flows.`)
}catch(error){await page.screenshot({path:`${out}/failure.png`,fullPage:true}).catch(()=>{});throw error}
finally{await browser.close();await vite.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
