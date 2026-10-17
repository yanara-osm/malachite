#!/bin/bash
# 从 node_modules 复制 onnxruntime-web 的 wasm 运行时到 public/（这些文件不进 git）
# 用法：bash scripts/setup-ort-wasm.sh
# 注意：onnxruntime-web 的 WebGPU 后端需要 asyncify + jsep 两个 wasm 变体
cd "$(dirname "$0")/.." || exit 1

SRC="node_modules/onnxruntime-web/dist"
DST="public"

if [ ! -d "$SRC" ]; then
  echo "先 npm install 再跑本脚本"
  exit 1
fi

copied=0
for f in "$SRC"/ort-wasm-simd-threaded.*.mjs "$SRC"/ort-wasm-simd-threaded.*.wasm; do
  if [ -f "$f" ]; then
    cp "$f" "$DST/" && copied=$((copied+1))
  fi
done

echo "已复制 $copied 个 ort-wasm 文件到 $DST/"
echo "缺 WebGPU 后端会报 'no available backend found'，缺 asyncify 会报 'Failed to fetch ... asyncify.mjs'"
