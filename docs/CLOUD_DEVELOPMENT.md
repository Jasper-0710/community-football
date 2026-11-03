# 微信云开发配置

中国社超上海赛区赛事平台采用微信云开发作为后续业务服务。当前已准备客户端初始化、云函数源码目录和连接检测函数；赛事页面仍读取本地演示数据，管理后台、登录建档、报名及正式数据库接口尚未实现。

## 需要准备的信息

| 配置 | 放置位置 | 当前情况 |
| --- | --- | --- |
| 小程序 AppID | `src/manifest.json` 的 `mp-weixin.appid` | 已配置 `wx52f6e75968af08d3` |
| 云开发环境 ID | 项目根目录 `.env.local` | 尚待填入实际环境 ID |
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

3. 编译完成后，在微信开发者工具中导入**项目根目录**，也就是包含 `package.json` 和自动生成的 `project.config.json` 的目录。Ubuntu 本机为 `/home/ubuntu/Desktop/PROJ/MINIprogram/MINIprogram`。

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

官方说明：[云开发介绍](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)、[开发者工具项目配置](https://developers.weixin.qq.com/miniprogram/dev/devtools/projectconfig.html)。
