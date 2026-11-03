# 中国社超上海赛区赛事平台

中国社超上海赛区的可交互前端原型。以「首页 → 赛事 → 比赛详情」和「赛程 → 淘汰赛对阵图」为主要体验路径。

**当前是演示版，不是真实赛事平台。** 固定演示日期为 **2026-10-25（北京时间）**；球队、球员、赛事、比分与新闻均为虚构资料。没有登录、报名、收费或真实直播，页面尚未接入真实业务数据。已准备微信云开发初始化与连接检测函数，配置方式见 [云开发说明](docs/CLOUD_DEVELOPMENT.md)。uni 统计已关闭。

## 运行

跨电脑开发统一建议使用 Node.js 22 及其自带的 npm，版本约定见 `.nvmrc`。已经安装 nvm 的 Linux/macOS 电脑可运行 `nvm install`、`nvm use`；Windows 可直接安装 Node.js 22。

```bash
npm ci
npm run dev:h5
```

打开 `http://127.0.0.1:5173/`。按浏览器开发者工具的设备切换按钮即可预览手机布局。

也提供了本地运行入口：

```bash
./scripts/run.sh run dev:h5
```

`run.sh` 优先使用系统 npm，仅当它不存在时尝试本机已有的 Codex Node 运行时和 `.tools` 下的项目内 npm。这是开发便利脚本，**运行与发布代码不依赖 Codex**。其他机器正常安装 Node/npm 即可。

首次克隆或从其他电脑同步后，在项目根目录执行 `npm ci`，按锁文件安装当前系统的依赖。不要跨电脑复制 `node_modules`；macOS、Linux 和 Windows 使用不同的 esbuild/Rollup 原生文件。Git 初始化、上传和日常同步流程见 [跨电脑开发说明](docs/DEVELOPMENT.md)。

## 已有交互

- **首页**：赛事视觉封面、可点击公告、4 场比赛、新闻卡片、A/B 组积分与球队入口。
- **赛事**：日期、比赛状态、球队组合筛选；休赛日空状态；一键重置。
- **对阵图**：4 场四分之一决赛、2 场半决赛、1 场决赛；横向查看；已结束比赛自动推导晋级球队；待定不显示为 0:0。
- **比赛详情**：比分、球队跳转、技术统计、进球与助攻事件、未开赛状态。
- **动态**：公告、战报、故事、快讯分类及文章详情。
- **数据**：小组积分、射手、助攻、球队统计。积分只统计已结束的小组赛；射手/助攻统计全部已结束比赛。
- **球队**：介绍、示例球员、全赛程；关注/取消关注仅保存在设备本地。
- **我的**：游客状态、关注列表及原型范围说明。不伪造登录成功。
- **搜索**：搜索球队、比赛、文章；匹配排序；无结果状态；结果跳转。未实现球员独立详情与搜索历史。
- **键盘与手机**：浏览器按钮支持 Enter/空格；搜索支持 Escape 与焦点约束；320/390/768/1440px 布局测试。

导航采用根页面内的五区切换，详情使用独立 uni-app 页面路由。没有配置六项原生 tabBar。

## 构建微信小程序

```bash
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
  services/            微信端云开发初始化
cloudfunctions/        云函数源码，当前仅有连接检测函数
```

### 后续接后台

保留页面和 `Tournament` 数据结构，在 `src/data/repository.ts` 实现真实接口读取与字段映射。不要在各页面重复写请求或拼接球队、比分。正式版本需由后端决定权威赛果、权限与赛事规则，前端纯函数不得成为权限或数据真实性依据。

当前使用的同分规则为演示约定：积分 → 净胜球 → 进球数 → 稳定球队 ID。生产规则、点球、弃赛、申诉及数据更正需要另行确认。

## 尚未实现

管理后台、微信登录、用户评论/评分、报名支付、消息订阅、真实直播、权限审计、远端图片上传、REST/云函数降级、多主题编辑器。原型不会在真实接口失败时偷偷用模拟比分替代。

## 资料与设计

- 原始 `需求清单.xlsx` 保持不变。
- 项目 UI 约定：`docs/UI_GUIDELINES.md`
- 架构与接口边界：`docs/architecture/ARCHITECTURE.md`
- 技术选型说明：`docs/architecture/adr/0001-frontend-prototype.md`
- 图片来源与替换要求：`docs/ASSETS.md`
