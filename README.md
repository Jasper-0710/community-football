# 中国社超上海赛区赛事平台

当前进度更新至2026-11-13（v2.19），见[当前进度与下一步](docs/PROGRESS.md)、[开发计划与进度表](docs/中国社超上海赛区赛事平台-开发计划与进度.xlsx)和[验收流程](docs/VERIFICATION.md)。29项完整需求中19项开发中、10项未开始；已有通过的子功能不等于整项验收完成。

项目包含微信小程序、网页赛事管理后台和微信云开发服务。登录昵称、头像、球队资料、球员错误提示、解散归档重建、赛事开关，以及报名审核主要分项已获用户确认；iPhone切页不再反复登录已验证。D06赛程、D07比赛记录、D08榜单晋级已有代码并部署，完整云端流程和iPhone验收仍待完成。新闻、部分档案与对阵图等范围仍有演示或未完成内容。

统一使用客户AppID `wx3230f06c755cef3a`、环境 `cloud1-d6gzg20x709d7f6c1`，配置集中于 `config/cloud-environment.json`；网关路径为 `/admin-suth`。换机运行 `npm run cloud:setup`，详见[环境状态](docs/ENVIRONMENT_STATUS.md)和[云开发说明](docs/CLOUD_DEVELOPMENT.md)。冬日杯已新增3支模拟球队、24名球员及配套报名和材料，名额统计更新待工具确认，详见[D06测试数据与操作](docs/D06_TEST_DATA.md)。

## 运行

跨电脑开发统一建议使用 Node.js 22 及其自带的 npm，版本约定见 `.nvmrc`。已经安装 nvm 的 Linux/macOS 电脑可运行 `nvm install`、`nvm use`；Windows 可直接安装 Node.js 22。

```bash
npm ci
npm run cloud:setup
npm run cloud:check
npm run dev:h5
```

打开 `http://127.0.0.1:5173/`。按浏览器开发者工具的设备切换按钮即可预览手机布局。

也提供了本地运行入口：

```bash
./scripts/run.sh run dev:h5
```

`run.sh` 优先使用系统 npm，仅当它不存在时尝试本机已有的 Codex Node 运行时和 `.tools` 下的项目内 npm。这是开发便利脚本，**运行与发布代码不依赖 Codex**。其他机器正常安装 Node/npm 即可。

首次克隆或从其他电脑同步后，在项目根目录执行 `npm ci`，按锁文件安装当前系统的依赖。不要跨电脑复制 `node_modules`；macOS、Linux 和 Windows 使用不同的 esbuild/Rollup 原生文件。Git 初始化、上传和日常同步流程见 [跨电脑开发说明](docs/DEVELOPMENT.md)。

项目通过 npm workspaces 同时安装 `cloudfunctions/*` 的运行依赖，供本地云函数测试使用。云函数部署时选择“云端安装依赖”，不会将本机的 `node_modules` 当作跨平台部署包。

## 网页管理后台

```bash
npm run dev:admin
# http://127.0.0.1:5174/
npm run build:admin
```

后台与小程序独立运行。已实现账号密码登录、登录状态校验、账号工作台和退出；赛事管理已提供创建、编辑与独立开关，已通过真实云端联调，记录见开发日志，其他业务模块按计划开放。客户环境网关 `/admin-suth` 已接通，后台与 H5 已统一使用新地址；管理员账号仍待初始化。其他电脑执行 `npm run cloud:setup` 即可生成同一环境配置，地址与运行步骤见 [后台开发说明](docs/ADMIN_DEVELOPMENT.md)。正式后台托管按发布计划执行。

## 已有交互

- **首页**：赛事视觉封面、可点击公告、4 场比赛、新闻卡片、A/B 组积分与球队入口。
- **赛事信息**：后台创建及编辑，独立展示与报名开关；小程序真实公开列表和直达详情，隐藏赛事不可访问。已通过真实网页和模拟器云端联调，iPhone操作待核对。
- **示例赛程**：日期、比赛状态、球队组合筛选；休赛日空状态；一键重置。
- **对阵图**：4 场四分之一决赛、2 场半决赛、1 场决赛；横向查看；已结束比赛自动推导晋级球队；待定不显示为 0:0。
- **比赛详情**：比分、球队跳转、技术统计、进球与助攻事件、未开赛状态。
- **动态**：公告、战报、故事、快讯分类及文章详情。
- **数据**：小组积分、射手、助攻、球队统计。积分只统计已结束的小组赛；射手/助攻统计全部已结束比赛。
- **球队**：介绍、示例球员、全赛程；关注/取消关注仅保存在设备本地。
- **我的**：微信端真实登录和云端建档、昵称编辑、退出和失败重试；头像入口暂未开放；网页端提示需在微信登录。关注列表仍只保存在本机。
- **搜索**：搜索球队、比赛、文章；匹配排序；无结果状态；结果跳转。未实现球员独立详情与搜索历史。
- **键盘与手机**：浏览器按钮支持 Enter/空格；搜索支持 Escape 与焦点约束；320/390/768/1440px 布局测试。

