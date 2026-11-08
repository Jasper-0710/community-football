# 微信云开发配置

客户环境切换执行单见 [客户云环境迁移](CUSTOMER_ENV_MIGRATION.md)。2026-11-08 已配置客户 AppID `wx3230f06c755cef3a` 和环境 `cloud1-d6gzg20x709d7f6c1`，4 个函数实际代码上传成功并为 Active；本机构建、微信预览、133 项测试及两端类型检查通过。存储桶已存在，但客户数据库/私有权限、函数超时、后台网关与业务联调尚未完成。下文原环境的成功记录不能作为客户环境验收结果。

中国社超上海赛区赛事平台采用微信云开发作为业务服务。当前已配置本机开发环境、连接检测函数及微信用户建档/资料云函数；登录和昵称已通过模拟器真实云端读写验证，真机待验证。头像因存储权限配置受免费期限制而暂不开放。后台认证、赛事资料及开关、领队建队/球员管理和后台档案已接入真实云端；新增解散功能已部署，云端条件检查及拒绝非法操作已验证，实际确认解散/重建待验。D05报名与审核已实现并部署，私有数据库/索引及查询页面通过，实际材料/报名、存储/超时与iPhone待验；赛程和赛果业务待开发，部分页面仍使用明确标注的演示数据。逐项状态见 [开发记录](DEVELOPMENT_LOG.md)。

2026-11-08 客户环境迁移进度与跨机器恢复步骤统一见 [客户环境迁移执行单](CUSTOMER_ENV_MIGRATION.md)。本文件中的历史联调结果不能当作客户环境已通过；客户数据库最后读取为空，业务配置仍待补齐。

## 需要准备的信息

| 配置 | 放置位置 | 当前情况 |
| --- | --- | --- |
| 小程序 AppID | `src/manifest.json` 的 `mp-weixin.appid` | 已切换为客户 `wx3230f06c755cef3a` |
| 云开发环境 ID | 项目根目录 `.env.local` | 已配置客户 `cloud1-d6gzg20x709d7f6c1`；构建和预览成功，业务联调待完成 |
| 开发者权限 | 微信小程序后台和云开发环境 | 使用有权限的微信账号操作 |

云开发环境需在该小程序可使用的云开发控制台开通。开通前查看套餐和资源计费规则。使用同一小程序下的开发环境即可开始联调；正式发布前配置独立的生产环境和相应的数据权限。

AppID 与环境 ID 是标识，不是管理密钥。客户端配置无需填写 AppSecret、腾讯云 SecretKey 或上传私钥。`VITE_` 开头的配置会进入小程序代码包，只放可公开的客户端配置。

## 本地配置与导入

在包含 `package.json` 的项目根目录操作：

1. 将 `.env.example` 复制为 `.env.local`，填写控制台显示的实际环境 ID：

   ```dotenv
   VITE_WECHAT_CLOUD_ENV_ID=这里填写实际环境ID
   ```

   环境 ID 留空时不初始化云开发，仍可查看现有演示页面。修改环境变量后，需要重新启动编译命令。

2. 启动微信开发编译：

   ```bash
   npm run dev:mp-weixin
   ```

   一次构建使用 `npm run build:mp-weixin`。这两个命令都会根据 `src/manifest.json` 自动生成根目录 `project.config.json`：开发模式指向 `dist/dev/mp-weixin/`，构建模式指向 `dist/build/mp-weixin/`。

3. 编译完成后，在微信开发者工具中导入**项目根目录**，也就是包含 `package.json` 和自动生成的 `project.config.json` 的目录。当前 macOS 工作区为 `/Users/jasper/MainFile/code/community-football`。首次导入前执行 `npm ci` 和 `npm run build:mp-weixin`，确保该配置指向的目录中已有 `app.json`。

   接入云开发后，用根目录作为开发者工具入口，才能同时识别编译产物和 `cloudfunctions/`。如果此前打开的是 `dist/.../mp-weixin`，改为从根目录重新导入。根目录配置中的 `miniprogramRoot` 会指定真正的小程序目录，云函数源码不会混入小程序上传目录。

4. 在开发者工具中选择与 `.env.local` 一致的云开发环境，使用支持云开发的近期稳定基础库。直接修改根目录 `project.config.json` 会在下次编译时被覆盖，持久配置应修改源配置或生成脚本。

## 检查云函数是否连通

1. 在开发者工具中找到 `cloudfunctions/healthCheck`，确认选中的是开发环境，再使用工具的上传部署功能部署该函数。首次使用时按照工具提示关联环境。此函数不读写数据库，也不返回用户身份信息。
2. 保证本次编译已填入环境 ID。在小程序调试器控制台执行：

   ```javascript
   wx.cloud.callFunction({ name: 'healthCheck' })
     .then(({ result }) => console.log(result))
     .catch(console.error)
   ```

3. 返回 `ok: true`、服务名称和时间，表示该小程序可以调用这个环境中的云函数。若报错，检查 AppID、环境 ID、开发权限和函数是否部署到了同一环境。

连接检测成功只代表云函数调用链路可用；赛事页面仍使用演示数据，不代表报名、管理后台或数据读写已经完成。H5 预览不会调用 `wx.cloud`，后续网页管理后台需要单独接入云开发 Web 能力和管理员认证。

## 后续业务配置

