# AI会话接手与开发操作指南

项目：**中国社超上海赛区赛事平台**。流程版本：1.0。整理日期：**2026-11-11（北京时间）**。

本文面向接手本项目的AI会话和开发者，说明此前实际使用的开发方式、微信开发者工具连接、页面操作、云端联调和验收记录方法。本文是操作指南；当前功能状态以[最新进度](PROGRESS.md)和[Excel开发计划与进度表](中国社超上海赛区赛事平台-开发计划与进度.xlsx)为准。示例工具名称来自本机已有的微信开发者工具MCP定义，新会话仍须读取当次实际工具定义。

## 1. 先理解我们的工作方式

一次功能交付按下面的闭环完成：

**读取计划与当前代码 → 明确本项规则和验收条件 → 实现云端与两端页面 → 本地检查和隔离测试 → 部署相关云函数 → 模拟器与真实云端联调 → 用户iPhone验收 → 同步进度和文档 → 按用户指令提交／推送。**

开发会话直接阅读、修改仓库，运行命令、编译和测试；通过微信开发者工具MCP操作小程序和云资源，通过浏览器自动化操作网页后台。用户处理工具要求的扫码、连接授权和云端操作确认，并完成手机原生能力和业务体验验收。已有授权范围内的工作持续执行，只有确实缺少信息、凭据或遇到工具确认时才交给用户处理。

不要只做页面原型就把功能标为完成。一个功能至少要核对页面、接口、服务端规则、权限、数据状态和相关入口联动；未完成的验证保留具体清单。

## 2. 新会话的第一轮操作

### 2.1 确认仓库与现场

本机仓库根目录是：

```text
/home/ubuntu/Desktop/PROJ/MINIprogram/MINIprogram
```

这一层包含`package.json`、`src/`、`admin/`和`cloudfunctions/`。上一级目录不是本项目Git操作的默认位置。换电脑时以实际克隆路径为准，不能照抄本机绝对路径。

先读取适用的`AGENTS.md`及当次可用工具说明，再检查：

```bash
pwd
git status --short --branch
git log -5 --oneline
```

先保留已有修改，区分用户改动和本次任务；不自动覆盖、清理或强制重置工作区。需要同步远端时，在处理好未提交修改后运行`git pull --ff-only`。接手不需要重新初始化Git。

### 2.2 按这个顺序阅读资料

| 顺序 | 资料 | 要解决的问题 |
| --- | --- | --- |
| 1 | [项目说明](../README.md)、[最新进度](PROGRESS.md) | 当前主线、已通过分项、剩余问题 |
| 2 | [开发计划](DEVELOPMENT_PLAN.md)、Excel的“下一步行动／功能开发总表／用户验收记录” | 功能编号、依赖、客户原备注、实际验收范围 |
| 3 | [测试与验收](VERIFICATION.md) | 已有证据、用户测试步骤、尚未覆盖的场景 |
| 4 | [当前云环境](ENVIRONMENT_STATUS.md)、[统一配置](../config/cloud-environment.json) | AppID、环境、网关、已建资源与配置 |
| 5 | 本模块开发文档、源码和现有测试 | 实际接口、事务、状态流转和扩展方式 |

截至最近一次功能进度记录（2026-11-10），D05为部分已验证，下一开发模块是D06；本指南的创建不改变业务进度。接手时若已有更新，以最新记录和实际代码为准。

### 2.3 准备开发与预览

本地Node版本约定见[.nvmrc](../.nvmrc)，目前为Node.js 22；云函数运行时单独核对，不随本地Node自动升级。

```bash
npm ci
npm run cloud:setup
npm run cloud:check
```

依赖已安装且锁文件未变化时，无需每轮重装。不要同时在同一工作目录运行多次安装，或并行运行会相互覆盖产物的构建。

| 目的 | 命令 | 结果 |
| --- | --- | --- |
| 小程序持续开发 | `npm run dev:mp-weixin` | 持续生成`dist/dev/mp-weixin/`，保持进程运行 |
| 小程序一次构建 | `npm run build:mp-weixin` | 生成`dist/build/mp-weixin/` |
| 网页后台 | `npm run dev:admin` | 本机`http://127.0.0.1:5174/` |
| H5辅助预览 | `npm run dev:h5` | 本机`http://127.0.0.1:5173/` |

