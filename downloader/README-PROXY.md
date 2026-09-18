# 代理配置指南

SearchGal Downloader 支持通过代理访问资源站点。

## 配置方法

设置以下任一环境变量，工具会自动使用代理：

```bash
# HTTP 代理
export http_proxy=http://127.0.0.1:7897
export https_proxy=http://127.0.0.1:7897

# SOCKS5 代理
export all_proxy=socks5://127.0.0.1:7897

# Windows PowerShell
$env:http_proxy="http://127.0.0.1:7897"
$env:https_proxy="http://127.0.0.1:7897"
```

## 使用示例

```bash
# 1. 设置代理
export all_proxy=socks5://127.0.0.1:7897

# 2. 运行下载工具
node dist/cli.js download "千恋万花"

# 输出会显示：
# [代理] 已启用: http://127.0.0.1:7897
```

## 支持的代理类型

- HTTP 代理：`http://host:port`
- HTTPS 代理：`https://host:port`
- SOCKS5 代理：`socks5://host:port`

## 注意事项

1. **自动检测**：工具启动时自动读取环境变量，无需额外配置
2. **全局生效**：配置后，所有 HTTP/HTTPS 请求都会走代理
3. **优先级**：`https_proxy` > `http_proxy` > `all_proxy`
4. **认证支持**：支持带用户名密码的代理：`http://user:pass@host:port`

## 验证测试

已验证可通过代理访问的站点：
- ✅ 真红小站 (www.shinnku.com)
- ✅ GGBases (www.ggbases.com)
- ✅ 其他 HTTP/HTTPS 资源站

## 故障排查

### 代理连接失败
```bash
# 检查代理是否可用
curl -x http://127.0.0.1:7897 https://www.google.com
```

### 查看当前代理配置
```bash
env | grep -i proxy
```

### 临时禁用代理
```bash
unset http_proxy https_proxy all_proxy
```

## 技术实现

使用 `undici` 库的 `ProxyAgent`，通过 `setGlobalDispatcher()` 让 Node.js 原生 `fetch` 自动走代理，无需修改业务代码。

相关文件：
- `src/utils/proxy.ts` - 代理配置模块
- `src/cli.ts` - CLI 启动时自动配置
