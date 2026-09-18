# 🔍 代码审查报告

## 总体评价：⭐⭐⭐⭐ (4/5)

代码整体质量良好，架构清晰，但有一些可以改进的地方。

---

## ✅ 优点

### 1. 架构设计优秀
- ✅ **关注点分离**：Harness、Registry、Scorer、Client 职责明确
- ✅ **依赖注入**：SearchClient 通过构造函数接收 apiUrl
- ✅ **策略模式**：DownloadTool 接口统一，易于扩展
- ✅ **单一职责原则**：每个类只做一件事

### 2. 类型安全
- ✅ 完整的 TypeScript 类型定义
- ✅ 使用接口而非 any
- ✅ 返回类型明确

### 3. 错误处理
- ✅ try-catch 包裹异步操作
- ✅ 返回友好的错误信息
- ✅ 自动重试机制

---

## ⚠️ 需要改进的问题

### 🔴 严重问题

#### 1. **命令注入漏洞** (SearchClient.ts:6 & DirectDownloader.ts:45-99)

**问题：** URL 直接拼接到 shell 命令中，存在命令注入风险

```typescript
// ❌ 危险代码
const command = `aria2c "${url}" -d "${options.outputDir}"`;
await execAsync(command);
```

**风险：** 恶意 URL 可以执行任意命令
```
https://evil.com/file"; rm -rf / #
```

**修复方案：**
```typescript
// ✅ 安全做法：使用数组形式避免 shell 解析
import { spawn } from 'child_process';

private async downloadWithAria2(url: string, options: DownloadOptions): Promise<DownloadResult> {
  return new Promise((resolve, reject) => {
    const args = [
      url,  // 不需要引号，spawn 会自动处理
      '-d', options.outputDir,
      '-x', '16',
      '-s', '16',
      '-k', '1M',
      '--file-allocation=none',
    ];

    if (options.filename) {
      args.push('-o', options.filename);
    }

    const child = spawn('aria2c', args, { stdio: 'inherit' });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          filepath: options.filename 
            ? `${options.outputDir}/${options.filename}` 
            : undefined,
        });
      } else {
        reject(new Error(`aria2c exited with code ${code}`));
      }
    });
  });
}
```

#### 2. **API 默认地址错误** (cli.ts:19)

```typescript
// ❌ 生产环境会失败
.option('-a, --api <url>', 'API地址', 'http://localhost:8787')
```

**问题：** 默认指向 localhost，普通用户无法使用

**修复方案：**
```typescript
// ✅ 方案1：使用公共 API（如果有）
.option('-a, --api <url>', 'API地址', 'https://api.searchgal.top')

// ✅ 方案2：检测环境
.option('-a, --api <url>', 'API地址', process.env.SEARCHGAL_API || 'https://api.searchgal.top')

// ✅ 方案3：要求用户必须指定
.requiredOption('-a, --api <url>', 'API地址（必需）')
```

#### 3. **SearchClient 默认 URL 无效** (SearchClient.ts:6)

```typescript
// ❌ searchgal.top 是前端，不是 API
constructor(apiUrl = 'https://searchgal.top') {
  this.apiUrl = apiUrl;
}
```

**修复：** 同上，使用正确的 API 地址或要求用户提供

---

### 🟡 中等问题

#### 4. **缺少输入验证** (多处)

```typescript
// ❌ 没有验证 gameName
async searchAndDownload(gameName: string, outputDir: string, autoSelect = true)
```

**修复：**
```typescript
async searchAndDownload(gameName: string, outputDir: string, autoSelect = true): Promise<void> {
  // 验证输入
  if (!gameName || gameName.trim().length === 0) {
    throw new Error('游戏名不能为空');
  }

  if (!outputDir || outputDir.trim().length === 0) {
    throw new Error('下载目录不能为空');
  }

  // 验证目录是否存在
  const fs = await import('fs/promises');
  try {
    await fs.access(outputDir);
  } catch {
    throw new Error(`目录不存在: ${outputDir}`);
  }

  // 继续执行...
}
```

#### 5. **缺少资源清理** (SearchClient.ts:32-61)

```typescript
// ❌ reader 没有显式关闭
const reader = response.body?.getReader();
```

**修复：**
```typescript
private async parseStreamResponse(response: Response): Promise<SearchResult[]> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('无法读取响应流');
  }

  const decoder = new TextDecoder();
  const results: SearchResult[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value).split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.result) {
            results.push(data.result);
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    }
  } finally {
    reader.releaseLock();  // ✅ 确保释放锁
  }

  return results;
}
```

#### 6. **硬编码的魔法数字** (DirectDownloader.ts:49-51)

```typescript
// ❌ 硬编码
'-x 16',  // 16线程
'-s 16',
'-k 1M',
```

