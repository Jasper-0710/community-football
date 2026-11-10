# userProfile

本函数仅处理小程序当前微信用户的建档及个人资料，不授予领队或管理员身份。

## 请求与返回

```js
wx.cloud.callFunction({ name: 'userProfile', data: { action: 'getOrCreate' } })
wx.cloud.callFunction({
  name: 'userProfile',
  data: {
    action: 'update',
    profile: { nickname: '球迷' },
    // 仅服务端启用头像功能后可选；客户新环境已启用。
    // 纯 Base64，不带 data: 前缀；不接受外部 URL、fileID 或客户端指定路径。
    avatar: { base64: '...', format: 'png' },
  },
})
```

成功返回 `{ ok: true, profile: { id, nickname, avatarFileId, avatarUrl, avatarUploadEnabled, role, createdAt, updatedAt } }`。`avatarUploadEnabled` 必定为布尔值，表示服务端是否已开放头像能力。默认关闭；客户新环境在2026-11-09配置并验证后已启用。关闭状态下任何携带顶层 `avatar` 的请求均返回 `AVATAR_UNAVAILABLE`，不会上传文件或写入昵称/头像，登录及仅昵称保存正常可用。关闭时响应中的 `avatarFileId`、`avatarUrl` 均返回空串，不签发旧头像地址，也不删除或改动云端原有文件及引用；无头像时两个头像字段同样为空串。启用且已有头像时，由服务端为当前用户签发最长 600 秒的临时 HTTPS 地址，不能持久保存该地址，过期后重新读取用户资料。返回字段不包含 OPENID、APPID 或其他内部数据。

角色初始为 `user`；已有的 `user`、`leader`、`admin` 角色由服务端保留，未知角色拒绝读取和更新。用户自行传入身份、角色、时间戳、文件路径等字段均被拒绝。昵称去除首尾空格后为 1–30 个 Unicode 码点，不允许控制字符、不可见格式控制字符或孤立代理项。首次建档昵称为空，修改时不可提交空昵称。

兼容微信调用链附加的顶层 `userInfo`、`tcbContext` 元数据：两项字段完全忽略，不读取、不保存、不用作身份、权限或目标环境来源；即使客户端伪造其中的 `openId`、`OPENID`、`appId`、`role`、`env` 或嵌套对象，操作仍仅作用于 `cloud.getWXContext()` 确认的当前用户和部署环境。其他额外业务字段仍拒绝。2026年11月4日真实调用诊断确认事件键为 `action,tcbContext,userInfo`（requestID `7eee1235-c0dc-4f70-9bf8-e8eae3b55b48`）；诊断返回已移除，错误恢复为不含事件字段信息的固定消息。可信身份的获取方式遵循[微信云函数获取用户信息说明](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/guide/functions/userinfo.html)。

头像上限为 256 KiB，仅接受 PNG/JPEG，校验 Base64 编码、大小、文件签名并进行真实图片解码；截断或不可解码的图片拒绝保存。宽高各不超过 2048 像素，总像素不超过 400 万。PNG 在解码前核验 IHDR 尺寸与完整块结构，并按扫描行大小限制解压输出（包括 Adam7 交错图片）；随后由 `pngjs@7.0.0` 检查 CRC 并解码。JPEG 使用 `jpeg-js@0.4.4` 严格解码，限制 4MP 和 32MiB 解码内存，解码后再次检查尺寸和像素数据。云存储路径为 `users/<可信身份哈希>/avatars/<随机文件名>`。图片格式校验不代替内容审核；正式运营的内容处理按发布计划另行落实。

失败返回 `{ ok: false, error: { code, message } }`。错误码包括 `AUTH_REQUIRED`、`APP_MISMATCH`、`INVALID_ARGUMENT`、`INVALID_NICKNAME`、`AVATAR_UNAVAILABLE`、`INVALID_AVATAR`、`PROFILE_UNAVAILABLE`、`SERVICE_UNAVAILABLE`。云端异常不返回成功或演示用户。新头像上传或签名失败在写入前报错，不替换原头像；已保存头像签名失败则返回成功的个人资料、原avatarFileId和空avatarUrl，前端显示默认图案并允许重试，不能阻断登录或昵称保存。遇到保存请求超时，实际写入可能已经成功，应重新读取后确认，不以本地状态推测数据库结果。

