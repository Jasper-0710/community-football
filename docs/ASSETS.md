# 演示素材

## 摄影

两张图片下载到本地，不产生运行时外站图片请求。均仅作为视觉占位，不代表上海社区赛事现场。

- `src/static/images/stadium.jpg`：Unsplash image ID `photo-1522778119026-d647f0596c20`。
  来源：`https://images.unsplash.com/photo-1522778119026-d647f0596c20`
- `src/static/images/football.jpg`：Unsplash image ID `photo-1574629810360-7efbbe195018`。
  来源：`https://images.unsplash.com/photo-1574629810360-7efbbe195018`

正式发布前建议替换为主办方拥有使用权的本地比赛照片，并核对图片许可、肖像授权与品牌标识。此处不将通用球场照片宣传为真实比赛现场。

## 原创代码素材

品牌标识、8 个虚构球队队徽与线性图标由本项目代码生成，未使用真实俱乐部徽标。

- 原始队徽：`src/static/teams/*.svg`
- 前端跨端图片：`src/static/teams/*.png`、`src/static/icons/*.png`
- 生成源：`scripts/create-assets.mjs`

生成脚本属于开发辅助，不参与前端运行或构建。已生成的资源随项目保留。