**修复：**
```typescript
// ✅ 使用常量
private readonly DEFAULT_CONNECTIONS = 16;
private readonly DEFAULT_MIN_SPLIT_SIZE = '1M';

private async downloadWithAria2(url: string, options: DownloadOptions): Promise<DownloadResult> {
  const args = [
    url,
    '-d', options.outputDir,
    '-x', String(options.connections || this.DEFAULT_CONNECTIONS),
    '-s', String(options.connections || this.DEFAULT_CONNECTIONS),
    '-k', options.minSplitSize || this.DEFAULT_MIN_SPLIT_SIZE,
    '--file-allocation=none',
  ];
  // ...
}
```

#### 7. **静默失败** (SearchClient.ts:54-56)

```typescript
// ❌ 解析错误被忽略，可能丢失数据
try {
  const data = JSON.parse(line);
  if (data.result) {
    results.push(data.result);
  }
} catch (e) {
  // 忽略解析错误
}
```

**修复：**
```typescript
try {
  const data = JSON.parse(line);
  if (data.result) {
    results.push(data.result);
  }
} catch (e) {
  // ✅ 记录日志，便于调试
  console.warn(`无法解析响应行: ${line}`, e);
}
```

#### 8. **缺少并发控制** (Harness.ts:53)

```typescript
// 当前实现：串行评分，性能低
for (const result of results) {
  for (const item of result.items) {
    const score = this.calculateScore(result, item.url);
    // ...
  }
}
```

**问题：** 对于大量资源，评分会很慢

**修复：** 评分是纯计算，不需要并发控制，但可以优化数据结构

---

### 🟢 轻微问题

#### 9. **缺少日志级别控制**

```typescript
// ❌ console.log 无处不在
console.log('🔍 搜索游戏:', gameName);
console.log('✅ 找到', results.length, '个平台');
```

**修复：**
```typescript
// ✅ 使用日志库或简单的封装
class Logger {
  constructor(private verbose: boolean = false) {}

  info(msg: string) {
    console.log(msg);
  }

  debug(msg: string) {
    if (this.verbose) {
      console.log(`[DEBUG] ${msg}`);
    }
  }

  error(msg: string) {
    console.error(`❌ ${msg}`);
  }
}
```

#### 10. **直链检测不够准确** (ResourceScorer.ts:93-102)

```typescript
// ❌ 只检查扩展名，不够准确
private isDirectLink(url: string): boolean {
  const directPatterns = [
    /\.zip$/i,
    /\.rar$/i,
    /\.7z$/i,
    /\.exe$/i,
    /\/download\//i,
  ];
  return directPatterns.some(pattern => pattern.test(url));
}
```

**问题：**
- `https://evil.com/virus.zip?redirect=phishing` 会被误判
- `https://mega.nz/file/download?id=xxx` 不会被识别

**修复：**
```typescript
private isDirectLink(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    
    // 检查路径（不包括查询参数）
    const directPatterns = [
      /\.zip$/i,
      /\.rar$/i,
      /\.7z$/i,
      /\.exe$/i,
    ];
    
    // 检查是否匹配直链扩展名
    const hasDirectExt = directPatterns.some(p => p.test(pathname));
    
    // 检查是否包含 download 路径
    const hasDownloadPath = pathname.includes('/download/');
    
    return hasDirectExt || hasDownloadPath;
  } catch {
    return false;
  }
}
```

#### 11. **缺少超时控制** (SearchClient.ts:17-20)

```typescript
// ❌ fetch 没有超时，可能永久挂起
const response = await fetch(`${this.apiUrl}/gal`, {
  method: 'POST',
  body: formData,
});
```

**修复：**
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

try {
  const response = await fetch(`${this.apiUrl}/gal`, {
    method: 'POST',
    body: formData,
    signal: controller.signal,
  });
  clearTimeout(timeoutId);
  // ...
} catch (error) {
  if (error.name === 'AbortError') {
    throw new Error('搜索超时（30秒）');
  }
  throw error;
}
```

#### 12. **重试逻辑不够健壮** (Harness.ts:95-107)

```typescript
// ❌ 只重试一次，且没有记录
if (scores.length > 1 && autoSelect) {
  console.log('\n🔄 尝试下一个资源...\n');
  const nextResource = scores[1];
  const nextTool = this.registry.findTool(nextResource.url);

  if (nextTool) {
    const nextResult = await nextTool.download(nextResource.url, options);
    if (nextResult.success) {
      console.log('✅ 下载完成!');
    }
  }
}
```

**修复：**
```typescript
// ✅ 循环重试，直到成功或资源耗尽
let downloadSuccess = false;
let attemptCount = 0;

for (const resource of scores) {
  if (downloadSuccess) break;
  
  attemptCount++;
  console.log(`🔧 尝试资源 ${attemptCount}/${Math.min(scores.length, 3)}: ${resource.platform}`);
  
  const tool = this.registry.findTool(resource.url);
  if (!tool) {
    console.log('⚠️  未找到支持的工具，跳过');
    continue;
  }

  const result = await tool.download(resource.url, options);
  
  if (result.success) {
    console.log('✅ 下载完成!');
    if (result.filepath) {
      console.log(`📁 文件位置: ${result.filepath}`);
    }
    downloadSuccess = true;
  } else {
    console.log(`❌ 下载失败: ${result.error}`);
    if (attemptCount >= 3) {
      console.log('已尝试 3 次，停止重试');
      break;
    }
  }
}

