# 🔧 SearchGal Downloader - 自动下载工具

> 基于 **Harness 架构**的智能下载工具 - 输入游戏名 → 自动搜索 → 智能选择 → 自动下载

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](../LICENSE)

## ✨ 一分钟了解

```bash
# 一条命令完成：搜索 → 评分 → 选择 → 下载
node dist/cli.js download "千恋万花"

🔍 搜索游戏: 千恋万花
✅ 找到 22 个平台的资源

📊 资源评分 (前5):
1. [190分] 真红小站 - 直链下载, 无需登录, 自建网盘

🎯 最佳资源: 真红小站 (190分)
🔧 使用工具: DirectDownloader
⬇️  开始下载...
✅ 下载完成!
```

## 🎯 核心特性

| 特性 | 说明 |
|------|------|
| 🔍 **智能搜索** | 自动调用 SearchGal API 搜索 27+ 平台 |
| 🎯 **智能评分** | 多维度评分系统（直链+100，登录-30...） |
| 🔧 **工具编排** | Harness 架构，自动调用合适的下载工具 |
| ⬇️ **自动下载** | 一条命令完成搜索+下载全流程 |
| 🔄 **自动重试** | 失败时自动尝试下一个资源 |
| ⚡ **高速下载** | 来源提供强 ETag 和完整大小时使用 aria2c 多连接，否则使用内置 Node 下载器 |

## 🚀 快速开始

### Windows

```powershell
# 1. 可选：安装 aria2c，未安装时使用内置下载器
scoop install aria2

# 2. 安装并编译
npm install && npm run build

# 3. 使用
node dist/cli.js download "千恋万花"

# 4. 需要代理时
$env:all_proxy="socks5://127.0.0.1:7897"
node dist/cli.js download "千恋万花"
```

### macOS / Linux

```bash
# 1. 可选：安装 aria2c，未安装时使用内置下载器
brew install aria2  # macOS
# sudo apt install aria2  # Linux

# 2. 安装并编译
npm install && npm run build

# 3. 使用
node dist/cli.js download "千恋万花"

# 4. 需要代理时
export all_proxy=socks5://127.0.0.1:7897
node dist/cli.js download "千恋万花"
```

**详细指南：** 
- 🪟 [Windows 完整指南](WINDOWS.md)
- 🚀 [5分钟快速开始](QUICK_START.md)
- 🌐 [代理配置指南](README-PROXY.md)
- 📖 [所有文档](INDEX.md)

## 🏗️ 架构设计 (Harness 模式)

```
Harness (主控制器)
├── SearchClient      - 搜索客户端
├── ResourceScorer    - 智能评分系统 (直链+100, 登录-30...)
└── ToolRegistry      - 工具注册表
    ├── DirectDownloader  - HTTP/HTTPS 直链 (aria2c/内置 Node)
    ├── MagnetTool        - 磁力链接/BT种子 (aria2c)
    ├── BaiduPanTool      - 百度网盘 (BaiduPCS-Go)
    └── AliyunPanTool     - 阿里云盘 (aliyunpan)
```

**设计理念：** 借鉴 Claude Code 的工具编排系统
- ✅ 模块化 - 每个工具独立实现
- ✅ 可扩展 - 添加新工具只需 3 步
- ✅ 自动化 - 自动匹配和调用工具

详细说明：[ARCHITECTURE.md](ARCHITECTURE.md)

## 📝 基础用法

```bash
# 搜索并下载
node dist/cli.js download "游戏名"

# 指定下载目录
node dist/cli.js download "游戏名" --dir D:\Games

# 使用自定义 API
node dist/cli.js download "游戏名" --api https://your-api.com

# 查看所有工具
node dist/cli.js tools
```

更多示例：[EXAMPLES.md](EXAMPLES.md)

## 🔑 LLM 解压密码智能检测（可选功能）

通过大语言模型（如 DeepSeek、OpenAI、本地 Ollama 等）在下载前智能分析网页正文：
- 自动识别资源是否属于免密或带有公开密码的可用资源；
- 识别“需加QQ群”、“需赞助付费”等套路密码并提供严格跳过或预警模式；
- 下载完成后自动高亮打印解压密码及推荐的 `7z` 解压指令。

