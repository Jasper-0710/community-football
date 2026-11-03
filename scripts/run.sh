#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if command -v npm >/dev/null 2>&1; then exec npm "$@"; fi
NODE_DIR="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
if [ -x "$NODE_DIR/node" ] && [ -f .tools/package/bin/npm-cli.js ]; then
  export PATH="$NODE_DIR:$PATH"
  export npm_config_cache="$PWD/.npm-cache"
  exec "$NODE_DIR/node" .tools/package/bin/npm-cli.js "$@"
fi
printf '请先安装 Node.js 20.19+ 或 22 LTS（包含 npm），然后执行 npm install。\n' >&2
exit 1