if (!downloadSuccess) {
  console.log('❌ 所有资源都下载失败');
}
```

---

## 📋 改进建议

### 高优先级（必须修复）

1. **修复命令注入漏洞** - 使用 `spawn` 代替 `execAsync`
2. **修复默认 API 地址** - 使用有效的公共 API 或要求用户提供
3. **添加输入验证** - 验证所有用户输入

### 中优先级（强烈建议）

4. **添加资源清理** - 使用 `finally` 确保资源释放
5. **提取魔法数字** - 使用常量或配置
6. **改进错误日志** - 不要静默失败
7. **添加超时控制** - 防止请求挂起

### 低优先级（可选优化）

8. **添加日志级别** - 支持 verbose 模式
9. **改进直链检测** - 使用 URL 解析
10. **改进重试逻辑** - 支持多次重试
11. **添加进度回调** - 支持自定义进度显示

---

## 🔧 立即可改进的代码

### 修复 1: 命令注入（DirectDownloader.ts）

```typescript
import { spawn } from 'child_process';

private async downloadWithAria2(url: string, options: DownloadOptions): Promise<DownloadResult> {
  return new Promise((resolve, reject) => {
    const args = [
      url,
      '-d', options.outputDir,
      '-x', '16',
      '-s', '16',
      '-k', '1M',
      '--file-allocation=none',
    ];

    if (options.filename) {
      args.push('-o', options.filename);
    }

    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        args.push(`--header=${key}: ${value}`);
      }
    }

    console.log(`执行命令: aria2c ${args.join(' ')}`);

    const child = spawn('aria2c', args, { stdio: 'inherit' });

    child.on('error', (err) => {
      reject(new Error(`aria2c 启动失败: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          filepath: options.filename
            ? `${options.outputDir}/${options.filename}`
            : undefined,
        });
      } else {
        reject(new Error(`aria2c 退出，代码: ${code}`));
      }
    });
  });
}
```

### 修复 2: 输入验证（Harness.ts）

```typescript
async searchAndDownload(gameName: string, outputDir: string, autoSelect = true): Promise<void> {
  // 验证输入
  if (!gameName?.trim()) {
    throw new Error('游戏名不能为空');
  }

  if (!outputDir?.trim()) {
    throw new Error('下载目录不能为空');
  }

  // 创建目录（如果不存在）
  const { mkdir } = await import('fs/promises');
  await mkdir(outputDir, { recursive: true });

  console.log(`🔍 搜索游戏: ${gameName}`);
  
  // 继续原有逻辑...
}
```

### 修复 3: API 地址（cli.ts）

```typescript
program
  .command('download <game>')
  .description('搜索并下载游戏')
  .option('-d, --dir <path>', '下载目录', join(homedir(), 'Downloads', 'SearchGal'))
  .requiredOption('-a, --api <url>', 'API地址（例如: https://your-searchgal-api.com）')
  .option('--no-auto', '关闭自动选择，手动选择资源')
  .action(async (game: string, options) => {
    try {
      const harness = new Harness(options.api);
      await harness.searchAndDownload(game, options.dir, options.auto);
    } catch (error) {
      console.error('❌ 错误:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
```

---

## 📊 代码质量评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **架构设计** | ⭐⭐⭐⭐⭐ | Harness 模式清晰，职责分离好 |
| **类型安全** | ⭐⭐⭐⭐⭐ | TypeScript 使用得当 |
| **错误处理** | ⭐⭐⭐⭐ | 有错误处理，但可以更健壮 |
| **安全性** | ⭐⭐ | 存在命令注入漏洞 |
| **可维护性** | ⭐⭐⭐⭐ | 代码清晰，但缺少日志 |
| **性能** | ⭐⭐⭐⭐ | 基本满足需求 |
| **测试覆盖** | ⭐ | 缺少单元测试 |

**总分：3.8/5**

---

## ✅ 推荐行动计划

### 第一阶段（紧急）
1. 修复命令注入漏洞
2. 修复 API 默认地址
3. 添加输入验证

### 第二阶段（重要）
4. 添加超时控制
5. 改进错误日志
6. 添加资源清理

### 第三阶段（优化）
7. 添加单元测试
8. 添加日志级别控制
9. 改进重试逻辑
10. 添加配置文件支持

---

## 🎯 总结

**优点：**
- 架构设计优秀，符合 SOLID 原则
- TypeScript 类型使用恰当
- 代码可读性好

**主要问题：**
- 存在安全漏洞（命令注入）
- 默认配置不可用
- 缺少输入验证和错误恢复

**建议：**
优先修复安全问题和配置问题，然后逐步完善错误处理和日志系统。整体代码质量不错，是一个良好的起点，修复这些问题后可以达到生产级别。
