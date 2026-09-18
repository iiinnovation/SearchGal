# 🚀 快速开始 - 5分钟上手

## 最快路径

### Windows 用户

```powershell
# 1. 安装 Scoop (如果还没有)
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
Invoke-RestMethod get.scoop.sh | Invoke-Expression

# 2. 安装 aria2c
scoop install aria2

# 3. 进入项目目录
cd path\to\SearchGal-main\downloader

# 4. 运行安装测试脚本
.\install-test.ps1

# 5. 开始使用！
node dist/cli.js download "千恋万花"
```

### macOS / Linux 用户

```bash
# 1. 安装 aria2c
brew install aria2  # macOS
# sudo apt install aria2  # Linux

# 2. 进入项目目录
cd path/to/SearchGal-main/downloader

# 3. 运行安装测试脚本
chmod +x install-test.sh
./install-test.sh

# 4. 开始使用！
node dist/cli.js download "千恋万花"
```

## 基础命令

```bash
# 下载游戏
node dist/cli.js download "游戏名"

# 指定下载目录
node dist/cli.js download "游戏名" --dir /your/path

# 查看可用工具
node dist/cli.js tools

# 使用其他 API
node dist/cli.js download "游戏名" --api https://your-api.com
```

## 工作原理

```
输入游戏名
    ↓
搜索 27+ 平台
    ↓
智能评分排序 (直链 > 网盘 > BT)
    ↓
自动选择最佳资源
    ↓
匹配下载工具 (DirectDownloader/MagnetTool/...)
    ↓
高速下载到指定目录 (aria2c 16线程)
    ↓
完成！
```

## 实际案例

```bash
$ node dist/cli.js download "千恋万花"

🔍 搜索游戏: 千恋万花
✅ 找到 22 个平台的资源

📊 资源评分 (前5):
1. [190分] 真红小站 - 直链下载, 无需登录, 自建网盘
2. [190分] 真红小站 - 直链下载, 无需登录, 自建网盘
3. [190分] 真红小站 - 直链下载, 无需登录, 自建网盘

🎯 最佳资源: 真红小站 (190分)
🔧 使用工具: DirectDownloader
⬇️  开始下载...

[#1 50MiB/350MiB(14%) CN:16 DL:9.2MiB ETA:32s]

✅ 下载完成!
📁 文件位置: ~/Downloads/SearchGal/千恋万花.7z
```

## 常见问题

### Q: 提示"未找到 aria2c"？

```bash
# Windows
scoop install aria2

# macOS
brew install aria2

# Linux
sudo apt install aria2
```

### Q: 下载很慢？

- 等待非高峰期
- 检查网络连接
- 尝试其他资源（系统会自动重试）

### Q: "未找到任何资源"？

- 尝试不同关键词（简短、中文、英文）
- 访问 https://searchgal.top 确认后端是否正常

### Q: 想要添加新的网盘支持？

查看 [ARCHITECTURE.md](ARCHITECTURE.md) - 只需 3 步！

## 下一步

- 📖 阅读 [INDEX.md](INDEX.md) 了解完整功能
- 🏗️ 阅读 [ARCHITECTURE.md](ARCHITECTURE.md) 了解架构设计
- 📝 阅读 [EXAMPLES.md](EXAMPLES.md) 查看更多用法
- 💻 阅读 [WINDOWS.md](WINDOWS.md) (Windows 详细指南)

## 需要帮助？

- 查看文档：`cat INDEX.md`
- 查看示例：`cat EXAMPLES.md`
- 查看架构：`cat ARCHITECTURE.md`

**开始享受自动化下载吧！** 🎮
