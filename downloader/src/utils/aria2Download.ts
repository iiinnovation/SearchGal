import { createHash } from 'crypto';
import { readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import { basename, dirname } from 'path';
import { BROWSER_UA, isHtmlLike, probeUrl, strongEtag } from './http.js';
import { runInherit } from './process.js';
import { createAria2Source } from './aria2Source.js';
import type { NodeDownloadOptions } from './nodeDownload.js';

interface Aria2DownloadOptions extends NodeDownloadOptions {
  expectedSize: number;
  etag: string;
}

interface Metadata {
  version: 1;
  source: string;
  etag: string;
  total: number;
}

/** aria2 的多连接断点必须同时有版本身份和控制文件；最终文件从不作为断点。 */
export async function downloadWithAria2(options: Aria2DownloadOptions): Promise<void> {
  options.signal?.throwIfAborted();
  const { url, destPath, expectedSize, etag } = options;
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || !strongEtag(etag)) {
    throw new Error('aria2 下载需要有效的完整大小和强 ETag');
  }
  const headers = new Headers(options.headers);
  if (!headers.has('User-Agent')) headers.set('User-Agent', BROWSER_UA);
  headers.set('Accept-Encoding', 'identity');
  headers.delete('Range');
  headers.delete('If-Range');
  headers.set('If-Match', etag);
  const metadata: Metadata = {
    version: 1,
    source: createHash('sha256').update(JSON.stringify([new URL(url).href, [...headers.entries()]])).digest('hex'),
    etag,
    total: expectedSize,
  };
  const partPath = `${destPath}.aria2.part`;
  const controlPath = `${partPath}.aria2`;
  const metadataPath = `${partPath}.json`;
  const discard = async () => {
    for (const path of [partPath, controlPath, metadataPath]) await unlink(path).catch(ignoreMissing);
  };

  let previous: Metadata | undefined;
  try {
    previous = JSON.parse(await readFile(metadataPath, 'utf8')) as Metadata;
  } catch (error) {
    if (!(error instanceof SyntaxError)) ignoreMissing(error);
  }
  const partial = await stat(partPath).catch(ignoreMissing);
  const control = await stat(controlPath).catch(ignoreMissing);
  const resumable = previous?.version === 1 && previous.source === metadata.source &&
    previous.etag === etag && previous.total === expectedSize &&
    partial?.isFile() && partial.size <= expectedSize && control?.isFile() && control.size > 0;
  // 多连接会先写文件尾。没有控制文件时，即使长度已满也不能信任其完整性。
  if (!resumable) await discard();
  await writeFile(metadataPath, JSON.stringify(metadata), { mode: 0o600 });

  const source = await createAria2Source(options, headers);
  const args = [
    '--no-conf=true',
    source.url,
    '-d', dirname(destPath),
    '-o', basename(partPath),
    '-x', '16',
    '-s', '16',
    '-k', '1M',
    '--file-allocation=none',
    '--continue=true',
    '--auto-file-renaming=false',
    '--allow-overwrite=true',
    '--auto-save-interval=1',
    '--max-tries=5',
    '--retry-wait=3',
    '--connect-timeout=30',
    '--timeout=60',
    '--http-accept-gzip=false',
    '--http-proxy=',
    '--all-proxy=',
    '--no-proxy=127.0.0.1',
    '--summary-interval=0',
    '--console-log-level=warn',
    `--user-agent=${headers.get('User-Agent')}`,
  ];
  // 来源的凭据由校验服务使用，不传给子进程的命令行。
  args.push('--header=accept-encoding: identity', `--header=if-match: ${etag}`);

  if (!options.quiet) console.log('🔧 aria2c 下载中...');
  let code: number | null;
  try {
    ({ code } = await runInherit('aria2c', args, { signal: options.signal }));
  } finally {
    await source.close();
  }
  const failure = source.failure();
  if (failure) {
    await discard();
    throw failure;
  }
  if (code !== 0) throw new Error(`aria2c 退出码 ${code}（同一版本的有效断点可在下次运行时续传）`);

  try {
    const downloaded = await stat(partPath);
    if (!downloaded.isFile() || downloaded.size !== expectedSize) {
      throw new Error(`文件完整大小不一致（预期 ${expectedSize}，实际 ${downloaded.size}）`);
    }
    if (await stat(controlPath).catch(ignoreMissing)) throw new Error('aria2 控制文件仍存在，无法确认下载完整');
    const verified = await probeUrl(url, Object.fromEntries(headers), { signal: options.signal });
    if (!verified.ok || verified.finalUrl !== url || verified.etag !== etag || isHtmlLike(verified.contentType) ||
        (verified.size !== undefined && verified.size !== expectedSize)) {
      throw new Error('下载期间资源版本或完整大小发生变化');
    }
  } catch (error) {
    await discard();
    throw error;
  }
  await rename(partPath, destPath);
  await unlink(metadataPath).catch(ignoreMissing);
}

function ignoreMissing(error: unknown): undefined {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  return undefined;
}