### 配置方式

#### 方法 1：环境变量（推荐，安全防泄露）
```bash
export SEARCHGAL_LLM_API_KEY="sk-xxx"
export SEARCHGAL_LLM_BASE_URL="https://api.deepseek.com/v1"
export SEARCHGAL_PASSWORD_CHECK_ENABLED=true
```

#### 方法 2：配置文件
复制模板文件并填入 API Key：
```bash
cp downloader/.config.json.example downloader/.config.json
```
编辑 `downloader/.config.json`：
```json
{
  "llm": {
    "enabled": true,
    "provider": "openai-compatible",
    "baseURL": "https://api.deepseek.com/v1",
    "apiKey": "sk-your-api-key",
    "model": "deepseek-chat",
    "timeoutMs": 15000
  },
  "passwordCheck": {
    "enabled": true,
    "failureMode": "continue"
  }
}
```

### 使用方法

配置按字段合并，优先级为环境变量 > 用户配置 `~/.searchgal/config.json` > 项目配置 > 默认值。
未指定 `llm.enabled` 时，配置 API Key 后可通过 `--check-password` 开启检查；明确设置 `llm.enabled: false` 或 `SEARCHGAL_LLM_ENABLED=false` 会禁止 LLM 调用。
严格模式下，缺少 Key、禁用 LLM、请求失败或返回格式不合法都会跳过需要检查的网页候选。直链和专用解析器不做网页密码检查。
Windows 的解压命令示例使用 PowerShell。

```bash
# 启用密码智能检测与提取
node dist/cli.js download "千恋万花" --check-password

# 启用严格拦截模式（一旦检测到需加群/付费等障碍密码，自动跳过并尝试下一个候选）
node dist/cli.js download "千恋万花" --check-password --strict-password
```

## 🔧 支持的下载方式

| 类型 | 工具 | 状态 | 说明 |
|------|------|------|------|
| HTTP/HTTPS 直链 | DirectDownloader | ✅ 全自动 | aria2c 最多 16 连接，或内置 Node 下载器 |
| 磁力链接 | MagnetTool | ✅ 全自动 | aria2c BT下载 |
| BT 种子 | MagnetTool | ✅ 全自动 | aria2c 种子下载 |
| 百度网盘 | BaiduPanTool | ⚠️ 半自动 | 需安装 BaiduPCS-Go |
| 阿里云盘 | AliyunPanTool | ⚠️ 半自动 | 需安装 aliyunpan |
| 夸克网盘 | - | 🚧 开发中 | - |
| 123网盘 | - | 🚧 开发中 | - |

## 🎯 智能评分规则

系统会自动对所有资源打分，优先选择最佳：

```
评分因素：
  直链下载      +100 分  ⭐⭐⭐⭐⭐
  无需登录      +50 分   ⭐⭐⭐⭐
  自建网盘      +40 分   ⭐⭐⭐⭐
  不限速网盘    +30 分   ⭐⭐⭐
  BT/磁力       +20 分   ⭐⭐
  识别网盘类型  +15 分   ⭐
  限速网盘      +10 分   ⭐
  需要魔法      -20 分   ⚠️
  需要登录      -30 分   ⚠️

实际案例：真红小站直链 = 100+50+40 = 190分 (最高)
```

## 🛠️ 添加新的下载工具

只需 3 步：

```typescript
// 1. 创建工具类 (src/tools/NewTool.ts)
export class NewTool implements DownloadTool {
  name = 'NewTool';
  
  canHandle(url: string): boolean {
    return url.includes('newsite.com');
  }
  
  async download(url: string, options: DownloadOptions): Promise<DownloadResult> {
    // 实现下载逻辑
    return { success: true };
  }
}

// 2. 注册到 Harness (src/core/Harness.ts)
private initializeTools(): void {
  this.registry.register(new NewTool());
}

// 3. 重新编译
npm run build
```

详细教程：[ARCHITECTURE.md](ARCHITECTURE.md)

## 📊 验收状态

自动测试覆盖下载完整性、分卷与分页、断点续传、候选回退和 LLM 密码检查。可按下方“测试验证”运行本地测试；手动验证脚本所需的外部工具见对应命令说明。公开仓库不包含本机验证日志或外部资源下载记录，本地测试通过不代表外部站点当前可用或游戏可以运行。