微信开发者工具**导入仓库根目录**。预构建脚本生成根目录`project.config.json`，同时关联小程序产物与`cloudfunctions/`。切换dev／build后检查`miniprogramRoot`；修改`src/`源码，不手改`dist/`。5174不可达时先确认后台进程是否运行、端口是否冲突，再检查接口。

## 3. 代码结构与两端如何交互

| 位置 | 职责与修改原则 |
| --- | --- |
| `src/pages/`、`src/views/`、`src/components/` | uni-app／Vue小程序页面、视图与复用组件；路由在`src/pages.json` |
| `src/domain/` | 客户端类型、结果解析和领域规则 |
| `src/services/`、`src/composables/` | 小程序接口调用、状态组织；云调用入口为`src/services/wechat-cloud.ts` |
| `admin/src/` | 独立Vue网页后台；`api.ts`和`auth.ts`负责接口及会话 |
| `cloudfunctions/userProfile/` | 微信身份建档、昵称和私有头像 |
| `cloudfunctions/teamManagement/` | 本人球队、球员、解散、报名和私有材料 |
| `cloudfunctions/adminAuth/` | 管理员HTTP入口、赛事、只读档案、报名审核和材料维护 |
| `cloudfunctions/healthCheck/` | 不读写业务数据的连通性检查 |
| `tests/`、`tests/helpers/`、`scripts/verify-*.mjs` | 单元／服务测试、隔离存储和浏览器流程测试 |
| `src/data/` | 仍有原型演示数据；展示原型不能算真实功能交付 |

实际请求关系是：

```text
微信小程序 → wx.cloud.callFunction → userProfile / teamManagement / adminAuth
网页后台、H5公开查询 → HTTPS网关 /admin-suth → adminAuth
云函数 → 云数据库、私有云存储
```

本人身份取微信云调用上下文，不接受前端自报OPENID或领队身份。网页后台使用服务端校验的管理员会话。数据库／存储管理工具用于部署与诊断，不能代替业务授权测试。

## 4. 如何连接微信开发者工具

### 4.1 优先复用当次会话已提供的连接

如果会话已经提供微信开发者工具MCP，直接按其实际工具定义调用。先查登录状态和项目，再打开正确项目，不重复创建连接或导入副本。

此前使用的核心工具包括：

| 用途 | 工具 |
| --- | --- |
| 工具与项目状态 | `check_wechatide_status`、`project_list`、`open_project_window` |
| 当前页面与操作 | `automation_runtime_info`、`automation_navigate`、`automation_page_action`、`automation_element_action` |
| 运行时与微信API | `automation_evaluate`、`automation_wx_api` |
| 编译刷新与诊断 | `simulator_open_page`、`simulator_refresh`、`simulator_screenshot`、`get_simulator_console`、`get_simulator_network` |
| 云资源 | `cloud_env_list`、`cloud_fn_list`、`cloud_fn_info`、`cloud_fn_deploy`、`cloud_fn_inc_deploy`、`cloud_db_read_struct`、`cloud_db_write_struct` |
| 异步确认 | `polling_task_result` |
| 手机预览 | `create_preview_qrcode`、`auto_preview` |

并非所有会话都自动拥有上述工具。工具缺失时应检查本机CLI或已有连接配置，不能假装已操作成功，也不要先花很长时间反复点击界面。

### 4.2 本机此前使用的CLI连接

本机安装的是Linux版微信开发者工具，已存在的CLI路径为：

```text
/opt/apps/io.github.msojocs.wechat-devtools-linux/files/bin/bin/wechatide
```

此前通过`wechatide mcp --token=...`启动STDIO MCP服务，由Python适配器发送JSON-RPC。调用顺序为`initialize`、`notifications/initialized`、`tools/list`或`tools/call`，适配器按请求ID读取响应。

