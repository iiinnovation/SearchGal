import { randomUUID } from 'crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import { isHtmlLike, strongEtag } from './http.js';

interface SourceOptions {
  url: string;
  expectedSize: number;
  etag: string;
}

class InvalidRepresentation extends Error {}

/** aria2 只连接回环服务；每段上游响应都经过相同的来源、版本和字节范围校验。 */
export async function createAria2Source(options: SourceOptions, headers: Headers): Promise<{
  url: string;
  failure(): Error | undefined;
  close(): Promise<void>;
}> {
  const path = `/${randomUUID()}`;
  const controllers = new Set<AbortController>();
  const pending = new Set<Promise<void>>();
  let failure: Error | undefined;

  async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.url !== path || request.method !== 'GET') {
      response.writeHead(404).end();
      return;
    }
    if (failure) {
      response.writeHead(412).end();
      return;
    }
    const controller = new AbortController();
    controllers.add(controller);
    let timer = setTimeout(() => controller.abort(), 30_000);
    const resetStall = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), 60_000);
    };
    response.on('close', () => { if (!response.writableFinished) controller.abort(); });
    let upstream: Response | undefined;
    try {
      const rangeHeader = request.headers.range;
      const requested = rangeHeader?.match(/^bytes=(\d+)-(\d*)$/);
      if (rangeHeader && (!requested || !Number.isSafeInteger(Number(requested[1])) ||
          (requested[2] && (!Number.isSafeInteger(Number(requested[2])) || Number(requested[2]) < Number(requested[1]))))) {
        throw new InvalidRepresentation('aria2 请求了无效的字节范围');
      }
      const requestHeaders = new Headers(headers);
      if (rangeHeader) requestHeaders.set('Range', rangeHeader);
      else requestHeaders.delete('Range');
      requestHeaders.set('If-Match', options.etag);
      requestHeaders.set('Accept-Encoding', 'identity');
      upstream = await fetch(options.url, { headers: requestHeaders, redirect: 'manual', signal: controller.signal });
      clearTimeout(timer);
      resetStall();
      if (upstream.status !== 200 && upstream.status !== 206) {
        if (upstream.status === 412 || (upstream.status >= 300 && upstream.status < 400)) {
          throw new InvalidRepresentation(`下载来源或版本发生变化（HTTP ${upstream.status}）`);
        }
        response.writeHead(upstream.status, { 'Content-Length': '0' }).end();
        return;
      }
      if (upstream.url !== options.url || strongEtag(upstream.headers.get('etag')) !== options.etag) {
        throw new InvalidRepresentation('下载响应的来源或 ETag 与探测结果不一致');
      }
      const encoding = upstream.headers.get('content-encoding');
      if ((encoding && encoding.toLowerCase() !== 'identity') || isHtmlLike((upstream.headers.get('content-type') ?? '').toLowerCase())) {
        throw new InvalidRepresentation('下载响应不是预期的原始文件内容');
      }

      let length = options.expectedSize;
      const contentRange = upstream.headers.get('content-range');
      if (upstream.status === 206) {
        const match = contentRange?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
        if (!match) throw new InvalidRepresentation('206 响应缺少有效的 Content-Range');
        const [start, end, total] = match.slice(1).map(Number);
        if (![start, end, total].every(Number.isSafeInteger) || total !== options.expectedSize ||
            start !== Number(requested?.[1] ?? 0) || end < start || end >= total ||
            (requested?.[2] && end > Number(requested[2]))) {
          throw new InvalidRepresentation('Content-Range 与请求范围或文件完整大小不一致');
        }
        length = end - start + 1;
      } else if (contentRange) {
        throw new InvalidRepresentation('完整响应包含了 Content-Range');
      }
      const declared = upstream.headers.get('content-length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== length)) {
        throw new InvalidRepresentation(`文件或范围大小不一致（预期 ${length}，服务器 ${declared}）`);
      }
      if (!upstream.body) throw new InvalidRepresentation('下载响应没有正文');

      response.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
        'Content-Length': String(length),
        ETag: options.etag,
        ...(contentRange ? { 'Content-Range': contentRange } : {}),
      });
      let received = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length;
          resetStall();
          if (received > length) callback(new InvalidRepresentation('收到的字节数超过范围长度'));
          else callback(null, chunk);
        },
        flush(callback) {
          callback(received === length ? undefined : new Error(`上游连接提前结束（${received}/${length}）`));
        },
      });
      await pipeline(
        Readable.fromWeb(upstream.body as unknown as WebReadableStream<Uint8Array>), counter, response,
        { signal: controller.signal },
      );
    } catch (error) {
      if (error instanceof InvalidRepresentation) failure ??= error;
      if (response.headersSent) response.destroy();
      else if (!response.destroyed) response.writeHead(failure ? 412 : 503, { 'Content-Length': '0' }).end();
    } finally {
      clearTimeout(timer);
      controller.abort();
      await upstream?.body?.cancel().catch(() => undefined);
      controllers.delete(controller);
    }
  }

  const server = createServer((request, response) => {
    const task = serve(request, response);
    pending.add(task);
    void task.finally(() => pending.delete(task));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`,
    failure: () => failure,
    close: async () => {
      for (const controller of controllers) controller.abort();
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      await Promise.allSettled(pending);
    },
  };
}