HTTP 下载在已安装 aria2c、来源提供强 ETag 且完整大小已知时启用 aria2c，否则自动使用内置 Node 下载器。两条路径都校验来源、版本和大小，不凭同名、同大小就跳过下载。Node 断点信息保存为 `.part.json`；aria2 使用独立的 `.aria2.part` 文件、`.aria2.part.json` 元数据及 `.aria2.part.aria2` 控制文件。旧版断点、换源或缺少强校验器时重新下载，校验成功后才替换最终文件。

分卷下载会先组成完整方案，包含 ZIP / 旧式 RAR 的主卷；Alist 会读取全部目录分页。已知缺卷或无法读全目录时该方案失败。归档测试和解压目前由验证脚本或外部工具执行，CLI 不自动解压。

## 📚 完整文档

| 文档 | 用途 |
|------|------|
| [INDEX.md](INDEX.md) | 📖 项目总览和快速导航 |
| [QUICK_START.md](QUICK_START.md) | 🚀 5分钟快速开始 |
| [WINDOWS.md](WINDOWS.md) | 🪟 Windows 详细安装指南 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 🏗️ Harness 架构设计文档 |
| [EXAMPLES.md](EXAMPLES.md) | 📝 详细使用示例和案例 |
| [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) | 📁 项目目录结构说明 |
| [SUMMARY.md](SUMMARY.md) | ✅ 完整实现总结 |
| [DELIVERY.md](DELIVERY.md) | 📦 项目交付清单 |

## ❓ 常见问题

### Q: 提示"未找到 aria2c"？

A: 安装 aria2c：
```bash
# Windows
scoop install aria2

# macOS
brew install aria2

# Linux
sudo apt install aria2
```

### Q: 需要代理才能访问资源站？

A: 设置代理环境变量（详见 [代理配置指南](README-PROXY.md)）：
```bash
# SOCKS5 代理
export all_proxy=socks5://127.0.0.1:7897

# HTTP 代理
export https_proxy=http://127.0.0.1:7897
```

### Q: 下载速度很慢？

A: 
- 等待非高峰期
- 检查网络连接
- 系统会自动重试其他资源

### Q: "未找到任何资源"？

A:
- 尝试不同关键词（简短/中文/英文）
- 确认后端 API 是否正常
- 访问 https://searchgal.top 测试

### Q: 如何添加新的网盘支持？

A: 查看 [ARCHITECTURE.md](ARCHITECTURE.md) - 只需 3 步！

## 🧪 测试验证

```bash
npm run build
npm test -- --runInBand
# Python 3.9+：生成 ZIP，经本地 HTTP 分段下载，再校验并解压
python3 tests/manual/local_zip_roundtrip.py
# 需要 7zz/7z、zip：本地分卷下载、解压和 CLI 回退
node tests/manual/multipart_roundtrip.mjs
# 另需 aria2c：同时验证真实 aria2 下载、断点续传和换源
node tests/manual/multipart_roundtrip.mjs --aria2
```

默认测试不访问外部资源站；GGBases 的外网测试需显式设置 `RUN_NETWORK_TESTS=1`，未启用时记为跳过。
上述脚本使用自行生成的归档，不代表真实外部游戏资源已在当前代码上验收。沙箱环境需要允许测试监听回环地址。

使用示例输出（不作为本轮验收记录）：
```
🔍 搜索游戏: 千恋万花
✅ 找到 22 个平台的资源

📊 资源评分 (前5):
1. [190分] 真红小站
   直链下载, 无需登录, 自建网盘
   https://www.shinnku.com/files/...

🎯 最佳资源: 真红小站 (190分)
🔧 使用工具: DirectDownloader
⬇️  开始下载到: ~/Downloads/SearchGal
✅ 下载完成!
```

## 🤝 贡献

欢迎添加新的下载工具适配器！

## 📄 License

[GNU AGPL v3](../LICENSE)。来源与修改说明见 [NOTICE](../NOTICE)。

---

**享受自动化下载的乐趣！** 🎮

查看完整文档：[INDEX.md](INDEX.md)
