'use strict'

const cloud = require('wx-server-sdk')
const { createAdminService } = require('./service')
const { createHttpHandler } = require('./http')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const database = cloud.database({ throwOnNotFound: false })
const store = {
  async read() { return (await database.collection('adminAccounts').doc('primary').get()).data },
  async transaction(callback) {
    return database.runTransaction(async transaction => {
      const ref = transaction.collection('adminAccounts').doc('primary')
      const { data } = await ref.get()
      return callback(data, async account => {
        const { _id, _openid, ...record } = account
        await ref.set({ data: record })
      })
    })
  },
}
const service = createAdminService({ store })
const origins = ['http://127.0.0.1:5174', 'http://localhost:5174', ...(process.env.ADMIN_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)]
const http = createHttpHandler(service, origins)
exports.main = async event => event && typeof event.httpMethod === 'string' ? http(event) : service(event)
