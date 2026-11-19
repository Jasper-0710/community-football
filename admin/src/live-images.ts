import type { AdminApi } from './api'
import { uploadPreparedImage, type NewsImageDraft } from './news-images'
export function uploadLiveImage(draft: NewsImageDraft, entryId: string, authorized: <T>(fn: (api: AdminApi, token: string) => Promise<T>) => Promise<T>, current: () => boolean = () => true) {
  return uploadPreparedImage(draft, {
    prefix: 'li',
    start: fields => authorized((api, token) => api.startLiveImage(token, { ...fields, entryId })),
    chunk: (id, index, data) => authorized((api, token) => api.liveImageChunk(token, id, index, data)),
    finish: id => authorized((api, token) => api.finishLiveImage(token, id)),
    matches: image => image.entryId === entryId,
  }, current)
}
