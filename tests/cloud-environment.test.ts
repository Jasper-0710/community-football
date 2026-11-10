import test from 'node:test'
import assert from 'node:assert/strict'
import { cloudEnvironment, validateCloudEnvironment } from '../scripts/cloud-environment.mjs'

const target = { ...cloudEnvironment, adminApiUrl: '' }
const customerUrl = `https://${target.envId}-1234567890.ap-shanghai.app.tcloudbase.com/admin-auth`
const legacyUrl = 'https://cloud1-d2goo1h1mee3b7a38-1525008540.ap-shanghai.app.tcloudbase.com/admin-auth'

test('环境配置默认使用客户环境，未配置网关时不回退旧地址', () => {
  const actual = validateCloudEnvironment({}, target)
  assert.equal(actual.envId, 'cloud1-d6gzg20x709d7f6c1')
  assert.equal(actual.appid, 'wx3230f06c755cef3a')
  assert.equal(actual.adminApiUrl, '')
  assert.equal(actual.competitionApiUrl, '')
})

test('拒绝旧环境ID及两端的旧CloudBase接口', () => {
  assert.throws(() => validateCloudEnvironment({ VITE_WECHAT_CLOUD_ENV_ID: 'cloud1-d2goo1h1mee3b7a38' }, target), /云环境不一致/)
  for (const key of ['VITE_ADMIN_API_URL', 'VITE_COMPETITION_API_URL']) {
    assert.throws(() => validateCloudEnvironment({ [key]: legacyUrl }, target), /属于其他云环境/)
  }
})

test('客户后台地址作为两端默认接口，其他本机覆盖必须与确认地址一致', () => {
  const confirmed = { ...target, adminApiUrl: customerUrl }
  const actual = validateCloudEnvironment({}, confirmed)
  assert.equal(actual.adminApiUrl, customerUrl)
  assert.equal(actual.competitionApiUrl, customerUrl)
  assert.throws(() => validateCloudEnvironment({ VITE_ADMIN_API_URL: 'https://other.example.com/api' }, confirmed), /不一致/)
  assert.throws(() => validateCloudEnvironment({ VITE_COMPETITION_API_URL: customerUrl + '-other' }, confirmed), /不一致/)
})

test('拒绝不安全接口和含有凭据的配置', () => {
  for (const endpoint of ['not-a-url', 'http://example.com/api', 'https://unknown.example.com/api', 'https://user:secret@example.com/api', customerUrl + '?token=secret', customerUrl + '#secret']) {
    assert.throws(() => validateCloudEnvironment({ VITE_ADMIN_API_URL: endpoint }, target))
  }
})

test('隔离浏览器测试可使用本机接口，不更改客户环境ID', () => {
  for (const endpoint of ['http://127.0.0.1:5176/api', 'https://localhost:5197/api', 'http://[::1]:5177/api']) {
    const actual = validateCloudEnvironment({ VITE_ADMIN_API_URL: endpoint }, { ...target, adminApiUrl: customerUrl })
    assert.equal(actual.adminApiUrl, endpoint)
    assert.equal(actual.envId, target.envId)
  }
})

test('AppID与客户配置不一致时停止构建', () => {
  assert.throws(() => validateCloudEnvironment({}, { ...target, appid: 'wx-wrong-app' }), /AppID必须为/)
})
