# teamManagement

D04领队建队及球员管理服务，身份仅来自微信可信上下文；与后台HTTPS认证相互独立。

部署到开发环境 `cloud1-d2goo1h1mee3b7a38`，云端安装依赖。依赖私有集合 `users`、`teams`、`leaderTeamBindings`、`players`，客户端规则均为 `{"read":false,"write":false}`。新集合权限验证前不要写入个人或球队资料。`WECHAT_APP_ID`默认对应本项目 `wx52f6e75968af08d3`。

支持 `mine`、`create`、`update`、`savePlayer`、`removePlayer`、`checkDissolution`、`dissolve`。创建球队、唯一归属与领队身份一起提交；当前名单及球员历史档案一起更新。无业务引用的球队可经队名确认后归档并释放建队资格；保存旧ID/名单及跨球队生命周期版本。未来引用写入必须与球队active检查和version递增同事务，见开发说明。队徽上传关闭。完整字段、并发规则、部署及验证见 [球队开发说明](../../docs/TEAMS_DEVELOPMENT.md)。

## D05扩展

registrations.*负责本人报名，files.*负责私有分段材料上传。新增registrations、registrationFiles必须关闭客户端直读写；REGISTRATION_UPLOADS_ENABLED默认false。建议函数执行超时60秒，启用前验证存储权限；详见../../docs/REGISTRATIONS_DEVELOPMENT.md。
