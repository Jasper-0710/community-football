import fs from 'node:fs'
const copies=[['cloudfunctions/adminAuth/recovery-guard.js','cloudfunctions/teamManagement/recovery-guard.js'],['cloudfunctions/adminAuth/recovery-guard.js','cloudfunctions/userProfile/recovery-guard.js'],['cloudfunctions/adminAuth/public-cache.js','cloudfunctions/publicRead/public-cache.js'],['cloudfunctions/adminAuth/http.js','cloudfunctions/publicRead/http.js']]
for(const[from,to]of copies){const source=fs.readFileSync(from,'utf8');if(process.argv.includes('--check')){if(!fs.existsSync(to)||fs.readFileSync(to,'utf8')!==source)throw new Error(`${to}需要同步，运行node scripts/sync-recovery-model.mjs`)}else fs.writeFileSync(to,source)}
console.log(`D13共享部署文件${process.argv.includes('--check')?'检查通过':'已同步'}：${copies.length}份`)
