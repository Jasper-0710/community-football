# 原型验收记录

验收日期：2026-10-25（Asia/Shanghai）

## 已通过

- `npm run typecheck`：TypeScript / Vue 类型检查。
- `npm test`：18 项领域与数据边界测试全部通过。
- `npm run test:e2e`：15 组浏览器流程全部通过，无未捕获页面异常、无缺失本地资源。
- `npm run build:h5`：生产构建成功。
- `npm run build:mp-weixin`：微信小程序编译成功。
- 检查生成的微信组件配置：virtualHost 与 apply-shared 正确输出。
- 检查微信入口：不包含 H5 专用 document 键盘处理代码。

浏览器验收包括：桌面首页、比分与进球时间轴、日期/状态/球队筛选、休赛日重置、晋级与待定决赛、新闻与文章、积分与射手、关注持久化、搜索、键盘操作、未知比赛 ID，以及 320/390/768px 下的页面宽度与对阵图内部横向滚动。1440px 桌面与手机截图已人工查看。

## 预览截图

- `artifacts/preview/desktop-home.png`
- `artifacts/preview/mobile-home.png`
- `artifacts/preview/desktop-schedule.png`
- `artifacts/preview/desktop-bracket.png`
- `artifacts/preview/mobile-bracket-final.png`
- `artifacts/preview/match-390.png`
- `artifacts/preview/desktop-stats.png`
- `artifacts/preview/desktop-team.png`

完整流程结果见 `artifacts/preview/report.json`。

## 未验证 / 未发布

- 未在微信开发者工具中运行，未完成 iOS / Android 微信真机测试。当前环境未检测到微信开发者工具，AppID 留空。
- 没有上传、提交审核、部署公网或连接真实业务接口。
- 无障碍检查仅覆盖部分键盘交互，未声明通过完整 WCAG 审计。
- 编译器输出一条上游模块循环依赖警告，构建成功且本轮浏览器未出现应用运行错误。

原始需求表保持不变。模拟数据仅用于预览，不表示真实赛程或赛果。