本机曾使用`/tmp/wechat_mcp_call.py`，工具定义快照位于`.tools/wechat-tools.json`；两者都不是仓库交付依赖。新会话／新电脑必须检查是否存在，并重新确认CLI、登录和MCP凭据。不要复制旧适配器中的硬编码凭据。安全重建示例见文末附录；示例使用本机环境变量传入凭据，不在Markdown或Git中保存真实值。

Linux兼容点：此前CLI读取的数据目录与正在运行的工具不一致，需要进程级`NODE_OPTIONS=--require=/tmp/wechatide-linux-data-path.cjs`适配；本机兼容文件把`global.userDirPath`指向实际目录`/home/ubuntu/.config/wechat-devtools/app/Default`。这是当前机器的处理方式，**不能直接推广到其他安装路径或系统**。仅在复现同一目录问题、确认真实用户目录后使用；不要改动登录校验或跳过授权。

### 4.3 首次连接的核对顺序

1. 获取当次`tools/list`，读取工具入参；若使用随工具安装的skill，按其说明传递真实版本，不编造版本号。
2. `check_wechatide_status`确认登录态；未登录时按工具实际返回完成扫码。MCP独立Token与微信扫码登录不是同一个凭据。
3. `project_list`检查路径和AppID，`open_project_window`打开正确仓库，可用`windowMode: "fullMode"`查看编辑器与调试器。
4. `cloud_env_list`核对客户环境，随后查询函数和数据库结构；只读核对完成前不改云资源。
5. `automation_runtime_info`读取当前页面；确认运行的是当前编译目录，再进行页面交互。

工具或平台出现真实授权／确认时，请用户处理具体弹窗，并保留返回的`taskId`；已有授权继续复用。不要把连接授权、集合创建确认和函数部署确认混为同一件事。

## 5. 如何操作和诊断小程序

以下为`tools/call`的工具名与参数示例。绝对路径需替换为接手机器的实际路径。

### 5.1 打开页面、读取状态

```json
{"name":"automation_runtime_info","arguments":{"project":"/home/ubuntu/Desktop/PROJ/MINIprogram/MINIprogram","action":"currentPage"}}
```

```json
{"name":"automation_navigate","arguments":{"project":"/home/ubuntu/Desktop/PROJ/MINIprogram/MINIprogram","action":"navigateTo","url":"/pages/team/manage"}}
```

当前真实业务路由还包括`pages/competition/detail`、`pages/registration/manage`和`pages/registration/mine`；详情页参数从当前代码或真实入口获取，不随意猜测ID。`pages/index/index`内部有多个视图，不要把视图名当成独立页面路由。

先用`querySelector`／`querySelectorAll`确认元素，再用`automation_element_action`执行`input`、`tap`等真实交互，随后重新读取文字、属性和数据断言结果。例如报名表队名输入的实际选择器为`#registration-team`，提交区域为`.registration-submit`。选择器以当前源码和运行时查询结果为准。

小程序页面使用微信运行时和WXML元素操作，不把网页`document.querySelector`或DOM点击脚本直接套到模拟器。`automation_page_action.getData`可辅助定位状态；`setData`、`callMethod`和`automation_evaluate`会改变运行时，不应在主要页面验收中直接设置“成功状态”来替代点击和真实请求。若诊断时使用了这些能力，记录其影响，并重新走正常路径。

`simulator_screenshot`返回截图路径后，实际打开图像核对字号、分组、遮挡和空白状态；工具返回截图成功不代表视觉验收已通过。

### 5.2 真实云调用的最小检查

通过`automation_evaluate`运行以下函数，可验证当前模拟器能否调用指定环境的`healthCheck`：

```javascript
async function () {
  wx.cloud.init({ env: 'cloud1-d6gzg20x709d7f6c1' })
  const response = await wx.cloud.callFunction({ name: 'healthCheck', data: {} })
  return response.result
}
```

调用参数是`project`、`action: "evaluate"`及字符串形式的`fnSource`。此代码会重新初始化运行时云环境，先核对共享配置，再执行。`healthCheck`返回`ok`、服务名和时间，不返回环境ID；连通成功还需结合目标环境、函数查询与实际业务读取判断，不能单凭`ok: true`认定两端环境一致。

