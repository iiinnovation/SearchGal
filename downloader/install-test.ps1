# SearchGal Downloader - 安装测试脚本 (Windows)

Write-Host "🚀 SearchGal Downloader 安装测试" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# 检查 Node.js
Write-Host "📦 检查 Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ 未安装 Node.js" -ForegroundColor Red
    Write-Host "请访问: https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# 检查 npm
Write-Host "📦 检查 npm..." -ForegroundColor Yellow
try {
    $npmVersion = npm --version
    Write-Host "✅ npm $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ 未安装 npm" -ForegroundColor Red
    exit 1
}

# 安装依赖
Write-Host ""
Write-Host "📥 安装依赖..." -ForegroundColor Yellow
npm install
Write-Host "✅ 依赖安装完成" -ForegroundColor Green

# 编译项目
Write-Host ""
Write-Host "🔨 编译项目..." -ForegroundColor Yellow
npm run build
Write-Host "✅ 编译完成" -ForegroundColor Green

# 检查编译产物
Write-Host ""
Write-Host "📁 检查编译产物..." -ForegroundColor Yellow
if (!(Test-Path "dist\cli.js")) {
    Write-Host "❌ 编译失败：找不到 dist\cli.js" -ForegroundColor Red
    exit 1
}
Write-Host "✅ 编译产物正常" -ForegroundColor Green

# 测试 CLI
Write-Host ""
Write-Host "🧪 测试 CLI..." -ForegroundColor Yellow
node dist/cli.js tools
Write-Host ""

# 检查下载工具
Write-Host "🔧 检查下载工具..." -ForegroundColor Yellow

# 检查 aria2c
try {
    $aria2Version = aria2c --version 2>$null | Select-Object -First 1
    Write-Host "✅ $aria2Version" -ForegroundColor Green
} catch {
    Write-Host "⚠️  未安装 aria2c (推荐)" -ForegroundColor Yellow
    Write-Host "   安装方法: scoop install aria2" -ForegroundColor Gray
}

# 检查 wget
try {
    $wgetVersion = wget --version 2>$null | Select-Object -First 1
    Write-Host "✅ $wgetVersion" -ForegroundColor Green
} catch {
    Write-Host "⚠️  未安装 wget (可选)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "🎉 安装完成！" -ForegroundColor Green
Write-Host ""
Write-Host "使用方法："
Write-Host '  node dist/cli.js download "游戏名"' -ForegroundColor White
Write-Host '  node dist/cli.js download "游戏名" --dir D:\Games' -ForegroundColor White
Write-Host ""
Write-Host "查看文档："
Write-Host "  cat INDEX.md" -ForegroundColor White
Write-Host ""
