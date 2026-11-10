import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cloudEnvironment, loadCloudEnvironment } from './cloud-environment.mjs'

const mode = process.argv[2]
if (mode !== 'dev' && mode !== 'build') {
  throw new Error('Usage: node scripts/prepare-wechat-project.mjs <dev|build>')
}
const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(await fs.readFile(path.join(root, 'src/manifest.json'), 'utf8'))
const wechat = manifest['mp-weixin']
loadCloudEnvironment(mode === 'dev' ? 'development' : 'production')
if (wechat?.appid !== cloudEnvironment.appid) throw new Error(`请使用客户小程序AppID ${cloudEnvironment.appid}。`)
if (!wechat?.appid) throw new Error('请先配置 src/manifest.json 中的 mp-weixin.appid。')

// Keep cloud function sources outside the mini-program upload directory.
// Both dev and build commands regenerate this local file, so paths also work on other computers.
const config = {
  description: manifest.description,
  appid: wechat.appid,
  projectname: manifest.name,
  compileType: 'miniprogram',
  miniprogramRoot: `dist/${mode}/mp-weixin/`,
  cloudfunctionRoot: 'cloudfunctions/',
  setting: { postcss: false, ...wechat.setting },
  packOptions: { ignore: [] },
}
await fs.writeFile(path.join(root, 'project.config.json'), `${JSON.stringify(config, null, 2)}\n`)
console.log(`微信项目配置已生成：导入项目根目录，小程序目录为 ${config.miniprogramRoot}`)
