# 示例：如何使用 SearchGal Downloader

## 示例 1: 基础使用

```powershell
# 搜索并下载 "千恋万花"
node dist/cli.js download "千恋万花"
```

**执行过程：**

1. 调用 SearchGal API 搜索 "千恋万花"
2. 从 27+ 平台获取资源列表
3. 智能评分，选择最佳资源（如：真红小站的直链）
4. 使用 aria2c 多线程下载到 `~/Downloads/SearchGal/`

## 示例 2: 指定下载目录

```powershell
# 下载到 D:\Games
node dist/cli.js download "ATRI -My Dear Moments-" --dir "D:\Games"
```

## 示例 3: 使用自己的 API

```powershell
# 使用自己部署的 SearchGal API
node dist/cli.js download "白色相簿2" --api "https://your-api.com"
```

## 示例 4: 查看可用工具

```powershell
node dist/cli.js tools
```

**输出：**

```
🔧 已注册的下载工具:

  - MagnetTool
  - BaiduPanTool
  - AliyunPanTool
  - DirectDownloader
```

## 工作流程详解

### 阶段 1: 搜索

```
🔍 搜索游戏: 千恋万花
✅ 找到 15 个平台的资源
```

系统调用 SearchGal API，并行搜索所有平台。

### 阶段 2: 评分

```
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
```

评分规则：
- 直链：+100分
- 无需登录：+50分
- 自建网盘：+40分
- 不限速网盘：+30分
- BT/磁力：+20分
- 需要魔法：-20分
- 需要登录：-30分

### 阶段 3: 选择

```
🎯 最佳资源: 真红小站 (160分)
📦 下载链接: https://shinnku.com/api/download/...
```

自动选择得分最高的资源。

### 阶段 4: 匹配工具

```
🔧 使用工具: DirectDownloader
```

根据 URL 类型，自动选择合适的下载工具：

| URL 类型 | 匹配工具 |
|---------|----------|
| `http://` 或 `https://` | DirectDownloader |
| `magnet:?` | MagnetTool |
| `pan.baidu.com` | BaiduPanTool |
| `aliyundrive.com` | AliyunPanTool |

### 阶段 5: 下载

```
⬇️  开始下载到: C:\Users\YourName\Downloads\SearchGal

执行命令: aria2c "https://..." -d "C:\..." -x 16 -s 16 -k 1M

[#1 20MiB/350MiB(5%) CN:16 DL:8.5MiB ETA:38s]
[#1 50MiB/350MiB(14%) CN:16 DL:9.2MiB ETA:32s]
[#1 100MiB/350MiB(28%) CN:16 DL:10.1MiB ETA:25s]
...
[#1 350MiB/350MiB(100%) CN:16 DL:9.8MiB]

✅ 下载完成!
📁 文件位置: C:\Users\YourName\Downloads\SearchGal\千恋万花.zip
```

使用 aria2c 16线程下载，实时显示进度。

## 特殊情况处理

### 情况 1: 最佳资源是百度网盘

```
🎯 最佳资源: 量子ACG (80分)
📦 下载链接: https://pan.baidu.com/s/xxxxx

🔧 使用工具: BaiduPanTool
⬇️  开始下载到: C:\Users\YourName\Downloads\SearchGal

❌ 下载失败: 百度网盘需要手动操作:
1. 运行: BaiduPCS-Go
2. 使用命令: share https://pan.baidu.com/s/xxxxx 提取码
3. 保存到网盘后使用 cd 和 download 命令下载

🔄 尝试下一个资源...

🎯 使用备选资源: 真红小站 (160分)
🔧 使用工具: DirectDownloader
✅ 下载完成!
```

**自动容错机制：** 当百度网盘无法自动下载时，系统会自动尝试评分第二的资源。

### 情况 2: 磁力链接下载

```
🎯 最佳资源: 稻荷GAL (80分)
📦 下载链接: magnet:?xt=urn:btih:xxxxx

🔧 使用工具: MagnetTool
⬇️  开始下载到: C:\Users\YourName\Downloads\SearchGal

执行命令: aria2c "magnet:?..." -d "C:\..." --seed-time=0

[NOTICE] Downloading 3 item(s)
[#1 SIZE:0B/350MiB(0%) CN:0 SEED:12 SPD:0Bs]
[#1 SIZE:50MiB/350MiB(14%) CN:8 SEED:12 SPD:5.2MiBs]
[#1 SIZE:100MiB/350MiB(28%) CN:10 SEED:12 SPD:6.8MiBs]
...

✅ 下载完成!
📁 文件位置: C:\Users\YourName\Downloads\SearchGal\
```