### 5.3 按钮没反应、页面不刷新时怎么查

1. 核对当前页面、实际队名／报名记录ID、AppID、环境及dev／build产物，截图保存现场。
2. 读取按钮的禁用状态、页面阻止原因、表单字段值和加载状态；先定位“未满足条件”“事件未触发”还是“请求失败”。
3. 检查真实输入事件，尤其微信`event.detail.value`与H5输入取值差异；验证输入、失焦、键盘完成后状态均一致。参考球队解散和报名表目前的`input`／`blur`／`confirm`处理。
4. 用`get_simulator_console`和`get_simulator_network`读取缓冲日志；参数`command`可用`grep -n .`读取已有全部行。它们不是实时日志流，也不保证包含完整云函数内部过程。
5. 对照云函数返回、目标数据库状态和网页后台读取结果；请求超时时先重新读取确认写入结果，再决定是否重试。
6. 修改源码、构建后执行`simulator_refresh`或`simulator_open_page`，再查询页面和日志。刷新工具只触发操作，不代表编译成功。

怀疑旧缓存时再按当次工具定义清理对应缓存；清理、关闭窗口或重新打开可能丢失未提交表单。先保存现场，不把清缓存当作每次调试的第一步。

## 6. 如何部署与核实云端

### 6.1 固定配置来源

当前共享配置在`config/cloud-environment.json`：AppID为`wx3230f06c755cef3a`，环境为`cloud1-d6gzg20x709d7f6c1`，实际HTTP路径为**`/admin-suth`**。后续如有正式变更，以配置文件和环境文档为准。`cloud:setup`生成本机配置；还要排查其他模式的`.env.*.local`是否覆盖目标。

现有8个私有集合、4个报名索引、4个函数及头像／材料上传开关详见[环境状态](ENVIRONMENT_STATUS.md)。接手同一环境时复用这些资源，不重复初始化管理员或重新建库。

### 6.2 按改动部署

云端代码不随`git commit`、`git push`或小程序编译更新。根据实际变更部署相关函数：

- 新函数、依赖变更或无法确认增量完整性时，用`cloud_fn_deploy`完整部署单个函数；参数包括`appid`、`env`、函数目录绝对路径`path`和按需设置的`remote-npm-install`。
- 已存在函数且变更范围明确时可用`cloud_fn_inc_deploy`；`file`必须相对该函数目录。不要只上传入口，遗漏其引用的模型、存储或服务模块。
- 修改报名共享模型／存储后，先运行`node scripts/sync-registration-model.mjs`和`npm run check:registration-contract`；源在`teamManagement`，同步到`adminAuth`后按影响部署两端。
- 函数处于Creating／Updating时，查询原任务和函数状态，待Active后再决定后续操作，不连续重复部署。

### 6.3 异步确认是一个必须走完的过程

此前建集合、索引、写入和部署常返回`taskId`，同时提示`Waiting for user authorization`或`Waiting for user confirmation`。处理方式是：

1. 保存原工具名、目标环境、操作对象、`taskId`和返回状态到本机证据目录。
2. 有真实确认弹窗时，准确告诉用户需要确认哪一项；不要自行另造一次确认流程。
3. 用户处理后，对**原taskId**调用`polling_task_result`，读取最终结果；不要重新发起原写操作。
4. 若仍pending，继续适度查询并说明状态；超时不是成功，也不证明操作没有执行。
5. 最终成功后，再用资源读取和真实业务调用验证。集合创建成功不等于权限已设，部署成功不等于业务测试通过。

### 6.4 权限与配置要实际验证

本项目数据库客户端规则为`{"read":false,"write":false}`，私有存储也禁止客户端直接读写。业务经云函数授权处理。现有自动化接口不提供所有权限规则、HTTP网关和函数配置的修改能力；缺少接口时给出准确人工步骤，保存后回读或实测，不宣称工具已完成未支持的操作。

