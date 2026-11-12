# D08 积分榜、射手榜、助攻榜与晋级联动

更新日期：2026-11-11。

## 已实现

- 后台新增“榜单与晋级”工作区：按赛事选择已审核球队、设置分组、胜/平/负积分和单/双循环。
- 后台可录入或更正比分、比赛内进球、助攻、乌龙球和淘汰赛点球；进球数量必须与比分一致，球员必须属于参赛球队当前名单或本场已保存历史事件。
- 赛果保存、球队版本、赛事榜单版本和更正历史在同一事务中提交；请求可重试，版本冲突不会覆盖最新结果。
- 撤销赛果会恢复比赛为未完赛，保留原记录和原因，并重新计算所有榜单与晋级来源。
- 积分榜只统计已完赛小组赛，支持 0:0；排序为积分、净胜球、进球数，仍相同显示并列名次。
- 射手榜、助攻榜统计所有已完赛阶段的有效比赛进球；乌龙球、点球大战不计个人数据，比赛内点球照常计入。
- 淘汰赛可使用小组名次或前序比赛胜者作为来源。小组未完成、名次并列或来源未产生胜者时保留待定；决赛胜者可显示为冠军。
- 如果更正或撤销会改变已有后轮赛果的参赛球队，服务端拒绝操作，要求按后轮到前轮的顺序先撤销。
- 前台数据页读取公开赛事的实时榜单、射手榜、助攻榜和晋级对阵；前台赛程卡片显示正式比分、点球和已完赛状态。

## 接口

公开：`standings.getPublic`；管理：`standings.getAdmin`、`standings.updateRules`、`standings.bindMatch`、`standings.saveResult`、`standings.revokeResult`、`standings.history`。

新增集合：`resultRevisions`。比赛正式结果保存在 `matches.result`，历史版本和撤销原因保存在 `resultRevisions`；积分和个人榜单按当前有效比赛事实即时计算，不写入可过期的汇总表。

赛程写入会读取并校验榜单规则；已完赛比赛不能直接编辑赛程，必须先撤销赛果。球队引用继续遵守 `TEAMS_DEVELOPMENT.md` 的 active/version/事务契约。

## 验证

- `npm test`：184 项通过。
- `npm run test:standings:browser`：13 组隔离浏览器流程通过，覆盖未登录保护、分组、赛果事件、榜单、点球晋级、更正拦截、撤销重算、历史、失败重试和 390/320px 布局；使用隔离 HTTPS API，不是客户云端证据。
- `npm run typecheck`、`npm run typecheck:admin`、`npm run build:admin`、`npm run build:mp-weixin`：通过。

## 尚未完成

D08 源码尚未部署到客户云环境。部署仍受微信开发者工具 Service Port 关闭阻塞，需用户明确允许开启后才能上传 `standings-engine.js`、`standings-store.js`、`standings.js`、`matches.js` 和 `index.js`。

真实云端还需核对 `matches`、`resultRevisions` 的查询索引、真实已审核报名、管理员录入、公开榜单读取和 iPhone 实机展示。红黄牌、换人及技术统计仍属于后续赛果扩展，不在本批 D08 已实现范围内。
