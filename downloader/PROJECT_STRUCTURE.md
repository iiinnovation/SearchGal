```
downloader/
├── package.json              # 项目配置
├── tsconfig.json             # TypeScript 配置
├── .gitignore
│
├── README.md                 # 项目说明
├── WINDOWS.md                # Windows 快速开始指南
├── ARCHITECTURE.md           # 架构设计文档
├── EXAMPLES.md               # 使用示例
│
└── src/
    ├── cli.ts                # CLI 入口
    │
    ├── types/
    │   └── index.ts          # TypeScript 类型定义
    │
    ├── core/                 # 核心组件
    │   ├── Harness.ts        # 主控制器
    │   ├── ToolRegistry.ts   # 工具注册表
    │   ├── ResourceScorer.ts # 资源评分系统
    │   └── SearchClient.ts   # 搜索客户端
    │
    └── tools/                # 下载工具
        ├── DirectDownloader.ts   # 直链下载
        ├── MagnetTool.ts         # 磁力/BT下载
        ├── BaiduPanTool.ts       # 百度网盘
        └── AliyunPanTool.ts      # 阿里云盘
```

## 文件说明

### 配置文件

- **package.json** - Node.js 项目配置，包含依赖和脚本
- **tsconfig.json** - TypeScript 编译配置
- **.gitignore** - Git 忽略文件列表

### 文档

- **README.md** - 项目总体说明和快速开始
- **WINDOWS.md** - Windows 系统详细安装指南
- **ARCHITECTURE.md** - Harness 架构设计文档
- **EXAMPLES.md** - 详细使用示例和案例

### 源代码

#### CLI 入口
- **src/cli.ts** - 命令行界面，使用 Commander.js

#### 类型定义
- **src/types/index.ts** - 所有 TypeScript 接口定义

#### 核心组件
- **src/core/Harness.ts** - 主控制器，编排整个流程
- **src/core/ToolRegistry.ts** - 工具注册表，管理所有下载工具
- **src/core/ResourceScorer.ts** - 智能评分系统
- **src/core/SearchClient.ts** - SearchGal API 客户端

#### 下载工具
- **src/tools/DirectDownloader.ts** - HTTP/HTTPS 直链下载（aria2c/wget）
- **src/tools/MagnetTool.ts** - 磁力链接和 BT 种子下载
- **src/tools/BaiduPanTool.ts** - 百度网盘下载（BaiduPCS-Go）
- **src/tools/AliyunPanTool.ts** - 阿里云盘下载（aliyunpan）