权限验证至少包含“客户端直接访问被拒绝”和“合法业务操作可成功”。账号隔离必须使用不同的真实身份，不能只改前端userId冒充第二账号。上传能力依赖云变量和超时配置，当前值见环境文档；不要为修复上传而开放公共写入。

## 7. 每一项功能如何开发

按最小完整业务流程拆分交付：

1. **明确规则。** 从Excel原编号、客户备注和已确认答复提取字段、必填、角色、状态、截止、名额、历史和异常场景。建议规则与客户明确确认分开标注；非阻塞的实现细节自行处理。
2. **确定数据和接口。** 先定义状态流转、服务端验证、可信身份、版本冲突、幂等和历史记录，再实现两端调用。前端校验用于提示，服务端仍需独立校验。
3. **实现云端。** 复用现有service和存储适配方式，针对业务边界编写有意义的测试。跨记录一致性放入事务；失败时不得留下半套状态。
4. **实现小程序与后台。** 一次完成本功能需要的填写、保存、列表／详情、管理动作及联动。UI按[UI约定](UI_GUIDELINES.md)使用清晰字号、卡片分组、就近错误提示、明确加载／空态／禁用原因和防重复提交。
5. **跑对应检查。** 先跑受影响模块，再进行相关类型、构建和浏览器验证；遇到新改动或未解决风险才扩大检查范围。纯文档修改不运行全部业务测试。
6. **部署和联调。** 核对环境，部署受影响函数，重新编译，验证正常操作、拒绝路径及跨端数据一致性。
7. **交给用户验收。** 给出入口、准备数据、操作、预期和反馈格式。已有通过分项只在受改动影响时复验。
8. **记录结果。** 同步文档和Excel，具体说明实现、技术检查、用户验证和剩余项。实际完成日期只在满足条件时填写。

必须保留的现有约束：一人管理1支球队；历史关联阻止解散；后续报名／赛程／事件引用须遵循[球队说明中的事务约束](TEAMS_DEVELOPMENT.md)，与解散流程互斥。D05待审按赛事当前人数范围审核，同时保留提交快照和审核当时规则；后续改配置不改写已通过历史。扩展D06–D08时继续遵循这些约束。

## 8. 验证分层：每一层能证明什么

| 层级 | 做法 | 能证明的范围 |
| --- | --- | --- |
| 静态与构建 | 类型检查、契约检查、两端构建 | 类型和打包有效；不能证明云端已部署 |
| 单元／服务测试 | 真实业务函数＋隔离测试存储 | 规则、权限判断、状态、幂等和事务模型的预期行为 |
| 浏览器隔离流程 | Playwright操作真实Vue页面，经本地服务执行实际handler，使用隔离存储 | 页面到服务的流程与错误反馈；不证明微信原生能力和真实云权限 |
| 真实云端联调 | 正确AppID／环境、实际部署函数、业务接口、隔离联调记录 | 实际云调用、存储、索引、配置及业务结果 |
| 微信模拟器 | 真实输入／点击、wx API、截图和日志 | 编译产物、小程序运行时和云调用路径 |
| iPhone用户验收 | 微信预览实际操作 | 原生文件选择／打开、头像、键盘、滚动、可读性与客户业务体验 |

浏览器测试中替换的微信传输和文件选择只属于测试适配。使用mock时记录范围并恢复；mock成功不写成真实上传、第二微信账号或手机验收通过。

### 8.1 常用检查命令

从仓库根目录执行，按改动范围选择：

```bash
npm run typecheck
npm run typecheck:admin
npm run check:registration-contract
npm test
npm run build:mp-weixin
npm run build:admin
```

报名专项可单独运行：

```bash
node --import tsx --test tests/registrations.test.ts tests/registration-cleanup.test.ts
npm run test:registrations:browser
```

其他浏览器专项为`test:admin:browser`、`test:competitions:browser`、`test:teams:browser`。`test:e2e`读取已启动的H5，先启动`dev:h5`；它默认访问5173。

当前专项脚本使用Playwright的`channel: 'chrome'`，需本机可用的Chrome；部分脚本还依赖`openssl`生成临时本地证书。缺少依赖时按脚本和错误处理，不凭浏览器包已安装就假定Chrome可用。