**注意：** 磁力链接速度取决于种子数量和做种者数量。

## 实战案例

### 案例 1: 下载热门游戏

```powershell
# 游戏名可以使用中文、日文或英文
node dist/cli.js download "千恋万花"
node dist/cli.js download "千恋＊万花"
node dist/cli.js download "Senren Banka"

# 结果相同，都能找到资源
```

### 案例 2: 批量下载（脚本）

创建 `batch-download.ps1`:

```powershell
$games = @(
    "千恋万花",
    "白色相簿2",
    "ATRI",
    "魔女的夜宴"
)

foreach ($game in $games) {
    Write-Host "开始下载: $game"
    node dist/cli.js download $game --dir "D:\GalGames"
    Write-Host "完成: $game`n"
}
```

运行：

```powershell
.\batch-download.ps1
```

### 案例 3: 创建快捷方式

Windows 桌面创建快捷方式，目标设置为：

```
powershell.exe -Command "cd 'C:\path\to\SearchGal\downloader'; node dist/cli.js download"
```

双击后在弹出窗口输入游戏名即可。

## 性能优化

### 提升下载速度

编辑 `src/tools/DirectDownloader.ts`，调整 aria2c 参数：

```typescript
const args = [
  `"${url}"`,
  `-d "${options.outputDir}"`,
  '-x 32',  // 32线程（原来是16）
  '-s 32',
  '-k 1M',
  '--min-split-size=1M',  // 添加
  '--max-connection-per-server=16',  // 添加
  '--file-allocation=none',
];
```

重新编译：

```powershell
pnpm build
```

### 使用代理

如果资源需要魔法访问，编辑 aria2c 参数：

```typescript
if (options.proxy) {
  args.push(`--all-proxy="${options.proxy}"`);
}
```

使用：

```powershell
# 需要修改 CLI 支持 proxy 参数
node dist/cli.js download "游戏名" --proxy "http://127.0.0.1:7890"
```

## 故障排除

### 问题 1: "找不到 aria2c"

**解决：**

```powershell
# 检查是否安装
aria2c --version

# 如果没有，安装
scoop install aria2
```

### 问题 2: 下载中断

**解决：**

aria2c 支持断点续传，再次运行相同命令即可继续：

```powershell
node dist/cli.js download "游戏名" --dir "同一个目录"
```

### 问题 3: "未找到任何资源"

**可能原因：**

1. 游戏名拼写错误
2. 游戏太冷门，平台未收录
3. API 服务暂时不可用

**解决：**

```powershell
# 1. 尝试不同关键词
node dist/cli.js download "千恋"  # 简短关键词
node dist/cli.js download "Senren Banka"  # 英文名

# 2. 访问网页版确认
# 打开浏览器: https://searchgal.top

# 3. 检查 API 状态
curl https://searchgal.top
```

### 问题 4: 下载速度慢

**可能原因：**

1. 网络问题
2. 资源服务器限速
3. 高峰期人多

**解决：**

- 等待非高峰期
- 尝试其他资源（手动指定）
- 使用代理（如果资源在国外）

## 进阶技巧

### 技巧 1: 手动选择资源

修改 `cli.ts`，添加交互式选择：

```typescript
.option('--interactive', '交互式选择资源')
```

### 技巧 2: 下载完成后自动解压

在 `Harness.ts` 的下载完成后添加：

```typescript
if (result.success && result.filepath?.endsWith('.zip')) {
  console.log('🗜️  正在解压...');
  await execAsync(`7z x "${result.filepath}" -o"${outputDir}"`);
  console.log('✅ 解压完成!');
}
```

### 技巧 3: 通知推送

下载完成后发送桌面通知：

```powershell
# Windows 10/11 Toast 通知
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

$toast = @"
<toast>
    <visual>
        <binding template="ToastText02">
            <text id="1">SearchGal Downloader</text>
            <text id="2">下载完成！</text>
        </binding>
    </visual>
</toast>
"@

$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($toast)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("SearchGal").Show($xml)
```

## 总结

SearchGal Downloader 提供了：

✅ **一键搜索下载** - 输入游戏名即可  
✅ **智能资源选择** - 自动评分排序  
✅ **多工具支持** - 直链、磁力、网盘  
✅ **自动容错重试** - 失败自动换源  
✅ **高速下载** - aria2c 多线程  

**享受自动化的乐趣！** 🎮
