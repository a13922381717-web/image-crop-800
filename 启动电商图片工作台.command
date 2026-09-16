#!/bin/zsh
cd "${0:A:h}" || exit 1
NODE_BIN="$(command -v node)"
if [[ -z "$NODE_BIN" && -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  NODE_BIN="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ -z "$NODE_BIN" ]]; then
  print '请先安装 Node.js 22 或更新版本。按回车关闭。'
  read
  exit 1
fi
"$NODE_BIN" ai-server.cjs --open
read '?服务已结束，按回车关闭。'
