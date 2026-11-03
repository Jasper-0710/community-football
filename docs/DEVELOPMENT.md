# Git 与跨电脑开发

Git 仓库根目录是包含 `package.json`、`package-lock.json` 和 `src/` 的这一层。Ubuntu 上当前路径为 `/home/ubuntu/Desktop/PROJ/MINIprogram/MINIprogram`，其他电脑可以克隆到任意开发目录。

## 同步哪些文件

- 提交源码、静态素材、`package.json`、`package-lock.json`、配置、测试及项目文档。
- `node_modules/`、`dist/`、缓存、预览截图、`__MACOSX/` 和微信开发者工具的 `project.private.config.json` 已由 `.gitignore` 排除。
- 每台电脑分别安装依赖、构建小程序。不要从另一台电脑复制 `node_modules/`，其中的原生程序与操作系统和 CPU 架构有关。
- 小程序 AppID 在 `src/manifest.json` 中维护并随源码同步。需要该小程序的开发权限才能进行相应的预览、上传操作。
- 代码推送到 GitHub 和小程序上传到微信是两项独立操作；`git push` 不会发布小程序。

## 第一次上传

在 GitHub 中创建空仓库，不添加 README、.gitignore 或 License。以下命令中，把 `<仓库地址>` 替换为创建后得到的 SSH 或 HTTPS 地址。

尚未初始化的项目执行一次：

```bash
git init -b main
git add .
git diff --cached --stat
git commit -m "chore: initialize community football project"
```

已有本地提交后，连接远端并上传一次：

```bash
git remote add origin <仓库地址>
git push -u origin main
```

如果 `origin` 已存在，用 `git remote -v` 检查地址，不要重复添加。远端已有文件或提交时，先同步历史，不使用强制推送覆盖。

## 在另一台电脑开发

安装 Git、Node.js 22（含 npm）及适用于该系统的微信开发者工具。`.nvmrc` 记录 Node 主版本；Linux/macOS 使用 nvm 时可在克隆后执行 `nvm install` 和 `nvm use`，Windows 可安装同一主版本。

```bash
git clone <仓库地址> community-football
cd community-football
npm ci
npm run dev:mp-weixin
```

保持开发命令运行，在微信开发者工具中导入 `dist/dev/mp-weixin`。源码更新后，uni-app 会重新编译，开发者工具读取更新后的产物。

如果只需要一次构建：

```bash
npm run build:mp-weixin
```

此时导入 `dist/build/mp-weixin`。在 `src/` 中修改源码；直接改 `dist/` 会被下次构建覆盖。

也可以运行 `npm run dev:h5`，在浏览器打开 `http://127.0.0.1:5173/` 快速预览。H5 预览不能替代微信开发者工具和真机验证。

## 每次开始开发

在没有未提交修改时，先同步远端：

```bash
git status
git pull --ff-only
npm ci
npm run dev:mp-weixin
```

依赖锁文件没有变化且本机依赖已安装时，可以跳过 `npm ci`。同一工作目录中的依赖安装与构建按顺序运行。

## 修改后提交

先停止开发命令（终端中按 Ctrl+C），再检查和构建：

```bash
npm run typecheck
npm test
npm run build:mp-weixin
git status
git add .
git diff --cached --stat
git commit -m "feat: 描述这次修改"
git push
```

新增或升级依赖时使用 `npm install`，把 `package.json` 和 `package-lock.json` 一起提交。另一台电脑拉取后运行 `npm ci`。

建议每次换电脑前提交并推送，换到另一台电脑后先拉取。如果两台电脑都产生了新提交，`git pull --ff-only` 会停止，可在工作区干净时使用 `git pull --rebase` 同步；遇到冲突先解决对应文件，再执行 `git add <冲突文件>` 和 `git rebase --continue`。需要退出本次变基可执行 `git rebase --abort`。

## Git 身份与访问

新电脑第一次提交前配置自己的提交姓名和邮箱；省略 `--global` 可仅配置当前仓库：

```bash
git config --global user.name "你的姓名"
git config --global user.email "你的 GitHub 已验证邮箱"
```

SSH 仓库地址需要该电脑已配置 GitHub SSH 访问。HTTPS 地址使用 GitHub 支持的凭据管理器或令牌登录，不使用 GitHub 账号密码直接推送，也不要把令牌写进仓库地址或项目文件。