导航采用根页面内的五区切换，详情使用独立 uni-app 页面路由。没有配置六项原生 tabBar。

## 构建微信小程序

```bash
npm ci # 首次导入或依赖变化时执行
npm run build:mp-weixin
# 或开发模式：
npm run dev:mp-weixin
```

1. 安装微信开发者工具。
2. 检查 `src/manifest.json` 的 `mp-weixin.appid`，当前已经配置 AppID。使用有该小程序开发权限的微信账号；如需更换 AppID，修改源配置后重新构建。AppSecret 和上传私钥不属于此配置。
3. 编译后导入项目根目录（包含 `package.json` 和自动生成的 `project.config.json`）。构建命令会将小程序目录设为 `dist/build/mp-weixin`，开发模式设为 `dist/dev/mp-weixin`，同时关联根目录的 `cloudfunctions/`。
4. 在开发者工具中检查滚动、导航、胶囊避让、底部安全区，并进行手机真机预览。

**编译产物不代表已通过微信开发者工具或真机验收。** 原型的历史验收记录见 `docs/VERIFICATION.md`，当前配置和后续验证以实际代码及测试结果为准。

启用云开发时，将 `.env.example` 复制为 `.env.local` 并填写 `VITE_WECHAT_CLOUD_ENV_ID`，重新编译后部署 `healthCheck` 检查连通性。尚未填写环境 ID 时可以继续预览演示页面，具体步骤见 [云开发配置](docs/CLOUD_DEVELOPMENT.md)。

## 验证命令

```bash
npm run typecheck
npm test
npm run build:h5
npm run build:mp-weixin

# 先启动 dev:h5；测试默认使用本机 Chrome，不会下载浏览器
npm run test:e2e
```

浏览器测试截图与报告输出到 `artifacts/preview/`（已 gitignore）。如需测试其他预览地址，用 `PREVIEW_URL` 环境变量指定。

## 代码结构

```text
src/
  components/          比赛卡片、对阵图、积分表、页面框架、搜索
  views/               首页 / 赛事 / 动态 / 数据 / 我的
  pages/               根页、比赛详情、文章详情、球队详情
  domain/              数据类型、积分与晋级等纯函数
  data/                单一演示数据集与可替换的数据源
  composables/         加载状态、设备本地关注
  styles/              共享设计变量、响应式布局
  static/              本地照片、原创队徽和图标
  services/            微信端云开发调用、用户资料与头像处理
admin/                 独立网页管理后台（登录、赛事管理、球队档案）
cloudfunctions/        healthCheck、userProfile、adminAuth、teamManagement
```

### 后续接后台

保留页面和 `Tournament` 数据结构，在 `src/data/repository.ts` 实现真实接口读取与字段映射。不要在各页面重复写请求或拼接球队、比分。正式版本需由后端决定权威赛果、权限与赛事规则，前端纯函数不得成为权限或数据真实性依据。

当前使用的同分规则为演示约定：积分 → 净胜球 → 进球数 → 稳定球队 ID。生产规则、点球、弃赛、申诉及数据更正需要另行确认。

## 尚未实现

D05真实云端报名验证、赛程与赛果管理、收藏跨设备同步、用户评论/评分、真实图文直播、其他业务图片上传、故障降级、多主题编辑器等，按 [开发计划](docs/DEVELOPMENT_PLAN.md) 逐项实现。后台认证及赛事资料/独立开关已完成开发环境联调；D04建队、名单维护和后台只读档案已完成开发及技术验证，含真实云端、模拟器和后台同步；真机及客户验收待记录。正式托管及个人资料真机验证状态以开发记录为准；不会在真实接口失败时用模拟用户或比分替代。

## 资料与设计

- 逐项开发计划与当前进度：[开发计划表](docs/中国社超上海赛区赛事平台-开发计划与进度.xlsx)（对应飞书29项，含子任务、日期、验证与验收状态）
- 当前已确认范围及开发顺序：[开发计划说明](docs/DEVELOPMENT_PLAN.md)
- 已确认的角色、资料字段和数据设计：[数据与权限基础说明](docs/DATA_AND_ACCESS.md)
- 项目 UI 约定：`docs/UI_GUIDELINES.md`
- 架构与接口边界：`docs/architecture/ARCHITECTURE.md`
- 技术选型说明：`docs/architecture/adr/0001-frontend-prototype.md`
- 图片来源与替换要求：`docs/ASSETS.md`

D04功能范围、已确认表单规则及操作步骤见[领队建队与球员管理](docs/TEAMS_DEVELOPMENT.md)，页面入口为小程序“我的 → 我的球队”和后台“球队档案”。
