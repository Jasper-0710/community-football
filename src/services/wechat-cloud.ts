// wx.cloud is supplied by the WeChat runtime, not by the H5 preview.
declare const wx: {
  cloud?: { init(options: { env: string }): void }
}

export function initializeWechatCloud(): void {
  // #ifdef MP-WEIXIN
  const envId = import.meta.env.VITE_WECHAT_CLOUD_ENV_ID?.trim()
  if (!envId) return
  if (typeof wx === 'undefined' || typeof wx.cloud?.init !== 'function') {
    console.error('当前微信运行环境不支持云开发，请检查基础库和微信版本。')
    return
  }
  try {
    wx.cloud.init({ env: envId })
  } catch (error) {
    console.error('云开发初始化失败，请检查 VITE_WECHAT_CLOUD_ENV_ID 配置。', error)
  }
  // #endif
}