## 环境与数据配置

- 在选定云环境提前建立 `users` 集合。集合不存在、网络故障或数据库拒绝操作均应报错，不由函数自动创建集合。
- `users` 集合的客户端读取和写入均关闭：`{"read": false, "write": false}`。云函数通过服务端 SDK 访问，客户端只调用本函数。
- 默认检查可信 `cloud.getWXContext()` 中的 APPID 为 `wx3230f06c755cef3a`。只有部署端环境变量 `WECHAT_APP_ID` 可覆盖该值，不接受客户端覆盖。缺少可信 APPID/OPENID 的控制台调用或其他来源不能创建档案。
- `_id` 为 `sha256(APPID + ':' + OPENID)`，使用数据库内置 `_id` 唯一索引，无需额外索引。私有字段 `appId`、`openId` 只在云端保存。
- 使用 `db.runTransaction` 完成查档、创建和更新；首次并发调用不重复建档，重新进入不会覆盖旧资料。更新只修改昵称、可选头像和更新时间，不覆盖角色及其他业务字段。同一可写字段的并发更新以最后成功提交为准。
- 头像能力默认关闭。仅在环境支持云存储客户端读写关闭、已实际配置权限并验证客户端直接访问被拒绝、服务端上传及本人图片显示通过后，才可由部署端设置 `USER_PROFILE_AVATAR_ENABLED=true`。仅精确字符串 `true` 启用，其他值或未配置均关闭；小程序请求、`userInfo` 和 `tcbContext` 不能覆盖此开关。2026-11-09用户配置后，客户新环境客户端直接上传已实测被拒绝（-503002），userProfile超时回读20秒；service.js与index.js均确认部署成功。截图确认变量值曾为大写TRUE，用户改为精确小写true后实际调用返回开关true。真实头像保存/重新读取、签名下载HTTP 200且字节一致、客户端直接读取/签发链接/覆盖/删除拒绝和模拟器显示均通过；测试后原资料已恢复、云端测试图片已清理。iPhone原生选择/保存/退出重登仍待用户验收。旧环境“暂不升级”的历史决定不代表新环境受套餐限制。
- 启用头像后，云存储客户端读写必须保持关闭，本函数通过服务端 SDK 上传和签发本人头像临时地址。不要为使头像显示而放开整个存储桶读写。
- 函数采用 `cloud.DYNAMIC_CURRENT_ENV`，必须部署到小程序配置的同一环境；安装本目录锁定的 `wx-server-sdk`、`pngjs` 和 `jpeg-js` 依赖。
- 文件上传和数据库事务不是同一个原子操作。更新头像生成不可变的新文件；保存失败或替换后的旧文件暂时保留，不在状态不确定时删除可能仍被引用的图片。后续清理应以当前档案引用和保留期为依据，不能按一次错误响应立即删除。

## 验证

从项目根目录运行 `node --import tsx --test tests/user-profile.test.ts`。行为测试注入可信上下文、事务数据库和云存储替身，覆盖并发/重复建档、身份隔离、越权字段、资料保留、输入边界及云端故障；图片使用真实解码依赖，覆盖有效 PNG/JPEG、有效交错 PNG、截断图片、超大尺寸及小尺寸头携带异常解压内容。

本地测试不代替真实云函数、数据库权限、云存储签名及手机验证。图片测试在模拟的已配置安全环境中显式启用头像能力；默认关闭场景单独验证头像请求无上传、无写入和昵称继续可用。部署后先验证登录、昵称与客户端直接数据库访问被拒绝；头像仅在完成上述环境配置后另行启用及验收。

2026-11-09个人头像补齐：客户端按尺寸和体积压缩；云端已存图片签名失败降级；前端自动/手动重试不清空草稿并隔离过期请求。配置及iPhone操作见[个人头像与球队队徽](../../docs/IMAGE_UPLOAD_SETUP.md)。本地头像相关44项、全量149项测试通过，前端类型检查和小程序/H5构建通过；客户新环境真实上传/重读/签名下载和客户端直接访问限制、模拟器显示已技术验证，iPhone原生选图与退出重登仍待用户验收。
