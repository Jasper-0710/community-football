'use strict'
const { createImageModel } = require('./news-image-model')
const { createNewsImageService } = require('./news-images')
const model = createImageModel({
  imagePattern: /^li_[a-f0-9]{32}$/, ownerPattern: /^l_[a-f0-9]{32}$/, ownerKey: 'entryId',
  collection: 'matchLiveImages', pathPrefix: 'match-live',
  ids: record => [...new Set((record?.images || []).map(image => image.imageId).filter(Boolean))],
})
function createLiveImageService(options) {
  return createNewsImageService({ ...options, model, prefix: 'live.images', imageCollection: 'matchLiveImages', ownerCollection: 'matchLiveEntries', ownerKey: 'entryId', idPrefix: 'li', pathPrefix: 'match-live' })
}
module.exports = { model, createLiveImageService }