| 脚本 | 测试页面端口 | 默认证据目录 |
| --- | --- | --- |
| `verify-admin.mjs` | 以脚本启动配置为准 | `artifacts/admin/` |
| `verify-competitions.mjs` | 后台5176、公开端5178 | `artifacts/competitions/` |
| `verify-teams.mjs` | 后台5186、用户端5188 | `artifacts/teams/` |
| `verify-registrations.mjs` | 后台5196、用户端5198 | `artifacts/registrations/browser/` |
| `verify-browser.mjs` | 默认读取5173 | `artifacts/preview/` |

专项脚本会自行启动所需本地服务并在结束时清理；不要为它们额外启动同端口副本。报告除退出码外还应核对具体checks和errors，失败时保留截图及日志。测试计数按本次结果记录，不照搬历史165项或重复累计子集。

### 8.2 真实云端测试的数据约束

真实联调会写数据库和云存储，先明确环境与授权范围。此前用户已同意使用模拟球队数据；这不等于可修改任意真实报名。

- 使用带“自动测试／联调测试”标记的独立赛事和记录，赛事默认隐藏；记录创建的准确ID和文件ID。
- 通过业务接口完成被测动作；必要的测试夹具可由管理接口准备，但直写数据库不能算创建／报名业务接口通过。
- 测试前后核对真实业务数据未变化；用户已有报名只读检查，不能顺手审批、撤销或删除。
- 用`finally`清理本次独立记录和文件，再查询确认清理结果；失败时记录剩余资源，不能仅因脚本退出就称已清理。
- 不使用无条件删除，不按宽泛名称批量删除，不清空集合。头像和材料清理保留当前引用、历史最终材料及在传输保护，先预览再按明确对象处理。

`.tools/`内历史联调脚本可能含固定ID、旧配置、旧时间和真实云端写操作，不能原样重跑。需要复用时先审查、调整为本轮独立夹具，再执行。

### 8.3 手机验证与用户反馈

本项目目前明确可用的手机是iPhone。需要Android覆盖时保留待办，不能自动标为通过。通过`create_preview_qrcode`或`auto_preview`交付最新编译版本，并标明环境、功能和本轮改动。

每一项交付给用户时都写清：**从哪个页面进入 → 使用什么测试资料 → 点击或输入什么 → 预期看到什么 → 失败时提供哪些信息**。例如“修改赛事人数5–18为2–18，打开原待审报名，按2人审核；预期无需撤销重报，审核成功，提交快照仍保留5–18”。

反馈至少包含功能编号、设备／入口、实际操作、预期与实际结果；按钮问题补完整输入文字和页面提示。用户说“审核通过已验证”只确认这一分项，不扩大为材料下载、全部名单联动或完整D05验收完成。

## 9. 证据、进度和Git如何同步

### 9.1 保留可核查证据

建议每轮在`.tools/<功能>-<日期>/`保存命令日志、部署任务及结果、测试资源清单、云端断言和清理结果；截图／浏览器报告放`artifacts/<功能>/`。记录代码版本、北京时间、环境、设备、操作、预期、实际与剩余项。

`.tools/`和`artifacts/`被Git忽略，新电脑不会自动取得。关键结论、覆盖范围和复现命令写入文档；需要共享证据时另行交付经过脱敏的必要文件。密码、MCP Token、管理员Bearer会话、完整个人资料和短期材料链接不写入可提交文档或报告。

### 9.2 每次交付更新哪些文件

| 文件 | 更新内容 |
| --- | --- |
| `PROGRESS.md` | 最新结果、用户明确通过范围、剩余验收、下一步 |
| `中国社超上海赛区赛事平台-开发计划与进度.xlsx` | 对应原功能编号、子任务、开发／技术验证／客户验收状态及实际日期 |
| `DEVELOPMENT_PLAN.md` | 顺序、依赖或预测日期变化；保留目标与实际的区别 |
| `VERIFICATION.md` | 本轮复现／验收步骤、技术证据和未覆盖场景 |
| 模块开发文档 | 新增字段、接口、业务规则、事务与维护方式 |
| `ENVIRONMENT_STATUS.md` | 只有资源／配置实际变化时更新，并注明验证日期 |

