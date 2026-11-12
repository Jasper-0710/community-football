# 数据与权限基础说明

项目：中国社超上海赛区赛事平台。更新日期：2026-11-05。对应需求：#3、#11、#14、#18、#25。

本文件记录用户已确认规则及据此形成的基础设计。现有云端已验证用户建档、昵称和用户资料权限；后台认证已完成本地测试、真实云函数部署及8项认证检查，管理员集合权限已实测，首个账号已开通。网页经真实HTTP网关到云数据库的7项流程已通过。D03赛事接口、私有集合和部署已完成，真实网页及模拟器联调通过；D04球队、归属及球员结构已实现并部署，集合客户端直读写权限已实测拒绝；用户授权的联调球队云端写入及后台同步已通过，D05报名结构与审核服务已部署，新增两个集合私有权限/4个索引及云端查询通过，实际材料/报名待验。

## 已确认的业务输入

| 项目 | 确认结果 | 开发与验收影响 |
| --- | --- | --- |
| 领队取得方式 | 建队成功后自动成为该球队领队 | 无领队申请审核环节；服务端在建队成功时建立归属并赋予领队身份 |
| 每名领队管理球队数 | 1 支 | 云端限制重复建队及并发创建第二支球队；前端展示本人已建球队 |
| 用户资料 | 昵称 | 沿用现有昵称编辑；首次微信建档允许尚未填写昵称 |
| 领队资料 | 联系电话 | 纳入领队建队资料；不通过公开球队接口返回联系电话 |
| 球队资料 | 队名、所属区、队徽、介绍 | 纳入建队及球队编辑表单 |
| 球员资料 | 姓名、球衣号码、位置 | 纳入球员增改及名单展示 |
| 首期管理员 | 先开通 1 个管理员账号 | 后台仍按账号密码与独立会话实现；首期不增加管理员管理页面 |
| 可用测试设备 | 只有 iPhone | 优先开展 iPhone 真机验证；Android 继续保留待验证，不填写通过 |

11/5用户明确采用D04建议规则：队名、所属区、领队电话必填，介绍选填；球员姓名、号码、位置必填，号码1–99且同队唯一，位置为门将/后卫/中场/前锋；队徽先用默认图案，上传待环境配置。首次微信建档仍允许空昵称，建队前须填写。长度边界与完整接口见[球队开发说明](TEAMS_DEVELOPMENT.md)。

头像沿用此前决定：暂不升级云套餐，客户端入口和云端头像写入保持关闭。D04已确认使用默认队徽；上传需求保留，环境配置并验证后开放。

## 用户数据现状

| 集合 / 字段 | 含义与现状 |
| --- | --- |
| users._id | 已实现：sha256(APPID + ':' + OPENID)，使用内置唯一标识实现幂等建档 |
| users.appId / openId | 已实现：仅服务端保存；身份来自可信微信调用上下文 |
| users.nickname | 已实现：首次可为空；编辑后去除首尾空格，1–30个Unicode码点，拒绝控制字符 |
| users.avatarFileId | 已有代码，当前头像能力关闭；不等于头像已验收 |
| users.role | 已实现：首次为user；客户端不得修改角色；D04在建队事务内授予leader，客户端不能自授 |
| users.createdAt / updatedAt | 已实现：服务端维护时间，不能由客户端指定 |
| users.phone | D04已实现：领队联系电话，与球队资料在同一事务更新；仅本人及授权管理员读取 |

现有客户端 `UserProfile` 对象只接收公开给本人的资料，不返回appId/openId。users客户端直接读取和写入均关闭，继续通过云函数访问。

## 管理员数据现状（D02）

首期采用 `adminAccounts/primary` 单文档，保存账号、PBKDF2密码记录、凭据版本、限流计数及最多5个会话摘要；不另建 `adminSessions`。数据库事务维护登录、失败锁定和退出撤销。客户端直接读写必须全部关闭，权限实测通过前不导入账号。

密码使用PBKDF2-HMAC-SHA256、600,000次迭代和随机盐；随机会话令牌仅将SHA-256摘要保存到数据库，固定8小时到期。后台通过独立会话校验，不信任微信用户角色或浏览器存储中伪造的管理员信息。准确字段和接口见 [adminAuth说明](../cloudfunctions/adminAuth/README.md)。本地测试已通过，云端验证进度见开发日志。

## 数据结构与后续草案

teams、leaderTeamBindings、players及competitions已实现；四个集合客户端直读写权限均实测拒绝。其余为后续技术方案。每个功能实施时补充精确字段类型、索引、状态转换和输入边界；业务规则未确认的部分不硬编码。

