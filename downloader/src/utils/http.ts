const DEFAULT_TIMEOUT_MS = 20_000;

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * 超时覆盖响应头和正文读取；原生超时信号不会阻止 Node 进程退出。
 * 各资源站大多会拒绝没有 UA 的请求。
 */
export async function fetchWithTimeout(url: string | URL, options: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers, signal: callerSignal, ...rest } = options;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has('User-Agent')) requestHeaders.set('User-Agent', BROWSER_UA);

  try {
    return await fetch(url, {
      ...rest,
      headers: requestHeaders,
      signal,
    });
  } catch (error) {
    if (timeoutSignal.aborted && signal.reason === timeoutSignal.reason) {
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）: ${url}`);
    }
    throw error;
  }
}

export async function fetchJson<T>(url: string | URL, options: FetchOptions = {}): Promise<T> {
  const response = await fetchWithTimeout(url, options);
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`响应不是 JSON（HTTP ${response.status}）: ${text.slice(0, 80).replace(/\s+/g, ' ')}`);
  }
}

/** 读取响应正文，超过 limit 字节后截断，避免把一个巨大的文件当网页读进内存。 */
export async function readTextLimited(response: Response, limit = 2 * 1024 * 1024): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';

  const decoder = new TextDecoder();
  let text = '';
  let received = 0;
  try {
    while (received < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text + decoder.decode();
}

export interface ProbeResult {
  ok: boolean;
  status: number;
  contentType: string;
  size?: number;
  /** 只有强 ETag 才能用于跨请求绑定文件版本。 */
  etag?: string;
  filename?: string;
  finalUrl: string;
}

/**
 * 探测一个 URL 到底是文件还是网页：先 HEAD，不支持 HEAD 的服务器退回到只取 1 字节的 GET。
 */
export async function probeUrl(
  url: string, headers: Record<string, string> = {}, options: Pick<FetchOptions, 'signal' | 'timeoutMs'> = {},
): Promise<ProbeResult> {
  options.signal?.throwIfAborted();
  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept-Encoding', 'identity');
  requestHeaders.delete('Range');
  requestHeaders.delete('If-Range');
  let response: Response;
  try {
    response = await fetchWithTimeout(url, { ...options, method: 'HEAD', headers: requestHeaders, redirect: 'follow' });
    if (response.status === 405 || response.status === 403 || response.status === 501) {
      throw new Error('HEAD not allowed');
    }
  } catch {
    options.signal?.throwIfAborted();
    requestHeaders.set('Range', 'bytes=0-0');
    response = await fetchWithTimeout(url, {
      ...options,
      method: 'GET',
      headers: requestHeaders,
      redirect: 'follow',
    });
    await response.body?.cancel().catch(() => undefined);
  }

  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  return {
    ok: response.ok,
    status: response.status,
    contentType,
    size: parseTotalSize(response),
    etag: strongEtag(response.headers.get('etag')),
    filename: filenameFromContentDisposition(response.headers.get('content-disposition')),
    finalUrl: response.url || url,
  };
}

export function strongEtag(value: string | null | undefined): string | undefined {
  return value && /^"[^"\r\n]*"$/.test(value) ? value : undefined;
}

function parseTotalSize(response: Response): number | undefined {
  const contentRange = response.headers.get('content-range');
  if (contentRange) {
    const match = contentRange.match(/\/(\d+)$/);
    if (match) return Number(match[1]);
  }
  const length = response.headers.get('content-length');
  if (length && response.status !== 206) return Number(length);
  return undefined;
}

export function filenameFromContentDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const utf8 = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* fall through */
    }
  }
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1].trim() : undefined;
}

export function isHtmlLike(contentType: string): boolean {
  return /text\/html|application\/xhtml|text\/plain|application\/json|text\/xml|application\/xml/.test(contentType);
}

/** 把 Set-Cookie 头压成下次请求可用的 Cookie 字符串 */
export function cookieHeaderFrom(response: Response): string {
  const cookies = response.headers.getSetCookie?.() ?? [];
  return cookies.map(c => c.split(';')[0]).join('; ');
}
