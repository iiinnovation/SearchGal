# SearchGal 桌面伙伴

这是基于 [Moe-Sakura/SearchGal](https://github.com/Moe-Sakura/SearchGal) 的非官方 Electron 桌面版，由 [iiinnovation/SearchGal](https://github.com/iiinnovation/SearchGal) 维护，采用 [AGPL-3.0](../LICENSE) 许可。默认在后台进程直接搜索和下载，不需要单独启动 Wrangler 或本地 API。仓库不附带第三方角色素材，可自行导入有权使用的图片。Windows 安装和实机交互仍需验收。

## macOS 启动

使用 Node.js 24 LTS，在完整仓库中运行：

```sh
cd desktop
npm ci
npm run dev
# 或构建独立的 macOS 应用
npm run pack:mac
```

当前 Intel Mac 的产物为 `release/mac/SearchGal.app`，可在 Finder 双击打开。Apple Silicon 构建的默认输出目录为 `release/mac-arm64/`，尚未在 Apple Silicon 实测。配置默认位于 `~/Library/Application Support/SearchGal`；macOS 点击菜单栏 SearchGal 图标后先显示菜单，再选择打开面板、下载任务或退出。窗口使用左上角原生红黄绿按钮；红色关闭按钮隐藏面板，后台任务继续运行。

角色支持 PNG、GIF 和 WebP，最高 4096 × 4096 且小于 10 MB。静态图片使用基础呼吸与轻微摆动；动图按各帧时长循环播放，透明像素命中随当前帧更新，系统开启“减少动态效果”时停在第一帧。已有 PNG 角色可继续使用，无需重新导入。

## 开发者启动

使用完整的项目目录，并安装 Node.js 24 LTS。桌面端有独立的 npm 锁文件；只构建桌面端时，无需先安装根目录或 downloader 的依赖。

```powershell
cd desktop
npm ci
npm run dev
```

安装依赖时会下载 Electron 运行时，需要网络连接。如果下载需要 HTTP 代理，在 PowerShell 中先设置代理，再安装和启动：

```powershell
$env:ELECTRON_GET_USE_PROXY = "1"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
npm ci
npm run dev
```

代理端口以自己的代理客户端为准。开发时，界面修改会自动更新；修改主进程、preload 或后台任务代码后，需要重启开发命令。

运行构建后的应用：

```powershell
npm run build
npm start
```

## 构建 Windows 安装包

在 Windows x64 上运行：

```powershell
cd desktop
npm ci
npm test
npm run build
npm run test:e2e
npm run dist:win
```

安装包目标路径是 `desktop/release/SearchGal-Setup-0.1.0-x64.exe`，文件名随版本变化。Electron 会连同运行时打包进去，最终用户只需安装并启动应用，不需要 Node.js、npm、pnpm、Wrangler 或系统 aria2。当前打包配置没有配置代码签名；正式交付前还需完成 Windows 安装与交互验收。发布步骤见 [RELEASING.md](../RELEASING.md)。

[Windows 工作流](../.github/workflows/desktop-windows.yml) 可在推送代码后执行同一套构建与测试，并保存安装包和测试记录为 Actions artifacts。添加工作流不代表它已经在 Windows 上运行通过。

工作流还会在中文路径安装 NSIS 包，检查快捷方式，直接启动安装后的程序运行界面测试，再验证卸载。可手动执行 `./scripts/verify-windows-install.ps1 -Installer ./release/SearchGal-Setup-0.1.0-x64.exe`；请使用一次性 Windows 测试账户或虚拟机。完整步骤和干净系统人工验收表见 [Windows 验收说明](WINDOWS_ACCEPTANCE.md)。

## 验证命令

| 命令 | 内容 |
| --- | --- |
| `npm run build` | TypeScript 检查、主进程 / 后台任务 / preload 打包、界面生产构建 |
| `npm test` | 任务队列、暂停取消、旧进程消息隔离、记录恢复、本地 HTTP 与搜索后台测试 |
| `npm run test:e2e` | 启动真实 Electron，操作搜索与下载，检查 Range 续传、分卷失败与重试、异常退出恢复和 ZIP 解压 |

运行界面测试前需要先构建。测试使用临时中文目录、临时回环端口和自行生成的归档，不连接外部资源站；每次测试结束后清理临时目录。Windows 使用系统 PowerShell 解压 ZIP；macOS / Linux 使用 `unzip`。截图与结果写入 `desktop/test-results/`。完整下载器回归仍在 `downloader/` 中执行 `npm ci`、`npm run build`、`npm test -- --runInBand`。

另外可显式运行一次外部站点搜索检查：`npm run test:e2e -- --config playwright.live.config.ts`。它使用 Electron 内置搜索，不启动单独的 API，也不下载外部资源文件；结果数量和可访问平台随网络与站点状态变化，记录保存在 `desktop/test-results-live/`。

## 当前使用方式

- “发现作品”输入游戏名称后回车，或点击“自动下载”，即可自动搜索、筛选匹配来源并开始下载，无需再点“自动选源下载”；来源失败后按推荐顺序尝试备用来源。搜索超时或中断时，已返回的匹配来源仍会自动进入下载队列。首页显示保存目录，可用“更改位置”调整，每个任务保存在该目录下的独立文件夹中。
- 只想浏览结果时点击旁边的“搜索”，仍可手动选源或使用“自动选源下载”。自动搜索中可停止；无足够匹配结果时显示提示，不下载无关结果。登录、手动转存或尚不支持的来源仍可能需要人工处理。
- “下载任务”可查看当前文件进度、暂停、继续、取消和打开文件夹。必需分卷全部成功才会显示完成；完成不代表应用已经自动解压或检验了归档。
- 每个任务保存在独立文件夹中。取消会保留已下载数据；重试会重新验证来源、版本和断点。
- 隐藏面板后后台任务继续；从托盘退出时保存并暂停任务，重新打开后由用户选择继续。
- “我的伙伴”支持 PNG、GIF 和 WebP 导入、静态预览、选择及移除副本；动图在桌面循环播放。当前需要自行导入角色素材。
- 单图桌宠支持基础呼吸、搜索 / 下载时轻微摆动、完成跳动及错误提示；跨应用点击穿透和多屏仍待人工检查。
- “偏好设置”可修改下载目录、完成通知、可选远程搜索服务和 HTTP 代理。修改网络设置影响之后启动的任务。
- 首版内置 HTTP 下载，不包含 BT 下载引擎。BT 资源需要使用外部客户端处理。

设置和任务记录默认保存在 Windows `%APPDATA%\SearchGal`。已下载文件保存在用户选择的下载目录，角色图片另存一份到应用数据目录。

## LLM 解压密码检查

在“偏好设置”的“解压密码检查”中配置 OpenAI 兼容接口地址（包含 `/v1`）、模型、API Key、超时和检查策略，然后启用并保存。桌面端使用此处的独立配置，不读取 CLI 的环境变量或 `.config.json`。设置作用于之后启动或恢复的下载。

开启后，通用网页解析器将发送资源页面片段到指定模型服务；直链和专用解析器不做网页密码检查。“预警后继续”会保留检查失败或密码障碍的提示；严格模式会跳过这些网页候选并尝试下一来源。API Key 缺失时也遵守该策略。

API Key 使用 Electron `safeStorage` 加密保存，不包含在界面快照中；系统安全存储不可用时拒绝保存密钥。留空保留现有 Key，删除按钮移除已保存的 Key。无鉴权的本地兼容接口可填写非空占位 Key。

下载任务显示当前来源的密码评估结果、公开解压密码及复制按钮，重启后仍可查看。切换候选时清除上一来源的密码。模型评估不等于实际解压验证，应用不会自动执行解压命令。

## 角色素材

角色素材由用户自行提供，并应确认使用和分发权限。静态角色建议使用透明 PNG；动画建议提供 3–5 秒的透明循环 WebP，长边 512–720 像素，也支持 GIF。所有导入图片最高 4096 × 4096 且小于 10 MB。单张立绘可以用于基础呼吸和轻微摆动；走路、挥手及各状态动画需要相应动作素材。

MP4 需要先去背景并转换为 GIF 或 WebP，不能直接导入。自动测试使用生成的几何图形，不依赖本地角色文件。
