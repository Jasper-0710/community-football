'use strict'

const cloud = require('wx-server-sdk')
const { createUserProfileHandler, DEFAULT_APP_ID } = require('./service')
const { createFavoritesHandler } = require('./favorites')
const { createFavoritesStore } = require('./favorites-store')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const profile = createUserProfileHandler({
  cloud,
  expectedAppId: process.env.WECHAT_APP_ID || DEFAULT_APP_ID,
  avatarUploadEnabled: process.env.USER_PROFILE_AVATAR_ENABLED === 'true',
})
const favorites = createFavoritesHandler({
  store: createFavoritesStore(cloud.database({ throwOnNotFound: false })),
  context: () => cloud.getWXContext(),
  expectedAppId: process.env.WECHAT_APP_ID || DEFAULT_APP_ID,
})
exports.main = event => typeof event?.action === 'string' && event.action.startsWith('favorites.') ? favorites(event) : profile(event)
