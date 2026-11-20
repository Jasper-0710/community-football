import {createPlatformState} from './platform-settings-state'
import {publicRecovery} from '@/services/public-data'
import {getPlatformSettings} from '@/services/platform-settings'
const cacheKey=`community-football.platform.v1:${import.meta.env.VITE_WECHAT_CLOUD_ENV_ID||''}:${import.meta.env.VITE_COMPETITION_API_URL||''}`
const state=createPlatformState({load:getPlatformSettings,readCache:()=>uni.getStorageSync(cacheKey),writeCache:s=>uni.setStorageSync(cacheKey,s)})
publicRecovery.subscribe(()=>state.refresh())
export function usePlatformSettings(){state.initialize();return state}
