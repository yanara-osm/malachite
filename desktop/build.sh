#!/bin/bash
# 孔雀翎 · Malachite 打包脚本：前端静态导出 → Electron 壳 → electron-builder 单文件 exe
# 用法：bash desktop/build.sh
set -e
cd "$(dirname "$0")/.."

# 1. 构建前端静态导出（带代理下载字体）
echo "==> 1/3 构建前端静态导出…"
cd web
HTTPS_PROXY=http://127.0.0.1:7891 HTTP_PROXY=http://127.0.0.1:7891 npx next build
cd ..

# 2. 复制 out 到 desktop（Electron 壳 serve 它）
echo "==> 2/3 复制静态产物…"
rm -rf desktop/out
cp -r web/out desktop/out

# 3. electron-builder 打包单文件 exe
echo "==> 3/3 electron-builder 打包…"
cd desktop
HTTP_PROXY=http://127.0.0.1:7891 HTTPS_PROXY=http://127.0.0.1:7891 \
  ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
  npx -y electron-builder --win
cd ..

echo ""
echo "✅ 完成：desktop/dist/Malachite-0.1.0-portable.exe"
