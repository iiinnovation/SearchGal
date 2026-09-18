import type { RequestListener } from 'http';
import { fetchJson, fetchWithTimeout, readTextLimited } from '../../src/utils/http.js';
import { startServer } from '../helpers/httpServer.js';

describe('HTTP deadlines', () => {
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let handler: RequestListener;

  beforeEach(async () => {
    // 不断发送有效 JSON 的片段，模拟“有流量但迟迟不结束”的解析请求。
    handler = (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write('{"value":"');
      const interval = setInterval(() => response.write('x'), 10);
      const finish = setTimeout(() => response.end('"}'), 400);
      response.on('close', () => {
        clearInterval(interval);
        clearTimeout(finish);
      });
    };
    server = await startServer((request, response) => handler(request, response));
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
    jest.restoreAllMocks();
  });

  it.each(['text', 'json', 'limited'] as const)('keeps the deadline active after headers during %s reading', async reader => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const response = await fetchWithTimeout(server!.url, { timeoutMs: 80 });
    expect(response.status).toBe(200);
    const signal = fetchSpy.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    const body = reader === 'limited' ? readTextLimited(response) : response[reader]();
    await expect(body).rejects.toThrow();
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason.name).toBe('TimeoutError');
  });

  it('does not let fetchJson finish reading slow JSON after the deadline', async () => {
    await expect(fetchJson(server!.url, { timeoutMs: 20 })).rejects.toThrow();
  });

  it('also times out before response headers arrive', async () => {
    handler = (_request, response) => {
      const timer = setTimeout(() => response.end('late'), 400);
      response.on('close', () => clearTimeout(timer));
    };
    await expect(fetchWithTimeout(server!.url, { timeoutMs: 20 })).rejects.toThrow('请求超时');
  });

  it('preserves caller cancellation while the body is being read', async () => {
    const controller = new AbortController();
    const response = await fetchWithTimeout(server!.url, { timeoutMs: 2000, signal: controller.signal });
    const body = response.text();
    controller.abort(new Error('cancelled by caller'));
    await expect(body).rejects.toThrow();
  });

  it('does not relabel an already cancelled caller signal as a timeout', async () => {
    const reason = new Error('cancelled by caller');
    await expect(fetchWithTimeout(server!.url, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
  });

  it('keeps native response metadata and accepts Headers instances on successful requests', async () => {
    let userAgent: string | undefined;
    handler = (request, response) => {
      userAgent = request.headers['user-agent'];
      if (request.url === '/redirect') {
        response.writeHead(302, { Location: '/file' });
        response.end();
      } else {
        response.setHeader('Set-Cookie', 'session=test; Path=/');
        response.end('complete');
      }
    };
    const response = await fetchWithTimeout(`${server!.url}/redirect`, {
      timeoutMs: 2000, headers: new Headers({ 'User-Agent': 'test-agent' }),
    });
    expect(response.url).toBe(`${server!.url}/file`);
    expect(response.redirected).toBe(true);
    expect(response.headers.getSetCookie()).toEqual(['session=test; Path=/']);
    expect(userAgent).toBe('test-agent');
    expect(await response.text()).toBe('complete');
  });
});
