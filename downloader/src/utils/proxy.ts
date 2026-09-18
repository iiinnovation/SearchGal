import { ProxyAgent, Agent, setGlobalDispatcher } from 'undici';
import { isIP } from 'net';

let proxyConfigured = false;

/**
 * 解析 no_proxy/NO_PROXY 环境变量，返回不应走代理的主机列表。
 */
function parseNoProxy(): string[] {
  const raw = process.env.no_proxy ?? process.env.NO_PROXY ?? '';
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * 判断目标 hostname 是否命中 no_proxy 规则。
 * localhost / 127.* / ::1 始终不走代理。
 */
export function isNoProxy(url: string): boolean {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  const hostname = normalizeHostname(target.hostname);
  if (
    hostname === 'localhost' ||
    (isIP(hostname) === 4 && hostname.startsWith('127.')) ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  ) {
    return true;
  }
  const port = target.port || (target.protocol === 'https:' ? '443' : target.protocol === 'http:' ? '80' : '');
  return parseNoProxy().some(entry => {
    if (entry === '*') return true;

    // IPv6 的端口必须写成 [地址]:端口，裸 IPv6 整体作为主机名。
    const rule = entry.startsWith('[')
      ? entry.match(/^\[([^\]]+)\](?::(\d+))?$/)
      : isIP(entry) === 6 ? [entry, entry, undefined] : entry.match(/^([^:]+)(?::(\d+))?$/);
    if (!rule?.[1] || (rule[2] !== undefined && Number(rule[2]) !== Number(port))) return false;

    const subdomainsOnly = rule[1].startsWith('*.');
    const host = normalizeHostname(rule[1].replace(/^\*?\./, ''));
    if (!host) return false;
    return (!subdomainsOnly && hostname === host) || (isIP(host) === 0 && hostname.endsWith('.' + host));
  });
}

function normalizeHostname(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (isIP(host) === 6) {
    try {
      return new URL(`http://[${host}]`).hostname.slice(1, -1);
    } catch {
      // URL 不支持带 zone id 的 IPv6；无效规则不能中断其他主机的请求。
    }
  }
  return host;
}

/**
 * 构造一个感知 no_proxy 的自定义 dispatcher：
 * - 本地地址 → 直连 Agent
 * - 其余地址 → ProxyAgent
 *
 * undici 的 ProxyAgent / EnvHttpProxyAgent 均不原生支持 localhost 自动绕过，
 * 因此手动实现一个 dispatch() 分流方案。
 */
function makeSmartProxyDispatcher(proxyUrl: string) {
  const proxy = new ProxyAgent(proxyUrl);
  const direct = new Agent();

  return {
    dispatch(opts: Parameters<ProxyAgent['dispatch']>[0], handler: Parameters<ProxyAgent['dispatch']>[1]) {
      const origin = typeof opts.origin === 'string' ? opts.origin : String(opts.origin ?? '');
      if (isNoProxy(origin)) {
        return direct.dispatch(opts, handler);
      }
      return proxy.dispatch(opts, handler);
    },
    close() {
      return Promise.all([proxy.close(), direct.close()]).then(() => undefined);
    },
  };
}

/**
 * 从环境变量读取代理配置并设置 undici 全局 dispatcher。
 * localhost 和 no_proxy 中的主机自动直连，其余请求走代理。
 */
export function configureProxyFromEnv(): void {
  if (proxyConfigured) return;

  const proxy =
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY ||
    process.env.all_proxy ||
    process.env.ALL_PROXY;

  if (!proxy) return;

  try {
    const proxyUrl = proxy.replace(/^socks5:\/\//, 'socks://');
    setGlobalDispatcher(makeSmartProxyDispatcher(proxyUrl) as unknown as Parameters<typeof setGlobalDispatcher>[0]);
    proxyConfigured = true;
    const displayUrl = proxy.replace(/:\/\/[^@]*@/, '://***@');
    console.error(`[代理] 已启用: ${displayUrl}（localhost 自动直连）`);
  } catch (error) {
    console.warn(`[代理] 配置失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function isProxyConfigured(): boolean {
  return proxyConfigured;
}
