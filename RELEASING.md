# 发布桌面版

源码仓库：https://github.com/iiinnovation/SearchGal

## 准备版本

1. 提交要发布的代码、构建脚本和锁文件。核对 LICENSE、NOTICE 和 README 中的来源及许可说明。
2. 检查暂存区及将推送的历史，排除真实 API Key、用户配置、验证日志和未经授权的角色素材。`.gitignore` 不会清除已经提交的文件。
3. 在 `desktop/package.json` 更新版本号，并同步 `desktop/package-lock.json`。为源码提交创建版本标签，例如 `desktop-v0.1.1`。

## Windows 构建

在 Windows x64 上安装 Node.js 24 LTS，从目标标签检出完整仓库，然后执行：

```powershell
cd desktop
npm ci
npm test
npm run build
npm run test:e2e
npm run dist:win
```

安装包位于 `desktop/release/SearchGal-Setup-<版本>-x64.exe`。先在 Windows 上验证安装、启动、下载和卸载。仓库内的 `Windows desktop build and verification` 工作流也可手动执行，并提供安装包与测试结果 artifacts；工作流生成的 artifact ZIP 下载后需要解压，再运行其中的 `.exe`。

## GitHub Release

- 选择与构建完全一致的版本标签，上传 `.exe` 安装包，并提供 SHA-256 校验值。
- 在 Release 说明中明确标注版本功能、测试范围、已知限制，以及是否进行了代码签名。
- 在安装包下载链接旁提供同一标签的 Source code 下载入口和构建说明。GitHub 自动生成的源码归档需要包含完整对应源码与必要构建文件；存在子模块或额外必需文件时，应另行补齐。
- 保持对应源码可获得，不将用户密钥或私有角色素材加入 Release。
- 安装包通过 Releases 分发，不提交到 Git 历史。

桌面设置中的 API Key 由每位用户自行配置。第三方依赖保留各自许可声明。部署修改后的网络服务时，应为远程用户显著提供运行版本的对应源码入口。
