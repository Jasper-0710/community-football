import {requestPublicData} from './public-data'
import {parsePlatformSettings,SettingsClientError} from '@/domain/platform-settings'
export async function getPlatformSettings(){try{return parsePlatformSettings((await requestPublicData({action:'settings.getPublic'})).settings)}catch(error:any){throw new SettingsClientError(error?.code||'SERVICE_UNAVAILABLE',error instanceof Error?error.message:'暂时无法同步平台设置。')}}
