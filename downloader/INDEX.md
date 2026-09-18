# 🔧 SearchGal Downloader - 自动下载工具

## 快速导航

- 📖 [项目总览](README.md)
- 💻 [Windows 快速开始](WINDOWS.md)
- 🏗️ [架构设计](ARCHITECTURE.md)
- 📝 [使用示例](EXAMPLES.md)
- 📁 [项目结构](PROJECT_STRUCTURE.md)
- ✅ [完整总结](SUMMARY.md)

## 一分钟了解

**SearchGal Downloader** 是一个基于 **Harness 架构**的自动化下载工具：

```bash
# 一条命令完成：搜索 → 评分 → 选择 → 下载
node dist/cli.js download "千恋万花"
```

### 它做什么？

1. 🔍 **自动搜索** - 调用 SearchGal API 搜索 27+ 平台
2. 🎯 **智能评分** - 根据直链/登录/网盘等因素打分
3. ⚡ **自动选择** - 选择得分最高的资源
4. 🔧 **工具匹配** - 自动调用合适的下载工具
5. ⬇️ **执行下载** - 多线程高速下载到指定目录
6. 🔄 **自动重试** - 失败时自动尝试第二选择

### 实际效果

```
🔍 搜索游戏: 千恋万花
✅ 找到 22 个平台的资源

📊 资源评分 (前5):
1. [190分] 真红小站
   直链下载, 无需登录, 自建网盘

🎯 最佳资源: 真红小站 (190分)
🔧 使用工具: DirectDownloader
⬇️  开始下载...
✅ 下载完成!
```

## 架构亮点

**Harness 模式** - 借鉴 Claude Code 的工具编排系统：

```
Harness (主控制器)
├── SearchClient      - 搜索客户端
├── ResourceScorer    - 智能评分系统
└── ToolRegistry      - 工具注册表
    ├── MagnetTool        - 磁力/BT
    ├── BaiduPanTool      - 百度网盘
    ├── AliyunPanTool     - 阿里云盘
    └── DirectDownloader  - 直链下载
```

**为什么用 Harness？**
- ✅ 模块化 - 每个工具独立开发
- ✅ 可扩展 - 添加新工具只需 3 步
- ✅ 自动化 - 自动匹配合适的工具
- ✅ 智能化 - 自动评分选择最佳资源

## 快速开始

### Windows

```powershell
# 1. 安装 aria2c
scoop install aria2

# 2. 安装依赖
cd downloader
npm install
npm run build

# 3. 使用
node dist/cli.js download "游戏名"
```

详细指南：[WINDOWS.md](WINDOWS.md)

### macOS / Linux

```bash
# 1. 安装 aria2c
brew install aria2  # macOS
sudo apt install aria2  # Linux

# 2. 安装依赖
cd downloader
npm install
npm run build

# 3. 使用
node dist/cli.js download "游戏名"
```

## 功能特性

| 特性 | 说明 |
|------|------|
| 🔍 自动搜索 | 并行搜索 27+ 平台 |
| 🎯 智能评分 | 多维度评分系统（直链+100，登录-30...） |
| 🔧 工具编排 | 自动匹配：直链/磁力/网盘 |
| ⚡ 高速下载 | aria2c 16线程 |
| 🔄 自动重试 | 失败自动换源 |
| 💾 断点续传 | aria2c 原生支持 |

## 支持的下载方式

| 类型 | 工具 | 状态 |
|------|------|------|
| HTTP/HTTPS 直链 | DirectDownloader | ✅ 全自动 |
| 磁力链接/BT | MagnetTool | ✅ 全自动 |
| 百度网盘 | BaiduPanTool | ⚠️ 半自动 |
| 阿里云盘 | AliyunPanTool | ⚠️ 半自动 |
| 夸克网盘 | - | 🚧 开发中 |
| 123网盘 | - | 🚧 开发中 |

## 使用示例

### 基础用法

```bash
# 搜索并下载
node dist/cli.js download "千恋万花"

# 指定目录
node dist/cli.js download "白色相簿2" --dir D:\Games

# 查看工具
node dist/cli.js tools
```

### 批量下载

```powershell
$games = @("千恋万花", "白色相簿2", "ATRI")
foreach ($game in $games) {
    node dist/cli.js download $game
}
```

更多示例：[EXAMPLES.md](EXAMPLES.md)

## 添加新的下载工具

只需 3 步：

```typescript
// 1. 实现接口
export class NewTool implements DownloadTool {
  canHandle(url: string): boolean { ... }
  async download(url, options): Promise<DownloadResult> { ... }
}

// 2. 注册到 Harness
this.registry.register(new NewTool());

// 3. 完成！
```

详细说明：[ARCHITECTURE.md](ARCHITECTURE.md)

## 项目结构

```
downloader/
├── src/
│   ├── cli.ts           - CLI 入口
│   ├── core/            - 核心组件
│   │   ├── Harness.ts
│   │   ├── ToolRegistry.ts
│   │   ├── ResourceScorer.ts
│   │   └── SearchClient.ts
│   ├── tools/           - 下载工具
│   │   ├── DirectDownloader.ts
│   │   ├── MagnetTool.ts
│   │   ├── BaiduPanTool.ts
│   │   └── AliyunPanTool.ts
│   └── types/           - 类型定义
└── dist/                - 编译输出
```

完整说明：[PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)

## 技术栈

- **TypeScript** - 类型安全
- **Node.js** - 运行时
- **Commander.js** - CLI 框架
- **aria2c** - 下载引擎
- **Harness 架构** - 工具编排模式

## 对比

| 特性 | SearchGal Downloader | 手动下载 | IDM |
|------|---------------------|---------|-----|
| 自动搜索 | ✅ | ❌ | ❌ |
| 智能选择 | ✅ | ❌ | ❌ |
| 多平台 | ✅ 27+ | ❌ | 部分 |
| 开源 | ✅ | - | ❌ |
| 可扩展 | ✅ | ❌ | ❌ |

## 常见问题

### Q: 需要安装什么？

A: 
- Node.js (必需)
- aria2c (推荐，用于直链和磁力)
- 网盘工具 (可选，按需安装)

### Q: Windows 如何安装 aria2c？

A: 
```powershell
scoop install aria2
```

详见：[WINDOWS.md](WINDOWS.md)

### Q: 如何添加新的网盘支持？

A: 查看 [ARCHITECTURE.md](ARCHITECTURE.md) 中的"添加新工具"章节。

## 测试验证

✅ TypeScript 编译通过  
✅ CLI 命令正常工作  
✅ 搜索功能实测成功（22 个平台）  
✅ 智能评分准确有效（190 分选中直链）  
✅ 工具匹配自动识别  
✅ 自动重试机制生效  

## 贡献

欢迎添加新的下载工具适配器！

## License

[GNU AGPL v3](../LICENSE)

---

**享受自动化下载的乐趣！** 🎮

查看完整文档：[所有文档列表](#快速导航)
