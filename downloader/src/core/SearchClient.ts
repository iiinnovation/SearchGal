import type { SearchOutcome, SearchResult } from '../types/index.js';

export const DEFAULT_API_URL = 'http://localhost:8787';

const SEARCH_TIMEOUT_MS = 90_000;

/** Node 的 fetch 把连接错误包成 "fetch failed"，真正的原因（ECONNREFUSED 等）在 cause 里 */
function describeNetworkError(error: unknown): string {
  const cause = error instanceof Error ? (error.cause as { code?: string; message?: string; errors?: Array<{ code?: string }> } | undefined) : undefined;
  const code = cause?.code ?? cause?.errors?.find(e => e.code)?.code;
  if (code) return code === 'ECONNREFUSED' ? '连接被拒绝（后端没有启动？）' : code;
  if (cause?.message) return cause.message;
  return error instanceof Error ? error.message : String(error);
}

interface StreamEvent {
  total?: number;
  progress?: { completed: number; total: number };
  result?: SearchResult;
  done?: boolean;
  error?: string;
}

export interface SearchOptions {
  signal?: AbortSignal;
  onResult?: (result: SearchResult) => void;
}

export class SearchClient {
  private readonly apiUrl: string;

  constructor(apiUrl: string = DEFAULT_API_URL, private readonly connectionHint?: string) {
    this.apiUrl = apiUrl.replace(/\/+$/, '');
  }

  /**
   * 调用 SearchGal 后端的 /gal 接口。响应是"每行一个 JSON"的流。
   */
  async searchGal(
    gameName: string, onProgress?: (completed: number, total: number) => void, options: SearchOptions = {},
  ): Promise<SearchOutcome> {
    options.signal?.throwIfAborted();
    const formData = new FormData();
    formData.append('game', gameName);

    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}/gal`, {
        method: 'POST',
        body: formData,
        signal,
      });
    } catch (error) {
      clearTimeout(timer);
      options.signal?.throwIfAborted();
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`搜索超时（${SEARCH_TIMEOUT_MS / 1000} 秒）`);
      }
      const detail = describeNetworkError(error);
      throw new Error(`无法连接到 API ${this.apiUrl}: ${detail}\n${this.apiHint()}`);
    }

    try {
      const contentType = response.headers.get('content-type') ?? '';

      if (!response.ok) {
        const body = await response.text();
        let message = body.slice(0, 200);
        try {
          message = (JSON.parse(body) as { error?: string }).error ?? message;
        } catch {
          /* 不是 JSON 就原样显示 */
        }
        throw new Error(`搜索失败 (HTTP ${response.status}): ${message}`);
      }

      // 前端站点、反向代理错误页等都会返回 HTML；如果不校验，会静默得到 0 个结果
      if (!contentType.includes('text/event-stream')) {
        throw new Error(
          `${this.apiUrl}/gal 返回的不是搜索结果流（Content-Type: ${contentType || '未知'}），这不是 SearchGal 后端地址。\n${this.apiHint()}`,
        );
      }

      return await this.parseStream(response, onProgress, options.onResult);
    } finally {
      clearTimeout(timer);
    }
  }

  private apiHint(): string {
    if (this.connectionHint) return this.connectionHint;
    return [
      '请确认后端已启动并通过 --api 指定地址，例如：',
      '  1) 在 SearchGal 项目根目录运行 `pnpm install && pnpm wrangler dev`（默认 http://localhost:8787）',
      '  2) 或者使用你自己部署的实例：--api https://xxx.workers.dev',
      '  也可以设置环境变量 SEARCHGAL_API。',
    ].join('\n');
  }

  /**
   * 逐行解析。网络分块和行边界无关，所以必须把不完整的尾巴留到下一块，
   * 解码也要用 stream 模式，否则被切开的多字节中文会变成乱码。
   */
  private async parseStream(
    response: Response,
    onProgress?: (completed: number, total: number) => void,
    onResult?: (result: SearchResult) => void,
  ): Promise<SearchOutcome> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法读取响应流');
    }

    const decoder = new TextDecoder();
    const outcome: SearchOutcome = { results: [], errors: [] };
    let buffer = '';

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let event: StreamEvent;
      try {
        event = JSON.parse(trimmed) as StreamEvent;
      } catch {
        console.warn(`⚠️  无法解析的响应行: ${trimmed.slice(0, 120)}`);
        return;
      }
      if (typeof event.total === 'number') outcome.total = event.total;
      if (event.progress && onProgress) onProgress(event.progress.completed, event.progress.total);
      if (event.result) {
        onResult?.(event.result);
        if (event.result.error) {
          outcome.errors.push(event.result);
        } else if (event.result.items?.length) {
          outcome.results.push(event.result);
        }
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
          handleLine(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
        }
      }
      buffer += decoder.decode();
      if (buffer) handleLine(buffer);
    } finally {
      reader.releaseLock();
    }

    return outcome;
  }
}
