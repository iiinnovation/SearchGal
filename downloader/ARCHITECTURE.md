# SearchGal Downloader - 架构设计文档

## 设计理念

参考 **Claude Code Harness** 和 **LLM Evaluation Harness** 的设计思想，构建一个可扩展的下载工具编排系统。

## 核心概念

### 1. Harness (线束/编排器)

就像汽车线束连接各个电子部件，Harness 是整个系统的中枢，负责：
- 协调各个组件
- 管理工具注册
- 控制工作流程

```typescript
export class Harness {
  private searchClient: SearchClient;      // 搜索客户端
  private scorer: ResourceScorer;          // 评分系统
  private registry: ToolRegistry;          // 工具注册表
  
  async searchAndDownload(game: string, outputDir: string): Promise<void> {
    // 编排整个流程
  }
}
```

### 2. Tool Registry (工具注册表)

类似 Claude Code 的 tool system，所有下载工具都注册到统一的注册表：

```typescript
export class ToolRegistry {
  private tools: DownloadTool[] = [];
  
  register(tool: DownloadTool): void {
    this.tools.push(tool);
  }
  
  findTool(url: string): DownloadTool | null {
    return this.tools.find(tool => tool.canHandle(url)) || null;
  }
}
```

### 3. Download Tool Interface (下载工具接口)

所有下载工具都实现统一接口，类似 Claude 的 tool definition：

```typescript
export interface DownloadTool {
  name: string;
  canHandle(url: string): boolean;  // 类似 tool matching
  download(url: string, options: DownloadOptions): Promise<DownloadResult>;
}
```

## 工作流程

```
┌─────────────────────────────────────────────────────────┐
│                    Harness 主控制器                      │
└─────────────────────┬───────────────────────────────────┘
                      ↓
           ┌──────────────────────┐
           │   1. Search Phase    │
           │   搜索所有平台资源    │
           └──────────┬───────────┘
                      ↓
           ┌──────────────────────┐
           │   2. Score Phase     │
           │   智能评分排序        │
           └──────────┬───────────┘
                      ↓
           ┌──────────────────────┐
           │   3. Select Phase    │
           │   选择最佳资源        │
           └──────────┬───────────┘
                      ↓
           ┌──────────────────────┐
           │   4. Match Phase     │
           │   匹配下载工具        │
           └──────────┬───────────┘
                      ↓
           ┌──────────────────────┐
           │   5. Execute Phase   │
           │   执行下载            │
           └──────────────────────┘
```

## 组件详解

### SearchClient

负责与 SearchGal API 通信，解析 SSE 流式响应：

```typescript
export class SearchClient {
  async searchGal(gameName: string): Promise<SearchResult[]> {
    // 调用 API
    // 解析 SSE 流
    // 返回结构化结果
  }
}
```

### ResourceScorer

智能评分系统，根据多个维度对资源打分：

| 维度 | 权重 | 说明 |
|------|------|------|
| 下载方式 | 高 | 直链 > 不限速网盘 > 限速网盘 > BT |
| 访问门槛 | 中 | 无需登录 > 需登录 > 需付费 |
| 网络要求 | 中 | 直连 > 需魔法 |
| 平台稳定性 | 低 | 根据平台历史可靠性 |

```typescript
export class ResourceScorer {
  scoreResources(results: SearchResult[]): ResourceScore[] {
    // 计算每个资源的综合得分
    // 返回排序后的列表
  }
}
```

### ToolRegistry

工具注册表，管理所有下载工具：

```typescript
// 注册工具
registry.register(new DirectDownloader());
registry.register(new BaiduPanTool());
registry.register(new MagnetTool());

// 自动匹配
const tool = registry.findTool(url);
if (tool) {
  await tool.download(url, options);
}
```

## 下载工具实现

每个下载工具都是独立的模块，实现 `DownloadTool` 接口：

### DirectDownloader - 直链下载

