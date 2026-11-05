import {readFile,writeFile} from 'node:fs/promises'
const source=new URL('../cloudfunctions/teamManagement/registration-model.js',import.meta.url)
const target=new URL('../cloudfunctions/adminAuth/registration-model.js',import.meta.url)
const data=await readFile(source)
if(process.argv.includes('--check')){if(!data.equals(await readFile(target)))throw new Error('Run node scripts/sync-registration-model.mjs before deploying either function')}
else await writeFile(target,data)
