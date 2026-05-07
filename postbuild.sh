#!/bin/bash
# 编译后修复：给 import 路径加 .js 扩展名（Node.js ESM 要求）
# 说明：tsc 的 "moduleResolution": "bundler" 不添加扩展名，
# 但 Node.js 原生 ESM 导入需要完整路径。
# OpenClaw 内部有 bundler/resolver 所以无此问题，
# 此修复仅用于让测试脚本可直接用 node 运行。

for f in index.js manager-v2.js migrate.js; do
  if [ -f "$f" ]; then
    sed -i 's|from "\./\(.*\)"|from "./\1.js"|g; s|from '\''\./\(.*\)'\''|from '\''./\1.js'\''|g' "$f"
  fi
done
