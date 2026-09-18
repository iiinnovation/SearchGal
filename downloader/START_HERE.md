# 👋 从这里开始！

欢迎使用 **SearchGal Downloader** - 自动化下载工具

## ⚡ 30秒快速开始

```bash
# 进入目录
cd downloader

# 安装并编译
npm install && npm run build

# 开始使用！
node dist/cli.js download "千恋万花"
```

就这么简单！🎉

## 🤔 它能做什么？

输入游戏名 → 自动搜索 27+ 平台 → 智能选择最佳资源 → 自动下载

```
🔍 搜索游戏: 千恋万花
✅ 找到 22 个平台的资源

📊 资源评分 (前5):
1. [190分] 真红小站 - 直链下载, 无需登录, 自建网盘

🎯 最佳资源: 真红小站 (190分)
🔧 使用工具: DirectDownloader
⬇️  开始下载...
✅ 下载完成!
```

## 📚 我应该看什么文档？

根据你的需求选择：

### 🚀 我想马上开始使用
→ 读 [QUICK_START.md](QUICK_START.md) (5分钟)

### 🪟 我用的是 Windows
→ 读 [WINDOWS.md](WINDOWS.md) (详细安装指南)

### 🤓 我想了解架构设计
→ 读 [ARCHITECTURE.md](ARCHITECTURE.md) (Harness 模式)

### 📝 我想看更多用法
→ 读 [EXAMPLES.md](EXAMPLES.md) (实际案例)

### 📖 我想全面了解
→ 读 [INDEX.md](INDEX.md) (项目总览)

## ⚠️ 重要提示

### Windows 用户
需要先安装 **aria2c**：
```powershell
scoop install aria2
```

### macOS 用户
```bash
brew install aria2
```

### Linux 用户
```bash
sudo apt install aria2
```

## 💡 常用命令

```bash
# 下载到指定目录
node dist/cli.js download "游戏名" --dir D:\Games

# 查看所有工具
node dist/cli.js tools

# 使用自定义 API
node dist/cli.js download "游戏名" --api https://your-api.com
```

## 🆘 遇到问题？

1. 查看 [README.md](README.md) 的常见问题章节
2. 查看 [EXAMPLES.md](EXAMPLES.md) 寻找类似案例
3. 查看 [DELIVERY.md](DELIVERY.md) 了解项目完整情况

## 🎯 下一步

- ✅ 完成快速开始
- 📖 阅读你需要的文档
- 🎮 开始自动化下载！

---

**祝你使用愉快！** 🎮

有问题？所有文档都在这个目录下，随时查阅。
