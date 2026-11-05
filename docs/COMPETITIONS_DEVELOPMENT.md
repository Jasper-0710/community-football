# 赛事创建与发布（D03）

项目：中国社超上海赛区赛事平台。更新：2026-11-05。对应原表#1、#2、#16、#25。

后台“赛事管理”支持新建、编辑、赛制类型与说明、比赛日期地点、参赛要求、报名时间以及独立展示/报名开关。新赛事默认隐藏且报名关闭。小程序首页和赛事页读取真实公开列表，进入独立赛事详情；隐藏赛事的直达详情同样拒绝访问。已有赛程、比分、球队和新闻仍是明确标识的示例内容。

本阶段提供报名状态，球队提交报名在D05实现；真实分组、积分、晋级及平局处理在D08落实。赛制说明可先填写客户实际规则，不推定尚未确认的业务参数。

## 运行与环境

后台沿用 `.env.admin.local` 的 `VITE_ADMIN_API_URL`。微信端沿用 `.env.local` 的 `VITE_WECHAT_CLOUD_ENV_ID`。H5公开赛事读取可在 `.env.local` 增加：

```dotenv
VITE_COMPETITION_API_URL=https://cloud1-d2goo1h1mee3b7a38-1525008540.ap-shanghai.app.tcloudbase.com/admin-auth
```

全部为公开环境标识或地址，不含凭据。修改环境变量后重启对应开发服务。后台启动 `CHOKIDAR_USEPOLLING=true npm run dev:admin`，H5启动 `CHOKIDAR_USEPOLLING=true npm run dev:h5`。在其他电脑按 `.env.example` 单独配置本地文件。

部署目标为开发环境 `cloud1-d2goo1h1mee3b7a38`，更新 `adminAuth`，复用原 `/admin-auth` HTTP路由。新增 `competitions` 集合，须在任何赛事写入前将客户端权限设为仅管理员可读写，自定义规则 `{"read":false,"write":false}`。公开内容经云函数投影返回。本环境已完成上述部署与权限验证，D03开发和技术验证通过；iPhone与客户效果核对另记。

## 验证与核对

```bash
npm test
npm run typecheck
npm run typecheck:admin
npm run test:admin:browser
npm run test:competitions:browser
CHOKIDAR_USEPOLLING=true npm run build:mp-weixin
CHOKIDAR_USEPOLLING=true npm run build:h5
npm run build:admin
npm run test:e2e
```

本地业务验证覆盖权限、重复创建、并发版本、隐藏直达、独立开关、时间边界、输入校验、分页和存储异常。浏览器联动使用隔离事务存储和真实HTTP处理器。报告与截图位于 `artifacts/competitions/`，不纳入Git。

云端需复验：集合客户端直读写均被拒绝；真实后台新建隐藏赛事；小程序列表和直达详情不可见；开启展示后两端内容一致；报名开关与时间状态独立；编辑和隐藏后刷新同步；无效管理员令牌拒绝写入。联调赛事应明确命名“联调测试”，完成后保持隐藏。iPhone实际操作、Android和客户效果核对另行记录。

接口与字段契约见 [adminAuth说明](../cloudfunctions/adminAuth/README.md)。

## 2026-11-05验证结果

97项本地测试、10项后台登录回归、19项原小程序UI回归、8条赛事浏览器联动、两端类型检查和三个构建均通过。隔离存储报告为 `artifacts/competitions/report.json`。

真实云端验证完成：competitions客户端读取、写入均返回-502003；浏览器创建/发布/编辑/独立开关/隐藏及版本冲突共4组流程通过；小程序真实云调用与页面共8项检查通过，重新进入页面按最新状态读取，隐藏详情显示不可访问、返回首页移除旧赛事。报告为 `artifacts/competitions/cloud-browser-report.json` 和 `simulator-cloud-report.json`，截图同目录。

唯一联调赛事ID `c_689d083373328a920c4bdc632f34e2d2`，最终隐藏、报名关闭，不是真实赛事；测试会话已退出。模拟器旧编译缓存曾导致onShow导出不一致，清编译缓存并重新打开项目后消失；最终控制台未匹配error。客户核对、iPhone/Android及后续报名提交仍分别跟踪。
