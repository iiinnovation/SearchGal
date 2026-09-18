#!/bin/bash
# SearchGal Downloader - 安装测试脚本

set -e

echo "🚀 SearchGal Downloader 安装测试"
echo "=================================="
echo ""

# 检查 Node.js
echo "📦 检查 Node.js..."
if ! command -v node &> /dev/null; then
    echo "❌ 未安装 Node.js"
    echo "请访问: https://nodejs.org/"
    exit 1
fi
echo "✅ Node.js $(node -v)"

# 检查 npm
echo "📦 检查 npm..."
if ! command -v npm &> /dev/null; then
    echo "❌ 未安装 npm"
    exit 1
fi
echo "✅ npm $(npm -v)"

# 安装依赖
echo ""
echo "📥 安装依赖..."
npm install
echo "✅ 依赖安装完成"

# 编译项目
echo ""
echo "🔨 编译项目..."
npm run build
echo "✅ 编译完成"

# 检查编译产物
echo ""
echo "📁 检查编译产物..."
if [ ! -f "dist/cli.js" ]; then
    echo "❌ 编译失败：找不到 dist/cli.js"
    exit 1
fi
echo "✅ 编译产物正常"

# 测试 CLI
echo ""
echo "🧪 测试 CLI..."
node dist/cli.js tools
echo ""

# 检查下载工具
echo "🔧 检查下载工具..."

# 检查 aria2c
if command -v aria2c &> /dev/null; then
    echo "✅ aria2c $(aria2c --version | head -1)"
else
    echo "⚠️  未安装 aria2c (推荐)"
    echo "   macOS: brew install aria2"
    echo "   Linux: sudo apt install aria2"
    echo "   Windows: scoop install aria2"
fi

# 检查 wget
if command -v wget &> /dev/null; then
    echo "✅ wget $(wget --version | head -1)"
else
    echo "⚠️  未安装 wget (可选)"
fi

echo ""
echo "=================================="
echo "🎉 安装完成！"
echo ""
echo "使用方法："
echo "  node dist/cli.js download \"游戏名\""
echo "  node dist/cli.js download \"游戏名\" --dir ~/Downloads"
echo ""
echo "查看文档："
echo "  cat INDEX.md"
echo ""