- 数据库：随业务实现建立赛事、球队、球员、报名、比赛事件、新闻和用户权限等集合与索引。客户端身份、队长归属和管理员权限由服务端校验。
- 云存储：配置队徽、球员图片和新闻封面的上传、读取及访问规则。
- 数据接入：在 `src/data/repository.ts` 接入真实云函数并映射数据，保留页面的统一读取入口。切换真实服务后，加载失败应显示失败状态，不用演示比分冒充正式赛果。
- 管理后台：另行开发网页端，部署到静态网站托管，通过受权限保护的云函数处理业务。
- 发布环境：开发和生产使用不同的环境 ID。可在 `.env.production.local` 设置生产环境 ID，`npm run build:mp-weixin` 的生产构建会优先读取该配置。构建命令本身不会部署云函数或发布小程序。

`.env.local`、`.env.production.local`、根目录生成的 `project.config.json` 及开发者工具私有设置均不提交 Git。源码、`.env.example`、云函数和构建脚本随仓库同步；每台电脑单独填写环境 ID 并重新构建。

## 接入验证记录（2026-11-04）

本次验证使用本机 `.env.local` 指定的开发环境。已通过开发者工具查询确认，该环境属于项目配置的小程序 AppID。

| 验证项 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build:mp-weixin` | 通过，编译产物包含配置的实际环境 ID |
| `healthCheck` 本地执行 | 返回正确的状态、服务名称和有效时间 |
| `healthCheck` 云端部署 | 成功上传 `index.js` 和 `package.json` |
| 项目导入 | 已将项目根目录导入微信开发者工具 |
| 小程序模拟器实际调用 | `wx.cloud.callFunction({ name: 'healthCheck' })` 成功，未在调用参数中覆盖环境 ID |

实际云端返回值：

```json
{
  "ok": true,
  "service": "community-football",
  "timestamp": "2026-11-04T05:20:20.528Z"
}
```

本次调用 Request ID：`5063eab8-c50d-4cd0-89a7-27b4eb08cc10`。

首次部署时，云端函数仍处于 `Creating` 状态，代码更新失败；确认状态变为 `Active` 后重新部署成功，以上调用已验证最终代码生效。本次仅验证云函数调用链路，未进行手机真机验证，也未验证业务数据库、报名或管理后台。

官方说明：[云开发介绍](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)、[开发者工具项目配置](https://developers.weixin.qq.com/miniprogram/dev/devtools/projectconfig.html)。

## 第一项：用户建档与昵称

1. 在开发环境创建 `users` 集合。数据库 → `users` → 权限设置，使用“所有用户不可读写”或自定义规则 `{"read":false,"write":false}`。这里禁止的是客户端直接访问；服务端云函数仍可按可信微信身份读写。
2. 在项目根目录执行 `npm ci`，安装前端和云函数 workspace 的本地测试依赖。部署 `cloudfunctions/userProfile`，选择“云端安装依赖”；仅构建小程序不会自动部署云函数。
3. 重新构建小程序，在“我的”中点击“微信登录”，保存昵称，退出并重新登录核对资料。接口、字段和服务端校验见 [userProfile 说明](../cloudfunctions/userProfile/README.md)。
4. 验证直接客户端读写 `users` 均被拒绝，同时云函数本人资料读写正常。微信自动附带的 `userInfo`、`tcbContext` 仅作为平台元数据忽略，身份只取 `cloud.getWXContext()`，不能使用事件里可伪造的身份。

本机若重新构建后出现昵称输入或页面文字错位，先在开发者工具清除**编译缓存**，再重新编译。11 月 4 日联调中曾发现模板缓存未更新，清理后已核对页面恢复；无需清除云端数据。

### 当前头像限制

2026-11-04 用户反馈云存储权限修改被“套餐属于免费期，无法进行此操作”阻止；实际客户端直传测试可成功，测试文件已删除。当前没有证明存储满足既定的客户端读写关闭规则，所以用户已确认：**暂不升级，先完成登录与昵称，头像待环境配置**。这不取消头像需求，也不将其登记为已验证。

`userProfile` 的服务端环境变量 `USER_PROFILE_AVATAR_ENABLED` 默认关闭。关闭时客户端隐藏选图入口，云函数也拒绝头像提交，昵称仍可正常保存；只改前端代码不能绕过云端限制。

后续在支持相应权限配置的环境中，先设置并验证云存储的客户端读写均关闭，再在云函数部署配置中设置 `USER_PROFILE_AVATAR_ENABLED=true` 并重新验证头像选择、压缩、上传、临时链接显示及 Android/iOS 真机行为。该变量属于云函数配置，不能放进 `VITE_` 客户端变量；不要为了显示头像而开放整个存储桶。

上线时需在独立生产环境重复创建集合、设置权限、配置函数及验证；开发环境中的成功结果不会自动同步到生产环境。

头像和队徽的区别、控制台配置顺序、功能补齐及真机验收见[图片上传配置说明](IMAGE_UPLOAD_SETUP.md)。

## D05 报名部署准备（11/5）

registrations、registrationFiles集合及teamManagement/adminAuth更新已完成，两个集合直读写拒绝、4个查询索引与云端查询已核验。材料上传默认关闭；必须先完成存储私有权限实测和超时配置，随后再启用。字段、索引、部署顺序与遗留事项见[报名开发说明](REGISTRATIONS_DEVELOPMENT.md)。
