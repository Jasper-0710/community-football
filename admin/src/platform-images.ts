import type { AdminApi } from './api'
import { uploadPreparedImage, type NewsImageDraft } from './news-images'
export function uploadPlatformImage(draft: NewsImageDraft, authorized: <T>(fn: (api: AdminApi, token: string) => Promise<T>) => Promise<T>, current: () => boolean = () => true) {
  return uploadPreparedImage(draft, {
    prefix: 'pi',
    start: fields => authorized((api, token) => api.startPlatformImage(token, fields)),
    chunk: (id, index, data) => authorized((api, token) => api.platformImageChunk(token, id, index, data)),
    finish: id => authorized((api, token) => api.finishPlatformImage(token, id)),
    matches: image => image.settingsId === 'primary',
  }, current)
}