Excel保留29项原编号、客户原备注和“飞书需求基线”，不要因拆子任务而丢失原范围。区分“已实现”“技术检查通过”“用户分项已验证”“整项验收完成”，目标日期不充当完成日期。整理本地文档不等于重新读取或回写飞书。

不再新建同内容的每日快照、第二份计划或旧Word计划；从[项目说明](../README.md)维护现有文档。

### 9.3 Git、部署和发布分开记录

提交前核对本轮改动、`git diff --check`和暂存内容。在根目录按范围暂存；需要整仓暂存时用`git add -A`并核对，不在`docs/`中只用`git add .`漏掉源码。

用户要求提交时完成本地commit，并报告编号；要求推送时再执行push并核对远端同步状态。Git推送、云函数部署、网页托管、小程序预览、上传提审和正式发布是独立动作，分别报告结果。不得把“编译通过”写成“已上线”。

## 10. 常见问题的处理顺序

| 问题 | 优先排查 |
| --- | --- |
| 后台5174不可达 | 本地服务进程、端口及终端错误；本地网页与云端API分别判断 |
| 后台有赛事，小程序没有 | 两端环境、展示开关、公开接口、当前编译产物，再查缓存 |
| 填完整队名仍不能解散 | 当前真实队名、空格标点、input／blur／confirm、disabled原因、是否有历史关联 |
| 报名提交没反应 | submitBlockers、上传完成状态、表单事件、保存中／结果不明保护、网络和服务端响应 |
| 改了人数仍按旧范围审核 | 当前赛事配置、待审reviewRules、接口结果及两个函数部署；历史快照本来应保留 |
| 工具显示Waiting或返回taskId | 保存任务并查询原taskId，处理真实弹窗，不重复创建／部署 |
| 函数处于Creating或配置显示不一致 | 回读同环境函数状态和执行超时，待Active后验证，不靠界面旧值判断 |
| 工具看不到已登录项目 | 先查CLI、登录账户、真实工具数据目录和连接凭据，再判断是否为Linux路径兼容问题 |
| 上传或下载失败 | 私有权限、函数开关与超时、文件登记／所有者、实际接口错误；不开放公共写入 |
| 换会话找不到旧脚本或证据 | `.tools/`、`artifacts/`、`/tmp/`不随Git同步，按指南重建连接和复现 |

处理过程中持续告知用户已确认的事实、当前问题和下一步；有真实阻塞时明确来源。不能连接或缺凭据时先继续本地可完成的部分，随后准确报告未完成的云端／设备验证。

## 11. 可以直接发给新会话的接手指令

```text
请接手“中国社超上海赛区赛事平台”，按 docs/AI_DEVELOPMENT_WORKFLOW.md 的流程工作。
本机仓库根目录为 /home/ubuntu/Desktop/PROJ/MINIprogram/MINIprogram；换机器请使用实际克隆路径。

先检查Git状态和适用说明，阅读README.md、docs/PROGRESS.md、DEVELOPMENT_PLAN.md、
VERIFICATION.md、ENVIRONMENT_STATUS.md，以及Excel中对应功能的状态与客户原备注。
环境参数以config/cloud-environment.json为准，不操作旧环境，不重建现有管理员和集合。

读取本轮目标对应源码与测试，按当前计划的依赖顺序，完成一个完整业务流程。
优先使用会话已有微信开发者工具MCP；缺少时按指南检查本机CLI和已有连接，
不要假定/tmp脚本或旧token有效，也不要把凭据写进仓库。

代码完成后按影响运行检查和浏览器隔离测试；需要更新云端时部署相关函数，
保存并查询原taskId，验证真实模拟器、云端数据和两端联动。
使用独立且可清理的联调数据，保护用户现有记录。
手机原生能力交给用户iPhone验收，已通过子项保留，未验证项明确列出。

同步最新进度、Excel、验收步骤和模块文档，准确区分开发、技术验证与客户验收。
按我的具体指令提交或推送Git；没有明确发布授权时不上传提审或发布小程序。
不要停留在方案说明，持续完成已经授权的开发工作。
```

