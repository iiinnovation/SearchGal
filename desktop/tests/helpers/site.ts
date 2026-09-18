import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { crc32, deflateRawSync } from 'node:zlib';
import type { SearchResult } from '../../../downloader/src/types';

export interface Resource {
  body: Buffer;
  type?: string;
  etag?: string;
  delayMs?: number;
  status?: number;
}

/** A real ZIP with a central directory, extracted by the OS in the UI tests. */
export function fixtureArchive() {
  const payload = Buffer.alloc(1024 * 1024);
  let seed = 0x12345678;
  for (let i = 0; i < payload.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    payload[i] = seed & 255;
  }
  const entries = new Map([
    ['payload.bin', payload],
    ['readme.txt', Buffer.from('SearchGal 桌面端验证数据，仅用于下载与解压测试。\n')],
  ]);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const filename = Buffer.from(name);
    const compressed = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, filename, compressed); centralParts.push(central, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return { bytes: Buffer.concat([...localParts, central, end]), entries };
}

export async function startSite() {
  const archive = fixtureArchive();
  const resources = new Map<string, Resource>([
    ['/demo.zip', { body: archive.bytes, etag: '"demo-v1"', delayMs: 25 }],
    ['/bundle', { body: Buffer.from('<a href="/game.7z.001">1</a><a href="/game.7z.002">2</a>'), type: 'text/html' }],
    ['/game.7z.001', { body: Buffer.alloc(32 * 1024, 0x41), etag: '"volume-one"' }],
    ['/game.7z.002', { body: Buffer.alloc(32 * 1024, 0x42), etag: '"volume-two"' }],
  ]);
  const requests: Array<{ method: string; path: string; range?: string; ifRange?: string }> = [];
  const llmResponses: unknown[] = [];
  const llmRequests: Array<{ authorization?: string; body: { model: string; messages: Array<{ content: string }> } }> = [];
  let url = '';
  let sources: Array<{ platform: string; path: string }> = [{ platform: '本地测试源', path: '/demo.zip' }];
  let interruptSearch = false;
  const sockets = new Set<import('node:net').Socket>();
  const server = createServer((request, response) => {
    void handle(request, response).catch(error => {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const ifRange = request.headers['if-range'];
    requests.push({ method: request.method ?? '', path, range: request.headers.range, ifRange: Array.isArray(ifRange) ? ifRange[0] : ifRange });
    if (path === '/v1/chat/completions' && request.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      llmRequests.push({ authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      if (!llmResponses.length) { response.writeHead(503).end('No fixture response'); return; }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(llmResponses.shift()) } }] }));
      return;
    }
    if (path === '/gal' && request.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const form = Buffer.concat(chunks).toString('utf8');
      const query = form.match(/name="game"\r\n\r\n([^\r]+)/)?.[1] ?? '';
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      const results: SearchResult[] = sources.map(source => ({
        name: source.platform, color: 'lime', tags: ['NoReq'], items: [{ name: query, url: url + source.path }],
      }));
      const events: object[] = [{ total: results.length }, ...results.map((result, i) => ({
        result, progress: { completed: i + 1, total: results.length },
      })), ...(interruptSearch ? [] : [{ done: true }])];
      const stream = Buffer.from(events.map(event => JSON.stringify(event) + '\n').join(''));
      // Deliberately split JSON and Chinese UTF-8 characters across network chunks.
      let offset = 0;
      let interruption: NodeJS.Timeout | undefined;
      const timer = setInterval(() => {
        const end = Math.min(offset + 13, stream.length);
        response.write(stream.subarray(offset, end)); offset = end;
        if (offset === stream.length) {
          clearInterval(timer);
          if (interruptSearch) interruption = setTimeout(() => response.destroy(), 1500);
          else response.end();
        }
      }, 2);
      response.once('close', () => { clearInterval(timer); clearTimeout(interruption); });
      return;
    }
    const resource = resources.get(path);
    if (!resource || resource.status) { response.writeHead(resource?.status ?? 404).end(); return; }
    const range = request.headers.range;
    const start = Number(range?.match(/^bytes=(\d+)-$/)?.[1] ?? 0);
    if (start >= resource.body.length) { response.writeHead(416, { 'Content-Range': `bytes */${resource.body.length}` }).end(); return; }
    response.writeHead(range ? 206 : 200, {
      'Content-Type': resource.type ?? 'application/octet-stream',
      'Content-Length': String(resource.body.length - start),
      ...(resource.etag ? { ETag: resource.etag } : {}),
      ...(range ? { 'Content-Range': `bytes ${start}-${resource.body.length - 1}/${resource.body.length}` } : {}),
    });
    if (request.method === 'HEAD') { response.end(); return; }
    if (!resource.delayMs) { response.end(resource.body.subarray(start)); return; }
    let offset = start;
    const timer = setInterval(() => {
      const end = Math.min(offset + 8192, resource.body.length);
      response.write(resource.body.subarray(offset, end)); offset = end;
      if (offset === resource.body.length) { clearInterval(timer); response.end(); }
    }, resource.delayMs);
    response.once('close', () => clearInterval(timer));
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  url = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  return {
    url, resources, requests, archive, llmResponses, llmRequests,
    setSources(value: typeof sources) { sources = value; },
    setSearchInterruption(value: boolean) { interruptSearch = value; },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
