# adminAuth

中国社超上海赛区赛事平台网页后台的单管理员认证与赛事管理云函数。D02 本地实现及测试已通过，真实云端验证状态见 `docs/DEVELOPMENT_LOG.md`。

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

HTTP 访问使用 POST JSON；除 `login` 及明确列入白名单的赛事公开查询外，令牌放在 `Authorization: Bearer <token>`，不放 JSON 或 URL。支持 OPTIONS 预检；校验来源、内容类型和请求大小，返回 `Cache-Control: no-store`。仅允许明确来源，不使用通配跨域或 Cookie。公网 HTTP 访问配置说明见 `docs/ADMIN_DEVELOPMENT.md`。

## 部署与测试

依赖 `wx-server-sdk@3.0.4`，Node.js >=16；部署选择云端安装依赖。函数使用当前云环境，不从客户端接受环境或账号 ID。入口 `index.js` 连接真实数据库；`service.js` 与 `http.js` 可在隔离存储下运行行为测试。

从仓库根目录运行 `npm test`、`npm run test:admin:browser`。本地测试覆盖并发失败限流、密码更换竞态、会话上限与撤销、HTTP及客户端异常。开发环境已完成真实数据库、8项直接云函数调用及7项浏览器经公网HTTP网关的验证；报告见 `artifacts/admin/`，正式托管和后续业务接口权限随计划继续验证。

## D03 赛事接口

赛事逻辑位于 `competitions.js`，共用已配置的HTTP网关和管理员会话；不新增HTTP路由。写接口全部调用服务端会话校验。公开调用仅白名单 `competitions.listPublic`、`competitions.getPublic`，不需要管理员令牌，且必须遵守展示开关。

| action | 输入（HTTP令牌通过Bearer头） | 结果 |
| --- | --- | --- |
| competitions.listPublic | cursor可选 | 已展示赛事，最多20条、nextCursor |
| competitions.getPublic | id | 已展示赛事；隐藏与不存在均NOT_FOUND |
| competitions.listAdmin | token、cursor可选 | 全部赛事、版本与开关 |
| competitions.create | token、requestId、form | 赛事默认隐藏、报名关闭；相同请求幂等 |
| competitions.update | token、id、expectedVersion、form | 编辑资料，版本递增；冲突不覆盖 |
| competitions.visibility | token、id、expectedVersion、enabled | 独立展示开关 |
| competitions.registration | token、id、expectedVersion、enabled | 独立报名开关；开启前须设置完整时间 |

`form`含name(1–80)、description(1–1000)、format、formatDescription(1–1000)、startDate/endDate、venue(1–120)、registrationRequirements(1–1000)、registrationStartAt/EndAt。长度按Unicode码点，拒绝控制字符和未知字段。日期为有效的YYYY-MM-DD、2020–2100；报名时间为成对null或标准UTC ISO毫秒时间，截止须晚于开始。format为group_knockout、round_robin、knockout或other；赛制说明由运营填写，本阶段不计算积分或晋级。

`requestId`为32位十六进制随机值，赛事ID为`c_`加requestId；创建指纹由云端计算。相同请求再次提交返回原记录，变更资料复用同一创建请求返回CONFLICT。编辑和开关须提供当前expectedVersion，事务内比较并递增。时间由服务端维护；报名状态依次为disabled/upcoming/open/closed，开始时开放、截止时关闭。

`competitions`集合客户端直接读写必须为`{"read":false,"write":false}`，仅通过云函数读取。公开响应投影白名单字段，不返回创建指纹、版本和内部身份。列表按_id升序进行游标分页，公开查询同时过滤displayEnabled=true。建议索引为displayEnabled升序＋_id升序。

D03已完成云端部署、集合私有权限验证、真实HTTPS网页4组与小程序模拟器8项检查；完整记录见开发日志。运行 `npm run test:competitions:browser` 可验证真实Vue页面、HTTPS处理器和隔离事务存储，不替代云数据库验证。

## D04球队档案

新增 `teams.listAdmin`（可选cursor，20条分页）和 `teams.getAdmin`（id）只读接口，全部要求有效管理员会话；不是公开接口。读取私有teams及领队昵称，返回安全投影。后台新增“球队档案”页，原HTTP路径不变。领队写入由独立teamManagement处理，完整契约见[球队开发说明](../../docs/TEAMS_DEVELOPMENT.md)。

## D05扩展

registrations.*报名查询/审核/下载全部复用管理员会话，不是公开接口。新增赛事报名配置与事务计数。材料临时链接默认关闭，启用条件见../../docs/REGISTRATIONS_DEVELOPMENT.md。