## 附录：没有现成MCP连接时的本地适配器模板

此模板用于Linux本机重建STDIO连接，可保存为被Git忽略的`.tools/wechat_mcp_client.py`。它不提供Token获取能力，不绕过开发者工具确认，也不自动部署任何资源。这里给出的是按此前调用协议整理的模板；本次文档编写没有重新连接或验证云端，接手后先运行只读工具确认兼容性。

`WECHATIDE_CLI`、`WECHATIDE_MCP_TOKEN`、`WECHATIDE_MCP_NODE_OPTIONS`是此模板约定的环境变量。CLI填写实际路径；Token由本机已授权连接私下配置；Linux兼容选项仅在确有需要时填写。不要把真实Token写在共享命令、日志或文档中。

```python
import json
import os
import select
import subprocess
import sys
import time


def main():
    if len(sys.argv) not in (2, 3):
        raise SystemExit('usage: wechat_mcp_client.py TOOL_NAME [JSON_ARGUMENTS]')
    cli = os.environ.get('WECHATIDE_CLI')
    token = os.environ.get('WECHATIDE_MCP_TOKEN')
    if not cli or not token:
        raise SystemExit('请先在本机私密配置CLI路径和MCP Token')
    name = sys.argv[1]
    args = json.loads(sys.argv[2]) if len(sys.argv) == 3 else {}
    env = os.environ.copy()
    if env.get('WECHATIDE_MCP_NODE_OPTIONS'):
        env['NODE_OPTIONS'] = env['WECHATIDE_MCP_NODE_OPTIONS']
    process = subprocess.Popen(
        [cli, 'mcp', '--token=' + token],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, text=True, bufsize=1, env=env,
    )

    def send(message):
        process.stdin.write(json.dumps(message, ensure_ascii=False) + '\n')
        process.stdin.flush()

    def receive(request_id, timeout=45):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError('MCP进程已退出，请核对本机连接配置')
            ready, _, _ = select.select([process.stdout], [], [], 0.5)
            if not ready:
                continue
            line = process.stdout.readline()
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if message.get('id') != request_id:
                continue
            if 'error' in message:
                raise RuntimeError('JSON-RPC返回错误，请核对工具名和入参')
            return message
        raise TimeoutError('MCP未返回结果；若已有taskId，后续查询原任务')

    try:
        send({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
            'protocolVersion': '2024-11-05', 'capabilities': {},
            'clientInfo': {'name': 'football-local-client', 'version': '1.0'},
        }})
        receive(1)
        send({'jsonrpc': '2.0', 'method': 'notifications/initialized', 'params': {}})
        request = {'jsonrpc': '2.0', 'id': 2}
        if name == 'tools/list':
            request.update(method='tools/list', params=args)
        else:
            request.update(method='tools/call', params={'name': name, 'arguments': args})
        send(request)
        response = receive(2)
        print(json.dumps(response, ensure_ascii=False, indent=2))
        if response.get('result', {}).get('isError'):
            return 1
        return 0
    finally:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)


if __name__ == '__main__':
    raise SystemExit(main())
```

在已私密配置环境变量后，先做只读探测：

```bash
python3 .tools/wechat_mcp_client.py tools/list '{}'
python3 .tools/wechat_mcp_client.py project_list '{"scope":"miniprogram"}'
python3 .tools/wechat_mcp_client.py automation_runtime_info '{"project":"/home/ubuntu/Desktop/PROJ/MINIprogram/MINIprogram","action":"currentPage"}'
```

适配器返回JSON-RPC封装。业务结果优先读取`result.structuredContent`；若没有，检查`result.content`中的文本结果及错误标记。收到taskId后遵循第6节的异步流程。不要只看脚本退出码就判断业务成功；工具返回的文本或数据如含敏感信息，保存或分享前先脱敏。
