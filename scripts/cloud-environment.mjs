import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

export const projectRoot = fileURLToPath(new URL('../', import.meta.url))
export const cloudEnvironment = JSON.parse(fs.readFileSync(new URL('../config/cloud-environment.json', import.meta.url), 'utf8'))

export function validateCloudEnvironment(values, target = cloudEnvironment) {
  const envId = values.VITE_WECHAT_CLOUD_ENV_ID?.trim() || target.envId
  if (envId !== target.envId) throw new Error(`云环境不一致：必须使用客户环境 ${target.envId}，请修改或移除本机 VITE_WECHAT_CLOUD_ENV_ID。`)
  const adminApiUrl = values.VITE_ADMIN_API_URL?.trim() || target.adminApiUrl
  const competitionApiUrl = values.VITE_COMPETITION_API_URL?.trim() || adminApiUrl
  for (const [label, endpoint] of [['管理后台', adminApiUrl], ['H5赛事', competitionApiUrl]]) {
    if (!endpoint) continue
    let url
    try { url = new URL(endpoint) } catch { throw new Error(`${label}接口地址不是有效URL。`) }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (!(url.protocol === 'https:' || url.protocol === 'http:' && loopback) || url.username || url.password || url.search || url.hash) throw new Error(`${label}接口须使用HTTPS地址，且不能包含凭据、参数或片段。`)
    // CloudBase default domains include the environment ID. Reject another environment
    // before any browser session, password or business data can be sent there.
    if (url.hostname.endsWith('.app.tcloudbase.com') && !url.hostname.startsWith(`${target.envId}-`)) throw new Error(`${label}接口属于其他云环境，必须改为客户环境 ${target.envId} 的HTTP访问地址。`)
    if (target.adminApiUrl && !loopback && endpoint !== target.adminApiUrl) throw new Error(`${label}接口与 config/cloud-environment.json 中确认的客户地址不一致。`)
    if (!target.adminApiUrl && !loopback && !(url.hostname.endsWith('.app.tcloudbase.com') && url.hostname.startsWith(`${target.envId}-`))) throw new Error(`${label}接口尚未确认为客户环境地址，请先运行 cloud:setup 配置客户HTTP网关。`)
  }
  const manifest = JSON.parse(fs.readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8'))
  if (manifest['mp-weixin']?.appid !== target.appid) throw new Error(`小程序AppID必须为 ${target.appid}。`)
  return { ...target, envId, adminApiUrl, competitionApiUrl }
}

export function loadCloudEnvironment(mode = 'development') {
  return validateCloudEnvironment(loadEnv(mode, projectRoot, 'VITE_'))
}

export function cloudBuildDefines(mode) {
  const target = loadCloudEnvironment(mode)
  return {
    'import.meta.env.VITE_WECHAT_CLOUD_ENV_ID': JSON.stringify(target.envId),
    'import.meta.env.VITE_ADMIN_API_URL': JSON.stringify(target.adminApiUrl),
    'import.meta.env.VITE_COMPETITION_API_URL': JSON.stringify(target.competitionApiUrl),
    'import.meta.env.VITE_CLOUD_ENVIRONMENT_NAME': JSON.stringify(target.name),
  }
}

export function requireCloudAdminEndpoint() {
  const target = loadCloudEnvironment('admin')
  if (!target.adminApiUrl) throw new Error(`客户环境 ${target.envId} 的后台HTTP访问服务尚未配置。运行 npm run cloud:setup -- --admin-url <客户环境HTTPS地址>。`)
  return target
}
