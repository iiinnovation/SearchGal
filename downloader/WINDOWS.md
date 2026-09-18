# SearchGal Downloader - Windows 快速开始指南

## 🎯 这是什么？

一个**自动下载工具**，输入游戏名 → 自动搜索 → 智能选择最佳资源 → 自动下载到指定目录。

**就像 Claude Code 的 Harness 架构** - 通过工具编排实现全自动化下载。

## 📦 Windows 安装步骤

### 1. 安装 Node.js

下载并安装: https://nodejs.org/ (选择 LTS 版本)

### 2. 安装包管理器 Scoop (推荐)

在 PowerShell 中运行：

```powershell
# 设置执行策略
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# 安装 Scoop
Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
```

### 3. 安装下载工具

```powershell
# 安装 aria2c (必需 - 用于直链和磁力下载)
scoop install aria2

# 安装 git (用于克隆项目)
scoop install git
```

### 4. 克隆项目

```powershell
cd ~/Desktop
git clone https://github.com/Moe-Sakura/SearchGal.git
cd SearchGal/downloader
```

### 5. 安装依赖

```powershell
# 安装 pnpm (推荐)
npm install -g pnpm

# 安装项目依赖
pnpm install

# 编译项目
pnpm build
```

## 🚀 使用方法

### 基本用法

```powershell
# 搜索并下载游戏
node dist/cli.js download "千恋万花"

# 指定下载目录
node dist/cli.js download "千恋万花" --dir "D:\Games"

# 查看所有可用工具
node dist/cli.js tools
```

### 创建快捷命令 (可选)

在 `$PROFILE` 中添加别名：

```powershell
# 编辑 PowerShell 配置文件
notepad $PROFILE

# 添加这一行
function searchgal { node "C:\path\to\SearchGal\downloader\dist\cli.js" @args }
```

然后就可以直接使用：

```powershell
searchgal download "千恋万花"
```

## 📊 工作流程示例

```powershell
PS> node dist/cli.js download "千恋万花"

🔍 搜索游戏: 千恋万花
✅ 找到 15 个平台的资源

📊 资源评分 (前5):
1. [160分] 真红小站
   直链下载, 无需登录, 自建网盘
   https://shinnku.com/api/download/...

2. [140分] VNS
   直链下载, 无需登录
   https://gal.saop.cc/download/...

3. [110分] 梓澪の妙妙屋
   无需登录, 不限速网盘, 识别为123网盘
   https://zi0.cc/api/...

4. [80分] 稻荷GAL
   无需登录, BT/磁力, 识别为磁力链接
   magnet:?xt=urn:btih:...

5. [60分] 量子ACG
   识别为百度网盘, 需要登录
   https://pan.baidu.com/s/...

🎯 最佳资源: 真红小站 (160分)
📦 下载链接: https://shinnku.com/api/download/...

🔧 使用工具: DirectDownloader
⬇️  开始下载到: C:\Users\YourName\Downloads\SearchGal

执行命令: aria2c "https://..." -d "C:\Users\..." -x 16 -s 16 -k 1M

[#1 20MiB/350MiB(5%) CN:16 DL:8.5MiB ETA:38s]

✅ 下载完成!
📁 文件位置: C:\Users\YourName\Downloads\SearchGal\千恋万花.zip
```

## 🔧 支持的下载方式

| 类型 | 状态 | 说明 |
|------|------|------|
| ✅ 直链 | 完全自动 | 使用 aria2c 多线程下载 |
| ✅ 磁力/BT | 完全自动 | 使用 aria2c，自动做种 |
| ⚠️ 百度网盘 | 半自动 | 需要安装 BaiduPCS-Go 并手动操作 |
| ⚠️ 阿里云盘 | 半自动 | 需要安装 aliyunpan 并手动操作 |
| 🚧 夸克网盘 | 开发中 | - |
| 🚧 123网盘 | 开发中 | - |

## 🎯 智能评分规则

系统会自动评估所有资源，优先选择最佳的：

```
直链下载 (100分)
  ↓ 最优先
无需登录 (+50分)
  ↓
自建网盘/不限速网盘 (+30-40分)
  ↓
BT/磁力链接 (+20分)
  ↓
限速网盘 (+10分)
  ↓
需要登录 (-30分)
  ↓
需要魔法 (-20分)
```

## 📝 百度网盘手动操作指南

如果最佳资源是百度网盘，工具会提示：

```powershell
❌ 下载失败: 百度网盘需要手动操作:
1. 运行: BaiduPCS-Go
2. 使用命令: share https://pan.baidu.com/s/xxxxx 提取码
3. 保存到网盘后使用 cd 和 download 命令下载

🔄 尝试下一个资源...
```

系统会自动尝试评分第二的资源。

### 安装 BaiduPCS-Go (可选)

1. 下载: https://github.com/qjfoidnh/BaiduPCS-Go/releases
2. 解压到任意目录
3. 将目录添加到 PATH 环境变量
4. 运行 `BaiduPCS-Go` 并按提示登录

## ⚙️ 高级配置

### 自定义下载目录

```powershell
# 方法1: 命令行参数
node dist/cli.js download "游戏名" --dir "D:\MyGames"

# 方法2: 修改默认目录 (编辑 cli.ts)
.option('-d, --dir <path>', '下载目录', 'D:\\MyGames')
```

### 自定义 API 地址

```powershell
# 使用自己部署的 SearchGal API
node dist/cli.js download "游戏名" --api "https://your-api.com"
```

## ❓ 常见问题

### Q: 下载速度很慢怎么办？

A: aria2c 已经默认使用 16 线程，如果还是慢：
- 检查网络连接
- 尝试使用代理（如果资源需要魔法访问）
- 等待高峰期过后再下载

### Q: 提示"未找到任何资源"？

A: 
- 尝试使用不同的关键词（中文/日文/英文）
- 检查搜索的游戏名是否正确
- 访问 https://searchgal.top 确认后端 API 是否正常

### Q: Windows 提示"无法加载文件"？

A: 执行：
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Q: 如何取消下载？

A: 按 `Ctrl+C` 终止程序，aria2c 会保存断点信息。

## 🌟 特色功能

### 1. 智能评分系统

自动分析所有资源，选择最佳下载源：
- 直链优先
- 免登录优先
- 不限速网盘优先

### 2. 自动重试

如果第一个资源下载失败，自动尝试第二个。

### 3. 多线程下载

默认 16 线程，充分利用带宽。

### 4. 断点续传

aria2c 原生支持，下次运行会自动继续。

## 🔗 相关链接

- SearchGal 主项目: https://github.com/Moe-Sakura/SearchGal
- 在线预览: https://searchgal.top
- aria2 文档: https://aria2.github.io/
- BaiduPCS-Go: https://github.com/qjfoidnh/BaiduPCS-Go

## 🤝 参与贡献

欢迎添加新的下载工具适配器！查看 [ARCHITECTURE.md](ARCHITECTURE.md) 了解详情。

## 📄 开源协议

[GNU AGPL v3](../LICENSE)

---

**享受自动化下载的乐趣！** 🎮
