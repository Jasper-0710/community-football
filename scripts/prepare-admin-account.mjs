import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createAccount } = require('../cloudfunctions/adminAuth/service.js')

// Generates a private bootstrap file only. It never creates/overwrites a cloud account.
const username = process.argv[2] || 'admin'
const directory = path.resolve('.tools/admin-setup')
await fs.mkdir(directory, { recursive: true, mode: 0o700 })
const credentialsPath = path.join(directory, 'credentials.txt')
const accountPath = path.join(directory, 'account.json')
const password = randomBytes(24).toString('base64url')
const account = await createAccount(username, password)
// Refuse to replace the only copy of an existing password.
const handle = await fs.open(credentialsPath, 'wx', 0o600)
try {
  await fs.writeFile(accountPath, JSON.stringify(account, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  await handle.writeFile(`账号：${account.username}\n初始密码：${password}\n\n仅供本机管理员使用；此文件和账号初始化数据不提交Git。\n`)
} finally { await handle.close() }
console.log(`已生成本机账号文件：${credentialsPath}`)
console.log(`待初始化数据：${accountPath}`)
console.log('尚未写入云端。须先关闭adminAccounts客户端读写，再通过管理员控制台安全导入。')
