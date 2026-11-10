import {readFile,writeFile} from 'node:fs/promises'
for(const name of ['registration-model.js','registration-storage.js']) {
 const source=new URL(`../cloudfunctions/teamManagement/${name}`,import.meta.url)
 const target=new URL(`../cloudfunctions/adminAuth/${name}`,import.meta.url)
 const data=await readFile(source)
 if(process.argv.includes('--check')){if(!data.equals(await readFile(target)))throw new Error('Run node scripts/sync-registration-model.mjs before deploying either function')}
 else await writeFile(target,data)
}
