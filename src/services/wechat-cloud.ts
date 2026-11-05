// Identity is attached by WeChat to cloud calls, never supplied by the client.
interface WechatCloud {
  init(options: { env: string }): void
  callFunction(options: { name: string; data: Record<string, unknown> }): Promise<{ result?: unknown }>
}
declare const wx: { cloud?: WechatCloud }

export class WechatCloudError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'WechatCloudError'
  }
}

let initializedEnv = ''

function requireWechatCloud(): WechatCloud {
  // #ifdef MP-WEIXIN
  const envId = import.meta.env.VITE_WECHAT_CLOUD_ENV_ID?.trim()
  if (!envId) throw new WechatCloudError('NOT_CONFIGURED', '登录服务尚未配置，请稍后再试。')
  if (typeof wx === 'undefined' || typeof wx.cloud?.init !== 'function' || typeof wx.cloud.callFunction !== 'function') {
    throw new WechatCloudError('UNSUPPORTED', '当前微信版本不支持登录服务，请更新微信后重试。')
  }
  if (initializedEnv !== envId) {
    try {
      wx.cloud.init({ env: envId })
      initializedEnv = envId
    } catch {
      throw new WechatCloudError('INIT_FAILED', '登录服务初始化失败，请重新进入小程序。')
    }
  }
  return wx.cloud
  // #endif
  // #ifndef MP-WEIXIN
  throw new WechatCloudError('UNSUPPORTED', '请在微信小程序中登录。')
  // #endif
}

export function initializeWechatCloud(): void {
  // #ifdef MP-WEIXIN
  // Missing configuration still permits browsing the existing demonstration pages.
  if (!import.meta.env.VITE_WECHAT_CLOUD_ENV_ID?.trim()) return
  try { requireWechatCloud() } catch (error) {
    console.error(error instanceof Error ? error.message : '云开发初始化失败。')
  }
  // #endif
}

export async function callWechatCloudFunction<T>(name: string, data: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
  const cloud = requireWechatCloud()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new WechatCloudError('TIMEOUT', '请求超时。若正在保存，请重新登录读取资料，确认保存结果后再重试。')), timeoutMs)
    Promise.resolve()
      .then(() => cloud.callFunction({ name, data }))
      .then(response => {
        if (response == null || typeof response !== 'object' || response.result == null) {
          throw new WechatCloudError('INVALID_RESPONSE', '登录服务返回异常，请稍后重试。')
        }
        resolve(response.result as T)
      })
      .catch(error => {
        reject(error instanceof WechatCloudError ? error : new WechatCloudError(
          'CALL_FAILED', '暂时无法连接登录服务，请检查网络。若正在保存，请重新登录读取资料确认结果。',
        ))
      })
      .finally(() => clearTimeout(timer))
  })
}
