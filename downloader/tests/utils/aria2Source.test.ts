import type { RequestListener } from 'http';
import { createAria2Source } from '../../src/utils/aria2Source.js';
import { startServer } from '../helpers/httpServer.js';

describe('aria2 response validation', () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  let source: Awaited<ReturnType<typeof createAria2Source>>;
  let handler: RequestListener;
  let requests: Array<{ path?: string; range?: string; ifMatch?: string | string[]; encoding?: string; authorization?: string }>;

  beforeEach(async () => {
    requests = [];
    handler = (_request, response) => {
      response.writeHead(206, { 'Content-Type': 'application/octet-stream', 'Content-Length': '3', 'Content-Range': 'bytes 5-7/10', ETag: '"v1"' });
      response.end('FGH');
    };
    server = await startServer((request, response) => {
      requests.push({ path: request.url, range: request.headers.range, ifMatch: request.headers['if-match'], encoding: request.headers['accept-encoding'], authorization: request.headers.authorization });
      handler(request, response);
    });
    source = await createAria2Source({ url: server.url + '/file', expectedSize: 10, etag: '"v1"' }, new Headers({ Authorization: 'Bearer fixture' }));
  });

  afterEach(async () => {
    await source.close();
    await server.close();
  });

  const getRange = () => fetch(source.url, { headers: { Range: 'bytes=5-7' } });

  it('forwards the exact validated byte range and pins credentials and version upstream', async () => {
    const response = await getRange();
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 5-7/10');
    expect(await response.text()).toBe('FGH');
    expect(requests[0]).toMatchObject({ range: 'bytes=5-7', ifMatch: '"v1"', authorization: 'Bearer fixture' });
    expect(new Set(requests[0].encoding?.split(/,\s*/))).toEqual(new Set(['identity']));
    expect(source.failure()).toBeUndefined();
  });

  it.each([
    { ETag: '"v2"' },
    { 'Content-Range': 'bytes 4-6/10' },
    { 'Content-Range': 'bytes 5-7/8' },
    { 'Content-Length': '4' },
    { 'Content-Type': 'TEXT/HTML' },
    { 'Content-Encoding': 'gzip' },
  ])('rejects an inconsistent upstream representation %j before handing bytes to aria2', async headers => {
    handler = (_request, response) => {
      response.writeHead(206, {
        'Content-Type': 'application/octet-stream', 'Content-Length': '3', 'Content-Range': 'bytes 5-7/10', ETag: '"v1"', ...headers,
      });
      response.end('FGH');
    };
    const response = await getRange();
    expect(response.status).toBe(412);
    expect(await response.text()).toBe('');
    expect(source.failure()).toBeInstanceOf(Error);
    expect((await getRange()).status).toBe(412);
    expect(requests).toHaveLength(1);
  });

  it('does not follow a GET redirect even if its target would reuse the same ETag', async () => {
    handler = (_request, response) => {
      response.writeHead(302, { Location: '/other' });
      response.end();
    };
    expect((await getRange()).status).toBe(412);
    expect(source.failure()?.message).toContain('HTTP 302');
    expect(requests.map(r => r.path)).toEqual(['/file']);
  });

  it('rejects an eight-byte full response when the known complete size is ten', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': '8', ETag: '"v1"' });
      response.end('ABCDEFGH');
    };
    expect((await fetch(source.url)).status).toBe(412);
    expect(source.failure()?.message).toContain('预期 10，服务器 8');
  });

  it('ends the connection with an error if a range body is truncated', async () => {
    handler = (_request, response) => {
      response.writeHead(206, { 'Content-Type': 'application/octet-stream', 'Content-Range': 'bytes 5-7/10', ETag: '"v1"' });
      response.write('F');
      setTimeout(() => response.end(), 30);
    };
    const response = await getRange();
    await expect(response.text()).rejects.toThrow();
  });

  it('only serves its private transfer path', async () => {
    expect((await fetch(new URL('/another-transfer', source.url))).status).toBe(404);
    expect(requests).toHaveLength(0);
  });
});
