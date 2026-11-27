import {readFile,writeFile} from 'node:fs/promises'
for(const name of ['registration-model.js','registration-storage.js','registration-attachments.js','team-badge-model.js']) {
 const source=new URL(`../cloudfunctions/teamManagement/${name}`,import.meta.url)
 const target=new URL(`../cloudfunctions/adminAuth/${name}`,import.meta.url)
 const data=await readFile(source)
 if(process.argv.includes('--check')){if(!data.equals(await readFile(target)))throw new Error('Run node scripts/sync-registration-model.mjs before deploying either function')}
 else await writeFile(target,data)
}
const settingsSource=new URL('../src/domain/platform-settings-schema.json',import.meta.url)
const settingsTarget=new URL('../cloudfunctions/adminAuth/platform-settings-schema.json',import.meta.url)
const settingsData=await readFile(settingsSource)
if(process.argv.includes('--check')){if(!settingsData.equals(await readFile(settingsTarget)))throw new Error('Platform settings schema is out of sync; run node scripts/sync-registration-model.mjs')}
else await writeFile(settingsTarget,settingsData)