```typescript
export class DirectDownloader implements DownloadTool {
  name = 'DirectDownloader';
  
  canHandle(url: string): boolean {
    return url.startsWith('http://') || url.startsWith('https://');
  }
  
  async download(url: string, options: DownloadOptions): Promise<DownloadResult> {
    // 优先使用 aria2c，fallback 到 wget
    // 支持多线程下载
    // 支持断点续传
  }
}
```

### MagnetTool - 磁力/BT下载

```typescript
export class MagnetTool implements DownloadTool {
  name = 'MagnetTool';
  
  canHandle(url: string): boolean {
    return url.startsWith('magnet:?') || url.endsWith('.torrent');
  }
  
  async download(url: string, options: DownloadOptions): Promise<DownloadResult> {
    // 使用 aria2c 下载磁力链接
    // 自动做种到指定时间
  }
}
```

### BaiduPanTool - 百度网盘

```typescript
export class BaiduPanTool implements DownloadTool {
  name = 'BaiduPanTool';
  
  canHandle(url: string): boolean {
    return url.includes('pan.baidu.com');
  }
  
  async download(url: string, options: DownloadOptions): Promise<DownloadResult> {
    // 调用 BaiduPCS-Go
    // 由于百度网盘限制，需要用户手动操作
    // 提供详细的操作指引
  }
}
```

## 扩展性设计

### 添加新的下载工具

1. 创建新的工具类：

```typescript
// src/tools/NewTool.ts
export class NewTool implements DownloadTool {
  name = 'NewTool';
  
  canHandle(url: string): boolean {
    // 实现 URL 检测逻辑
  }
  
  async download(url: string, options: DownloadOptions): Promise<DownloadResult> {
    // 实现下载逻辑
  }
}
```

2. 注册到 Harness：

```typescript
// src/core/Harness.ts
private initializeTools(): void {
  // ...
  this.registry.register(new NewTool());
}
```

3. 完成！系统会自动识别和调用。

### 自定义评分规则

```typescript
// 继承 ResourceScorer 并重写评分逻辑
export class CustomScorer extends ResourceScorer {
  protected calculateScore(result: SearchResult, url: string): number {
    // 自定义评分算法
  }
}
```

## 容错设计

### 自动重试

当下载失败时，自动尝试下一个评分较高的资源：

```typescript
if (!result.success && scores.length > 1) {
  const nextResource = scores[1];
  const nextTool = registry.findTool(nextResource.url);
  if (nextTool) {
    await nextTool.download(nextResource.url, options);
  }
}
```

### 优雅降级

当某个工具不可用时，提供友好的错误提示和替代方案：

```typescript
if (!hasAria2) {
  return {
    success: false,
    error: '未安装 aria2c，请运行: scoop install aria2 (Windows)',
  };
}
```

## 未来规划

- [ ] 支持更多网盘（夸克、123盘等）
- [ ] GUI 桌面应用（Electron）
- [ ] 下载队列管理
- [ ] 断点续传
- [ ] 多任务并行下载
- [ ] 下载完成后自动解压
- [ ] 下载进度可视化
- [ ] 配置文件支持
- [ ] 插件系统

## 技术栈

- **TypeScript** - 类型安全
- **Node.js** - 运行时
- **Commander** - CLI 框架
- **aria2c** - 下载引擎
- **第三方网盘工具** - 网盘下载

## 对比其他方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| **Harness 架构** | 可扩展、模块化、易维护 | 需要学习成本 |
| 单体脚本 | 简单直接 | 难以扩展和维护 |
| GUI 应用 | 用户友好 | 开发周期长 |

## 总结

SearchGal Downloader 采用 **Harness 架构**，借鉴 Claude Code 的设计理念：

- ✅ **模块化** - 每个组件职责单一
- ✅ **可扩展** - 轻松添加新的下载工具
- ✅ **智能化** - 自动选择最佳资源
- ✅ **容错性** - 自动重试和降级
- ✅ **用户友好** - 一条命令完成全流程

就像 Claude Code 通过工具编排实现复杂任务，SearchGal Downloader 通过下载工具编排实现自动化下载。
