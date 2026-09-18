import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { RequestListener, ServerResponse } from 'http';
import { downloadWithNode } from '../../src/utils/nodeDownload.js';
import { DirectDownloader } from '../../src/tools/DirectDownloader.js';
import { startServer } from '../helpers/httpServer.js';

// 只去掉重试之间的等待，HTTP、流、文件系统和超时机制均使用真实实现。
jest.mock('timers/promises', () => ({ setTimeout: jest.fn(async () => undefined) }));

function send(response: ServerResponse, body: string, headers: Record<string, string> = {}, status = 200): void {
  response.writeHead(status, {
    'Content-Type': 'application/octet-stream',
    ...(!headers['Transfer-Encoding'] ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}),
    ...headers,
  });
  response.end(body);
}

describe('Node download integrity', () => {
  let directory: string;
  let destPath: string;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let handler: RequestListener;
  let requests: Array<{ path?: string; range?: string; ifRange?: string | string[]; encoding?: string; finalExists: boolean }>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'searchgal-download-test-'));
    destPath = join(directory, 'game.bin');
    requests = [];
    handler = (_request, response) => send(response, '', {}, 503);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    server = await startServer((request, response) => {
      requests.push({
        path: request.url, range: request.headers.range, ifRange: request.headers['if-range'],
        encoding: request.headers['accept-encoding'], finalExists: existsSync(destPath),
      });
      handler(request, response);
    });
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
    await rm(directory, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  function options(path = '/file.bin', headers?: Record<string, string>) {
    return { url: `${server!.url}${path}`, destPath, expectedSize: 10, headers };
  }

  async function seedPartial(path = '/file.bin', headers?: Record<string, string>) {
    let first = true;
    handler = (_request, response) => {
      if (first) {
        first = false;
        send(response, 'ABCDE', { ETag: '"v1"', 'Content-Range': 'bytes 0-4/10' }, 206);
      } else {
        send(response, '', {}, 503);
      }
    };
    await expect(downloadWithNode(options(path, headers))).rejects.toThrow('HTTP 503');
    expect(await readFile(`${destPath}.part`, 'utf8')).toBe('ABCDE');
    requests.length = 0;
  }

  it('never appends another source to a same-named partial file', async () => {
    await seedPartial('/source-a');
    handler = (request, response) => request.headers.range
      ? send(response, '67890', { ETag: '"v1"', 'Content-Range': 'bytes 5-9/10' }, 206)
      : send(response, '1234567890', { ETag: '"v1"' });
    await downloadWithNode(options('/source-b'));
    expect(requests.map(r => r.range)).toEqual([undefined]);
    expect(await readFile(destPath, 'utf8')).toBe('1234567890');
  });

  it('binds partial files to representation-affecting request headers', async () => {
    await seedPartial('/file.bin', { Authorization: 'Bearer account-a' });
    handler = (_request, response) => send(response, '1234567890', { ETag: '"v1"' });
    await downloadWithNode(options('/file.bin', { Authorization: 'Bearer account-b' }));
    expect(requests[0].range).toBeUndefined();
    expect(await readFile(destPath, 'utf8')).toBe('1234567890');
  });

  it.each(['ABCDE', 'ABCDEFGHIJ'])('does not trust legacy partial bytes, even at the expected size: %s', async partial => {
    await writeFile(`${destPath}.part`, partial);
    handler = (_request, response) => send(response, '1234567890');
    await downloadWithNode(options());
    expect(requests.map(r => r.range)).toEqual([undefined]);
    expect(await readFile(destPath, 'utf8')).toBe('1234567890');
  });

  it('restarts safely if partial metadata is corrupt', async () => {
    await seedPartial();
    await writeFile(`${destPath}.part.json`, '{broken');
    handler = (_request, response) => send(response, '1234567890');
    await downloadWithNode(options());
    expect(requests[0].range).toBeUndefined();
    expect(await readFile(destPath, 'utf8')).toBe('1234567890');
  });

  it('resumes with Range and If-Range and removes metadata only after completion', async () => {
    await seedPartial();
    handler = (_request, response) => send(response, 'FGHIJ', { ETag: '"v1"', 'Content-Range': 'bytes 5-9/10' }, 206);
    await downloadWithNode(options());
    expect(requests[0]).toMatchObject({ range: 'bytes=5-', ifRange: '"v1"', finalExists: false });
    // Node 的 fetch 在 Range 请求中可能再附加一次 identity。
    expect(new Set(requests[0].encoding?.split(/,\s*/))).toEqual(new Set(['identity']));
    expect(await readFile(destPath, 'utf8')).toBe('ABCDEFGHIJ');
    expect(existsSync(`${destPath}.part`)).toBe(false);
    expect(existsSync(`${destPath}.part.json`)).toBe(false);
  });

  it('continues after bytes 5-7/10 instead of publishing an 8-byte file', async () => {
    await seedPartial();
    handler = (request, response) => request.headers.range === 'bytes=5-'
      ? send(response, 'FGH', { ETag: '"v1"', 'Content-Range': 'bytes 5-7/10' }, 206)
      : send(response, 'IJ', { ETag: '"v1"', 'Content-Range': 'bytes 8-9/10' }, 206);
    await downloadWithNode(options());
    expect(requests.map(r => r.range)).toEqual(['bytes=5-', 'bytes=8-']);
    expect(requests.every(r => !r.finalExists)).toBe(true);
    expect(await readFile(destPath, 'utf8')).toBe('ABCDEFGHIJ');
  });

  it('accepts more than five valid range segments without exhausting failure retries', async () => {
    const content = 'ABCDEFGHIJ';
    handler = (request, response) => {
      const start = Number(request.headers.range?.match(/bytes=(\d+)-/)?.[1] ?? 0);
      send(response, content[start], { ETag: '"v1"', 'Content-Range': `bytes ${start}-${start}/10` }, 206);
    };
    await downloadWithNode(options());
    expect(requests).toHaveLength(10);
    expect(await readFile(destPath, 'utf8')).toBe(content);
  });

  it.each([200, 206])('restarts instead of appending when the server changes ETag (HTTP %s)', async status => {
    await seedPartial();
    handler = (request, response) => request.headers.range && status === 206
      ? send(response, '67890', { ETag: '"v2"', 'Content-Range': 'bytes 5-9/10' }, 206)
      : send(response, '1234567890', { ETag: '"v2"' });
    await downloadWithNode(options());
    expect(await readFile(destPath, 'utf8')).toBe('1234567890');
    expect(requests.map(r => r.range)).toEqual(status === 206 ? ['bytes=5-', undefined] : ['bytes=5-']);
  });

  it('does not reuse an ETag across a changed redirect destination', async () => {
    await seedPartial();
    handler = (request, response) => {
      if (request.url === '/file.bin') {
        response.writeHead(302, { Location: '/new-file.bin' });
        response.end();
      } else if (request.headers.range) {
        send(response, '67890', { ETag: '"v1"', 'Content-Range': 'bytes 5-9/10' }, 206);
      } else {
        send(response, '1234567890', { ETag: '"v1"' });
      }
    };
    await downloadWithNode(options());
    expect(requests.filter(r => r.path === '/new-file.bin').map(r => r.range)).toEqual(['bytes=5-', undefined]);
    expect(await readFile(destPath, 'utf8')).toBe('1234567890');
  });

  it.each([undefined, 'W/"v1"'])('restarts after an incomplete full response without a strong validator (%s)', async etag => {
    let first = true;
    handler = (_request, response) => {
      if (first) {
        first = false;
        send(response, 'ABCDE', { 'Transfer-Encoding': 'chunked', ...(etag ? { ETag: etag } : {}) });
      } else {
        send(response, '1234567890');
      }
    };
    await downloadWithNode(options());
    expect(requests.map(r => r.range)).toEqual([undefined, undefined]);
    expect(await readFile(destPath, 'utf8')).toBe('1234567890');
  });

  it.each([200, 206])('does not override expectedSize with a shorter HTTP %s response', async status => {
    handler = (_request, response) => send(response, 'ABCDEFGH', status === 206 ? { 'Content-Range': 'bytes 0-7/8' } : {}, status);
    await expect(downloadWithNode(options())).rejects.toThrow('完整大小不一致');
    expect(existsSync(destPath)).toBe(false);
  });

  it.each([
    undefined, 'bytes 4-8/10', 'bytes 5-10/10', 'bytes 5-3/10', 'bytes 5-9/*', 'items 5-9/10', 'bytes 5-7/10',
  ])('rejects invalid or inconsistent Content-Range before appending: %s', async range => {
    await seedPartial();
    handler = (_request, response) => send(response, 'FGHIJ', { ETag: '"v1"', ...(range ? { 'Content-Range': range } : {}) }, 206);
    await expect(downloadWithNode(options())).rejects.toThrow('Content-Range');
    expect(existsSync(destPath)).toBe(false);
    expect(await readFile(`${destPath}.part`, 'utf8')).toBe('ABCDE');
  });

  it('preserves the previously learned total when expectedSize is absent', async () => {
    await seedPartial();
    handler = (_request, response) => send(response, 'FGHIJK', { ETag: '"v1"', 'Content-Range': 'bytes 5-10/11' }, 206);
    await expect(downloadWithNode({ ...options(), expectedSize: undefined })).rejects.toThrow('完整大小发生变化');
    expect(existsSync(destPath)).toBe(false);
  });

  it('retains the known total when the same version ignores Range and omits Content-Length', async () => {
    await seedPartial();
    let first = true;
    handler = (_request, response) => {
      if (first) {
        first = false;
        send(response, 'ABCDEFGH', { ETag: '"v1"', 'Transfer-Encoding': 'chunked' });
      } else {
        send(response, '', {}, 503);
      }
    };
    await expect(downloadWithNode({ ...options(), expectedSize: undefined })).rejects.toThrow('HTTP 503');
    expect(existsSync(destPath)).toBe(false);
    expect((await stat(`${destPath}.part`)).size).toBe(8);
  });

  it('never publishes a range response whose body ended early', async () => {
    await seedPartial();
    handler = (request, response) => request.headers.range === 'bytes=5-'
      ? send(response, 'FGH', { ETag: '"v1"', 'Content-Range': 'bytes 5-9/10', 'Transfer-Encoding': 'chunked' }, 206)
      : send(response, '', {}, 503);
    await expect(downloadWithNode(options())).rejects.toThrow('HTTP 503');
    expect(requests.map(r => r.range)).toEqual(['bytes=5-', 'bytes=8-']);
    expect(existsSync(destPath)).toBe(false);
    expect((await stat(`${destPath}.part`)).size).toBe(8);
  });

  it('rejects excess bytes beyond Content-Range', async () => {
    await seedPartial();
    handler = (_request, response) => send(response, 'FGHIJ', {
      ETag: '"v1"', 'Content-Range': 'bytes 5-7/10', 'Transfer-Encoding': 'chunked',
    }, 206);
    await expect(downloadWithNode(options())).rejects.toThrow('超过声明');
    expect(existsSync(destPath)).toBe(false);
    expect(existsSync(`${destPath}.part`)).toBe(false);
  });

  it('only accepts a complete partial file after a matching 416 validator and total', async () => {
    await seedPartial();
    await writeFile(`${destPath}.part`, 'ABCDEFGHIJ');
    handler = (_request, response) => send(response, '', { ETag: '"v1"', 'Content-Range': 'bytes */10' }, 416);
    await downloadWithNode(options());
    expect(requests.map(r => r.range)).toEqual(['bytes=10-']);
    expect(await readFile(destPath, 'utf8')).toBe('ABCDEFGHIJ');
  });

  it('restarts on an unvalidated 416 even when the partial size looks complete', async () => {
    await seedPartial();
    await writeFile(`${destPath}.part`, 'ABCDEFGHIJ');
    handler = (request, response) => request.headers.range
      ? send(response, '', { 'Content-Range': 'bytes */10' }, 416)
      : send(response, '1234567890', { ETag: '"v2"' });
    await downloadWithNode(options());
    expect(requests.map(r => r.range)).toEqual(['bytes=10-', undefined]);
    expect(await readFile(destPath, 'utf8')).toBe('1234567890');
  });

  it('rejects a content encoding that makes range bytes ambiguous', async () => {
    handler = (_request, response) => send(response, '1234567890', { 'Content-Encoding': 'gzip' });
    await expect(downloadWithNode(options())).rejects.toThrow('Accept-Encoding');
    expect(existsSync(destPath)).toBe(false);
  });

  it('does not let DirectDownloader skip an unrelated same-sized final file', async () => {
    await writeFile(destPath, 'ABCDEFGHIJ');
    handler = (request, response) => {
      if (request.method === 'HEAD') {
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': '10' });
        response.end();
      } else {
        send(response, '1234567890');
      }
    };
    const downloader = new DirectDownloader({ aria2c: false });
    const result = await downloader.download({ kind: 'http', url: options().url, filename: 'game.bin', size: 10 }, { outputDir: directory });
    expect(result).toEqual({ success: true, filepath: destPath });
    expect(requests).toHaveLength(2);
    expect(await readFile(destPath, 'utf8')).toBe('1234567890');
  });
});
