# adminAuth

中国社超上海赛区赛事平台网页后台的单管理员认证云函数。D02 本地实现及测试已通过，真实云端验证状态见 `docs/DEVELOPMENT_LOG.md`。

## 数据与认证

集合 `adminAccounts` 必须禁止所有客户端直接读写：`{"read":false,"write":false}`。首期固定文档 `primary`，其中存放账号、失败计数及最多 5 个会话摘要。无需额外 `adminSessions` 集合；单文档事务用于并发登录、失败计数和退出撤销。

文档字段：`schemaVersion`、`username`、`displayName`、`password`、`credentialVersion`、`status`、`sessions`、`failedAttempts`、`failureWindowAt`、`lockedUntil`、`attemptWindowAt`、`attemptCount`、`createdAt`、`updatedAt`。时间戳为毫秒；会话含 `digest/createdAt/expiresAt`。`_id` 固定为 `primary`。

- 密码使用 PBKDF2-HMAC-SHA256、600,000 次迭代、32 字节随机盐及 32 字节哈希；不存明文。
- 令牌为 32 字节随机值，数据库只存 SHA-256 摘要；有效期固定 8 小时。第 6 次有效登录移除最早会话。
- 15 分钟内错误密码 5 次锁定 15 分钟；账号每分钟最多预留 20 次登录尝试，先限流再进行密码派生。首期为账号级限流，公开入口上线时仍需结合平台流量限制配置。
- 账号不存在时返回 `NOT_CONFIGURED`；禁用、令牌伪造、过期、被撤销或凭据版本改变后拒绝访问。
- 微信 `userInfo`、`tcbContext` 不授予管理员权限；用户集合中的角色不能替代独立后台会话。
- 服务日志只记录通用失败信息，不记录密码、令牌或 SDK 异常数据。

## 操作契约

直接云函数调用的输入如下；输出统一包含 `ok`，失败时含 `error.code/message`。

| action | 输入 | 成功结果 |
| --- | --- | --- |
| login | username、password | token、admin（username/displayName/role）、expiresAt |
| session | token | admin、expiresAt |
| overview | token | admin、expiresAt、availableModules=['account']、serverTime |
| logout | token | ok=true；已撤销的令牌再次退出仍成功 |

`overview` 是受保护的账号工作台接口，不提供虚构赛事统计。后续管理接口须复用同等服务端会话验证，不能仅检查网页登录状态。

HTTP 访问使用 POST JSON；除 `login` 外，令牌放在 `Authorization: Bearer <token>`，不放 JSON 或 URL。支持 OPTIONS 预检；校验来源、内容类型和请求大小，返回 `Cache-Control: no-store`。仅允许明确来源，不使用通配跨域或 Cookie。公网 HTTP 访问配置说明见 `docs/ADMIN_DEVELOPMENT.md`。

## 部署与测试

依赖 `wx-server-sdk@3.0.4`，Node.js >=16；部署选择云端安装依赖。函数使用当前云环境，不从客户端接受环境或账号 ID。入口 `index.js` 连接真实数据库；`service.js` 与 `http.js` 可在隔离存储下运行行为测试。

从仓库根目录运行 `npm test`、`npm run test:admin:browser`。本地测试覆盖并发失败限流、密码更换竞态、会话上限与撤销、HTTP及客户端异常。开发环境已完成真实数据库、8项直接云函数调用及7项浏览器经公网HTTP网关的验证；报告见 `artifacts/admin/`，正式托管和后续业务接口权限随计划继续验证。
