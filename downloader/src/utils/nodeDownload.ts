import { createWriteStream } from 'fs';
import { readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import { setTimeout as delay } from 'timers/promises';
import { BROWSER_UA, isHtmlLike, strongEtag } from './http.js';
import { formatBytes, formatDuration } from './format.js';
import type { DownloadProgress } from '../types/index.js';

const MAX_ATTEMPTS = 5;
const HEADER_TIMEOUT_MS = 30_000;
const STALL_TIMEOUT_MS = 60_000;
const PROGRESS_INTERVAL_MS = 500;

export interface NodeDownloadOptions {
  url: string;
  destPath: string;
  headers?: Record<string, string>;
  expectedSize?: number;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
  quiet?: boolean;
}

interface PartialMetadata {
  version: 1;
  source: string;
  resource: string;
  etag?: string;
  total?: number;
}

export interface DownloadedRepresentation {
  resource: string;
  etag?: string;
  size: number;
}

/**
 * 写到 `.part`，校验完整长度后再改名。来源和强 ETag 保存在 `.part.json`，
 * 只有同一资源才发送 Range / If-Range；旧断点或无强校验器时从头下载。
 */
export async function downloadWithNode(options: NodeDownloadOptions): Promise<DownloadedRepresentation> {
  options.signal?.throwIfAborted();
  if (options.expectedSize !== undefined && !isSize(options.expectedSize)) {
    throw new FatalDownloadError('预期文件大小必须是非负安全整数');
  }
  const partPath = `${options.destPath}.part`;
  const metadataPath = `${partPath}.json`;
  const headers = new Headers(options.headers);
  if (!headers.has('User-Agent')) headers.set('User-Agent', BROWSER_UA);
  // 字节范围和长度必须对应落盘的字节，不能让 fetch 自动解压后再追加。
  headers.set('Accept-Encoding', 'identity');
  headers.delete('Range');
  headers.delete('If-Range');
  const source = fingerprint([new URL(options.url).href, [...headers.entries()]]);
  let lastError: unknown;
  let failures = 0;

  while (failures < MAX_ATTEMPTS) {
    options.signal?.throwIfAborted();
    try {
      const done = await downloadOnce(options, partPath, metadataPath, source, headers);
      if (done) {
        const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as PartialMetadata;
        const size = (await stat(partPath)).size;
        await rename(partPath, options.destPath);
        await unlink(metadataPath).catch(() => undefined);
        return { resource: metadata.resource, etag: metadata.etag, size };
      }
      // 合法的分段响应继续请求下一段，不占用网络失败的重试次数。
    } catch (error) {
      options.signal?.throwIfAborted();
      lastError = error;
      if (error instanceof FatalDownloadError) throw error;
      failures++;
      if (!options.quiet) {
        process.stdout.write('\n');
        console.log(`⚠️  第 ${failures} 次下载中断: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (failures < MAX_ATTEMPTS) {
        if (!options.quiet) console.log('   3 秒后重试...');
        await delay(3000, undefined, { signal: options.signal });
      }
    }
  }

  throw new Error(`下载失败，已重试 ${MAX_ATTEMPTS} 次: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

class FatalDownloadError extends Error {}

async function downloadOnce(
  options: NodeDownloadOptions,
  partPath: string,
  metadataPath: string,
  source: string,
  baseHeaders: Headers,
): Promise<boolean> {
  const { existing, metadata } = await readPartial(partPath, metadataPath, source, options.expectedSize);

  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const headerTimer = setTimeout(() => controller.abort(), HEADER_TIMEOUT_MS);
  const headers = new Headers(baseHeaders);
  if (existing > 0 && metadata?.etag) {
    headers.set('Range', `bytes=${existing}-`);
    headers.set('If-Range', metadata.etag);
  }

  let response: Response;
  try {
    response = await fetch(options.url, { headers, redirect: 'follow', signal });
  } finally {
    clearTimeout(headerTimer);
  }

  try {
    const resource = fingerprint(response.url || options.url);
    const etag = strongEtag(response.headers.get('etag'));

    if (response.status === 416 && existing > 0) {
      const match = response.headers.get('content-range')?.match(/^bytes \*\/(\d+)$/i);
      const total = match ? Number(match[1]) : undefined;
      if (metadata?.resource === resource && metadata.etag === etag && total === existing &&
          (metadata.total === undefined || metadata.total === total) &&
          (options.expectedSize === undefined || options.expectedSize === total)) return true;
      await discardPartial(partPath, metadataPath);
      throw new Error('断点无法通过服务器校验，重新下载');
    }
    if (response.status !== 200 && response.status !== 206) {
      throw new FatalDownloadError(`HTTP ${response.status} ${response.statusText}`);
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (isHtmlLike(contentType)) {
      throw new FatalDownloadError(`链接返回的是网页（${contentType}），不是文件`);
    }
    const encoding = response.headers.get('content-encoding');
    if (encoding && encoding.toLowerCase() !== 'identity') {
      throw new FatalDownloadError(`服务器未遵守 Accept-Encoding: identity（${encoding}）`);
    }

    // 200 表示服务器忽略 Range 或资源已更新，此时必须覆盖旧断点。
    const offset = response.status === 206 ? existing : 0;
    if (offset > 0 && (metadata?.etag !== etag || metadata?.resource !== resource)) {
      await discardPartial(partPath, metadataPath);
      throw new Error('续传资源或 ETag 已变化，重新下载');
    }

    const length = parseLength(response.headers.get('content-length'));
    const range = response.status === 206 ? parseRange(response.headers.get('content-range')) : undefined;
    if (range && (range.start !== offset || (length !== undefined && length !== range.end - range.start + 1))) {
      throw new FatalDownloadError('Content-Range 与请求偏移或 Content-Length 不一致');
    }
    if (response.status === 200 && response.headers.has('content-range')) {
      throw new FatalDownloadError('服务器在完整响应中返回了 Content-Range');
    }

    const declaredTotal = range?.total ?? length;
    if (options.expectedSize !== undefined && declaredTotal !== undefined && declaredTotal !== options.expectedSize) {
      throw new FatalDownloadError(`文件完整大小不一致（预期 ${options.expectedSize}，服务器 ${declaredTotal}）`);
    }
    const sameRepresentation = metadata?.etag === etag && metadata?.resource === resource;
    if (sameRepresentation && metadata?.total !== undefined && declaredTotal !== undefined && declaredTotal !== metadata.total) {
      throw new FatalDownloadError('续传文件的完整大小发生变化');
    }
    const total = options.expectedSize ?? declaredTotal ?? (sameRepresentation ? metadata?.total : undefined);
    const bodyLength = range ? range.end - range.start + 1 : length;
    if (range && range.end + 1 < range.total && !etag) {
      throw new FatalDownloadError('分段响应缺少强 ETag，无法安全续传');
    }
    const body = response.body;
    if (!body) throw new Error('响应没有正文');

    // 先清空旧字节，再写入新身份；中途退出也不能把旧内容绑定到新来源。
    if (offset === 0) await writeFile(partPath, '');
    const nextMetadata: PartialMetadata = { version: 1, source, resource, etag, total };
    await writeFile(metadataPath, JSON.stringify(nextMetadata), { mode: 0o600 });

    const progress = new ProgressReporter(offset, total, options.onProgress, options.quiet);
    let received = 0;
    let stallTimer: NodeJS.Timeout | undefined;
    const resetStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
    };
    resetStall();

    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if ((bodyLength !== undefined && received > bodyLength) || (total !== undefined && offset + received > total)) {
          callback(new FatalDownloadError('收到的字节数超过声明的文件或范围长度'));
          return;
        }
        progress.add(chunk.length);
        resetStall();
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        Readable.fromWeb(body as unknown as WebReadableStream<Uint8Array>),
        counter,
        createWriteStream(partPath, { flags: offset > 0 ? 'a' : 'w' }),
        { signal },
      );
    } catch (error) {
      if (error instanceof FatalDownloadError) await discardPartial(partPath, metadataPath);
      options.signal?.throwIfAborted();
      if (controller.signal.aborted) throw new Error(`${STALL_TIMEOUT_MS / 1000} 秒没有收到数据`);
      throw error;
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      progress.finish();
    }

    const finalSize = (await stat(partPath)).size;
    if (finalSize !== offset + received) throw new FatalDownloadError('落盘文件大小与收到的字节数不一致');
    if (bodyLength !== undefined && received !== bodyLength) {
      throw new Error(`响应正文不完整（${received} / ${bodyLength} 字节）`);
    }
    if (total !== undefined && finalSize !== total) {
      if (range && finalSize < total) return false;
      throw new Error(`连接提前结束（${formatBytes(finalSize)} / ${formatBytes(total)}）`);
    }
    return true;
  } finally {
    await response.body?.cancel().catch(() => undefined);
  }
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseLength(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d+$/.test(value) || !isSize(Number(value))) throw new FatalDownloadError('无效的 Content-Length');
  return Number(value);
}

function parseRange(value: string | null): { start: number; end: number; total: number } {
  const match = value?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
  if (!match) throw new FatalDownloadError('206 响应缺少有效的 Content-Range 完整长度');
  const [start, end, total] = match.slice(1).map(Number);
  if (![start, end, total].every(isSize) || end < start || end >= total) {
    throw new FatalDownloadError('无效的 Content-Range');
  }
  return { start, end, total };
}

function ignoreMissing(error: unknown): undefined {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  return undefined;
}

async function discardPartial(partPath: string, metadataPath: string): Promise<void> {
  await unlink(partPath).catch(ignoreMissing);
  await unlink(metadataPath).catch(ignoreMissing);
}

async function readPartial(
  partPath: string, metadataPath: string, source: string, expectedSize?: number,
): Promise<{ existing: number; metadata?: PartialMetadata }> {
  const existing = (await stat(partPath).catch(ignoreMissing))?.size ?? 0;
  let metadata: PartialMetadata | undefined;
  try {
    metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as PartialMetadata;
  } catch (error) {
    if (!(error instanceof SyntaxError)) ignoreMissing(error);
  }
  if (existing > 0 && metadata?.version === 1 && metadata.source === source &&
      typeof metadata.resource === 'string' && typeof metadata.etag === 'string' && strongEtag(metadata.etag) &&
      (metadata.total === undefined || (isSize(metadata.total) && existing <= metadata.total)) &&
      (expectedSize === undefined || (existing <= expectedSize &&
        (metadata.total === undefined || metadata.total === expectedSize)))) {
    return { existing, metadata };
  }
  await discardPartial(partPath, metadataPath);
  return { existing: 0 };
}

class ProgressReporter {
  private received: number;
  private lastPrint = 0;
  private lastBytes: number;
  private lastTime = Date.now();
  private readonly startBytes: number;
  private readonly startTime = Date.now();

  constructor(
    offset: number, private readonly total: number | undefined,
    private readonly onProgress?: (progress: DownloadProgress) => void,
    private readonly quiet = false,
  ) {
    this.received = offset;
    this.lastBytes = offset;
    this.startBytes = offset;
    this.onProgress?.({ receivedBytes: offset, totalBytes: total, bytesPerSecond: 0 });
  }

  add(bytes: number): void {
    this.received += bytes;
    const now = Date.now();
    if (now - this.lastPrint < PROGRESS_INTERVAL_MS) return;

    const instantSpeed = ((this.received - this.lastBytes) * 1000) / Math.max(1, now - this.lastTime);
    const averageSpeed = ((this.received - this.startBytes) * 1000) / Math.max(1, now - this.startTime);
    this.lastBytes = this.received;
    this.lastTime = now;
    this.lastPrint = now;

    this.onProgress?.({
      receivedBytes: this.received,
      totalBytes: this.total,
      bytesPerSecond: instantSpeed,
      etaSeconds: this.total !== undefined && averageSpeed > 0 ? Math.max(0, (this.total - this.received) / averageSpeed) : undefined,
    });
    if (this.quiet) return;

    let line = `   ⬇️  ${formatBytes(this.received)}`;
    if (this.total !== undefined && this.total > 0) {
      const percent = ((this.received / this.total) * 100).toFixed(1).padStart(5);
      const eta = averageSpeed > 0 ? formatDuration((this.total - this.received) / averageSpeed) : '--:--';
      line = `   ⬇️  ${percent}%  ${formatBytes(this.received)} / ${formatBytes(this.total)}  ${formatBytes(instantSpeed)}/s  剩余 ${eta}`;
    } else {
      line += `  ${formatBytes(instantSpeed)}/s`;
    }
    process.stdout.write(`\r${line.padEnd(100)}`);
  }

  finish(): void {
    this.onProgress?.({ receivedBytes: this.received, totalBytes: this.total, bytesPerSecond: 0 });
    if (!this.quiet && this.lastPrint > 0) process.stdout.write('\n');
  }
}
