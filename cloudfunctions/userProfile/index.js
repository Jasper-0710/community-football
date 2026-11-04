'use strict'

const cloud = require('wx-server-sdk')
const { createUserProfileHandler, DEFAULT_APP_ID } = require('./service')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = createUserProfileHandler({
  cloud,
  expectedAppId: process.env.WECHAT_APP_ID || DEFAULT_APP_ID,
  avatarUploadEnabled: process.env.USER_PROFILE_AVATAR_ENABLED === 'true',
})
