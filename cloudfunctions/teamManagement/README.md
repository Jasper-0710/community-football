# teamManagement

D04领队建队及球员管理服务，身份仅来自微信可信上下文；与后台HTTPS认证相互独立。

当前迁移目标为客户环境 `cloud1-d6gzg20x709d7f6c1`；2026-11-08 已部署代码并采用云端安装依赖，数据库/权限与业务联调状态见 `docs/CUSTOMER_ENV_MIGRATION.md`。原开发环境 `cloud1-d2goo1h1mee3b7a38` 保留为历史记录。依赖私有集合 `users`、`teams`、`leaderTeamBindings`、`players`，客户端规则均为 `{"read":false,"write":false}`。新集合权限验证前不要写入个人或球队资料。`WECHAT_APP_ID`默认对应客户小程序 `wx3230f06c755cef3a`；部署时仍显式配置此变量，并核对目标环境与小程序的关联。

支持 `mine`、`create`、`update`、`savePlayer`、`removePlayer`、`checkDissolution`、`dissolve`。创建球队、唯一归属与领队身份一起提交；当前名单及球员历史档案一起更新。无业务引用的球队可经队名确认后归档并释放建队资格；保存旧ID/名单及跨球队生命周期版本。未来引用写入必须与球队active检查和version递增同事务，见开发说明。完整字段、并发规则、部署及验证见 [球队开发说明](../../docs/TEAMS_DEVELOPMENT.md)。

## D04-2队徽（2026-11-17本地完成，客户部署待办）

`badges.config/start/chunk/finish/save/remove` 使用微信可信身份和本人当前球队绑定；支持256KiB JPG/PNG、64KiB分片、真实解码、上传重试和版本事务。新增私有集合 `teamBadges`，客户端规则 `{"read":false,"write":false}`；独立开关 `TEAM_BADGE_UPLOADS_ENABLED` 默认关闭，仅精确字符串 `true` 开启。云端安装本次新增图片解码依赖后再启用；保留现有报名配置和60秒超时。`adminAuth` 同步部署队徽投影及管理员清理，保存/解散档案的最终引用受保护。详见[开通和验收步骤](../../docs/TEAM_BADGE_UPLOAD_SETUP.md)。

## D05扩展

registrations.*负责本人报名，files.*负责私有分段材料上传。新增registrations、registrationFiles必须关闭客户端直读写；REGISTRATION_UPLOADS_ENABLED默认false。建议函数执行超时60秒，启用前验证存储权限；详见../../docs/REGISTRATIONS_DEVELOPMENT.md。
