// Deployment/connectivity check only. Does not read or write business data.
exports.main = async () => ({
  ok: true,
  service: 'community-football',
  timestamp: new Date().toISOString(),
})