| 集合 | 主要字段 | 关联与约束 |
| --- | --- | --- |
| teams | _id、leaderUserId、name、district、contactPhone、badgeFileId、description、roster、version、creationRequestId/creationFingerprint、createdAt/updatedAt | D04已实现；首次ID为t_+用户ID，重建使用请求派生ID；status为active/dissolved，roster保留当前或解散时名单快照；队徽当前为空；事务限制归属和版本 |
| leaderTeamBindings | _id=用户ID、teamId、lastTeamVersion、lastDissolution | 以用户ID作为唯一键，建队事务内占用，防止并发创建多队；仅服务端维护 |
| players | _id、teamId、name、number、position、createdAt、updatedAt | 球员归属teams；D04已实现1–99同队唯一及四位置；status为active/removed；与teams.roster同事务提交，移出后保留档案 |
| competitions | _id、name、description、format、displayEnabled、registrationEnabled、registrationStartAt、registrationEndAt | 展示与报名开关独立；赛制、队伍名额及报名限制按后续确认配置 |
| registrations | _id、competitionId、teamId、ownerUserId、form、attachments、competitionSnapshot、status、review、version、history | D05保存五项报名字段与材料快照；待审/通过/驳回/撤销，人数依据材料审核；已部署，实际报名与材料待验 |
| registrationFiles | _id、ownerUserId、competitionId、name、size、extension、status、chunks、fileID、expiresAt、registrationId | D05私有分段上传会话与最终文件注册；服务端校验所有权，授权后签发短期链接；默认停用至权限验证 |
| matches | _id、competitionId、stage、round、groupId、slot、homeTeamId、awayTeamId、homeFrom/awayFrom、homeQualification/awayQualification、scheduledAt、venue、status、result、version、updatedAt | D06/D08 已实现；比分与有效进球事件保存在 result，淘汰赛点球保存在 result.penalties；已完赛比赛不能直接改赛程 |
| resultRevisions | _id、competitionId、matchId、version、result、previousResult、revoked、reason、operator、fingerprint、createdAt | D08 已实现；更正/撤销在同一赛事版本事务中写入，榜单按当前有效结果重算；红黄牌、换人和技术统计待后续扩展 |
| articles | _id、category、title、coverFileId、body、published、pinned、publishedAt | 五类内容及发布状态服务首页、列表与搜索 |
| favorites | userId、teamId、createdAt | 用户与球队关联唯一，用于后续跨设备收藏 |

当前 `src/domain/types.ts` 是演示展示模型，不能直接当作生产集合：例如球队固定A/B分组、五个导航和原型新闻分类均仍需按已确认需求改造。接入时通过数据层映射，保持各页面读取同一份业务结果。

## 权限约定与建队流程

| 身份 | 可执行操作 | 服务端依据 |
| --- | --- | --- |
| 游客 | 读取允许公开的赛事、新闻、赛程、赛果及榜单 | 公开查询接口和展示状态；不直接开放业务集合读写 |
| 普通微信用户 | 读写本人已开放资料，按规则创建一支球队 | 微信可信身份及本人用户ID；拒绝传入角色或冒充他人 |
| 球队领队 | 管理本人球队及球员，提交本人球队报名 | 根据团队归属校验；仅有role=leader不足以操作任意球队 |
| 后台管理员 | 执行已开放的后台管理操作 | 独立后台账号及有效会话；微信资料中的admin字符串不自动产生后台会话 |

建队实施顺序：校验微信身份及资料 → 事务读取本人绑定 → 无球队时创建球队、写入唯一绑定并更新领队身份 → 事务成功后返回。事务失败时不能只留下领队身份或孤立球队；重试返回已建队或明确冲突，不创建第二支球队。

11/5用户确认补充领队解散：无报名/赛程/成绩关联时，核对队名后归档、释放绑定并允许重建；一次只管理一支active球队。转让和管理员代建仍未开放。解散及后续业务引用的事务契约见TEAMS_DEVELOPMENT.md的D04追加节。

## 验证安排

| 验证内容 | 当前记录 / 后续安排 |
| --- | --- |
| 微信登录、昵称、退出重登、异常提示 | 模拟器真实云端联调已通过；接下来使用iPhone操作并记录机型、iOS及微信版本 |
| 多账号隔离 | 真实第二微信账号尚未提供验证结果；与设备是否具备分开记录 |
| 同一账号跨设备一致性 | 尚未完成；待实际第二设备具备后验证，不能用单设备重登替代 |
| Android | 暂无设备，待安排；保留发布前验证要求 |
| 建队自动领队及一队限制 | 110项本地测试中新增13项球队测试及9组浏览器联调通过；云端部署、权限、读取与非法输入已验证，真实球队云端写入及两端同步已通过，真机待验 |
| 后台单管理员认证 | D02本地服务/客户端24项测试、10项隔离存储浏览器流程、8项真实云函数检查及7项真实HTTPS网页流程通过；后续业务接口权限随开发继续验证 |

D04球队结构已实现并部署；D05报名结构已部署，集合权限/索引与查询通过，实际材料/报名待验。本次另已完成用户授权的联调球队真实云端写入及两端同步验证，真机遗留项继续跟踪。

## D03赛事数据实现

赛事结构及接口已实现于 `cloudfunctions/adminAuth/competitions.js`。ID为`c_`加32位随机创建标识；云端保存创建指纹防重复、version防并发覆盖，公开数据采用白名单投影。必填资料为名称、介绍、赛制类型及说明、赛事日期地点和参赛要求；报名时间可成对暂空，但开启报名须补齐。创建默认隐藏、报名关闭，两个开关独立。

报名状态按服务器时间计算，截止时刻即关闭；输入与展示采用北京时间，存储UTC ISO时间。D03只返回状态，实际球队报名由D05校验。赛事积分和晋级规则按D08实现。

开发环境已写入一条明确标注的联调赛事并完成真实网页与模拟器验证，现已隐藏并关闭报名。competitions客户端直读写均返回-502003 Permission denied。状态与证据见开发日志及 [赛事说明](COMPETITIONS_DEVELOPMENT.md)。

## D04实现及验证来源

精确字段、接口、事务约束、只读后台档案范围及验收步骤见[球队开发说明](TEAMS_DEVELOPMENT.md)。当前名单嵌入teams，球员历史保存在players；D05按新确认的简化表单保存报名资料与不可变附件快照，参赛名单在材料中提供，不能用当前球队名单自动覆盖已提交材料。

## D05 新确认范围与实现边界

11/5确认：五项文字资料与附件，后台审核后生效；名额/人数按赛事配置；截止前可改撤销、截止后锁定、撤销释放名额。关联已有球队、待审占位、驳回释放、修改重审及附件数量格式属于当前建议实现，等待进一步确认。参赛人数在后台按材料核对，跨队唯一身份识别未实现。详见[报名开发说明](REGISTRATIONS_DEVELOPMENT.md)。
