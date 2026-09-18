import { isNoProxy } from '../../src/utils/proxy.js';

jest.mock('undici', () => ({
  Agent: jest.fn(() => ({ dispatch: jest.fn(() => true), close: jest.fn(async () => undefined) })),
  ProxyAgent: jest.fn(() => ({ dispatch: jest.fn(() => true), close: jest.fn(async () => undefined) })),
  setGlobalDispatcher: jest.fn(),
}));

describe('proxy routing', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const key of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'no_proxy', 'NO_PROXY']) {
      delete process.env[key];
    }
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it.each([
    'http://localhost:8787', 'http://api.localhost', 'http://localhost.',
    'http://127.0.0.1', 'http://127.42.0.8:8787',
    'http://[::1]:8787', 'http://[0:0:0:0:0:0:0:1]:8787',
  ])('always bypasses loopback: %s', url => {
    expect(isNoProxy(url)).toBe(true);
  });

  it.each([
    ['*', 'https://anywhere.test:8443', true],
    ['example.com', 'https://example.com', true],
    ['example.com', 'https://files.example.com', true],
    ['.example.com', 'https://example.com', true],
    ['.example.com', 'https://a.b.example.com', true],
    ['*.example.com', 'https://example.com', false],
    ['*.example.com', 'https://a.example.com', true],
    ['.example.com', 'https://badexample.com', false],
    ['example.com', 'https://example.com.evil.test', false],
    ['example.com:8787', 'http://example.com:8787', true],
    ['example.com:8787', 'http://example.com:8788', false],
    ['.example.com:443', 'https://files.example.com', true],
    ['example.com:80', 'http://example.com', true],
    ['example.com:80', 'https://example.com', false],
    ['[2001:db8::1]:8787', 'http://[2001:db8::1]:8787', true],
    ['[2001:db8::1]:8787', 'http://[2001:db8::1]:80', false],
    ['2001:db8::1', 'http://[2001:db8::1]:8787', true],
    ['[2001:0db8:0:0:0:0:0:1]', 'http://[2001:db8::1]', true],
    ['  other.test , .EXAMPLE.COM  ', 'https://EXAMPLE.COM.', true],
    ['example.com:invalid', 'https://example.com', false],
  ])('no_proxy=%s routes %s as direct=%s', (rule, url, expected) => {
    process.env.no_proxy = rule as string;
    expect(isNoProxy(url as string)).toBe(expected);
  });

  it('reads uppercase NO_PROXY and gives a defined lowercase value precedence', () => {
    process.env.NO_PROXY = '*';
    expect(isNoProxy('https://example.com')).toBe(true);
    process.env.no_proxy = '';
    expect(isNoProxy('https://example.com')).toBe(false);
  });

  it.each(['not-a-url', '', 'http://localhost.evil.test', 'http://128.0.0.1', 'http://127.example.com'])('does not bypass %s', url => {
    expect(isNoProxy(url)).toBe(false);
  });

  it('does not install a dispatcher without proxy configuration', () => {
    jest.isolateModules(() => {
      const { configureProxyFromEnv, isProxyConfigured } = require('../../src/utils/proxy.js');
      const { setGlobalDispatcher } = require('undici');
      configureProxyFromEnv();
      expect(setGlobalDispatcher).not.toHaveBeenCalled();
      expect(isProxyConfigured()).toBe(false);
    });
  });

  it('dispatches bypassed origins directly and other origins through the proxy', async () => {
    process.env.https_proxy = 'http://127.0.0.1:8080';
    process.env.no_proxy = '.example.com:443';
    let dispatcher: { dispatch: (opts: { origin: string | URL }, handler: object) => boolean; close: () => Promise<void> };
    let direct: { dispatch: jest.Mock; close: jest.Mock };
    let proxy: { dispatch: jest.Mock; close: jest.Mock };
    jest.isolateModules(() => {
      const { configureProxyFromEnv, isProxyConfigured } = require('../../src/utils/proxy.js');
      const { Agent, ProxyAgent, setGlobalDispatcher } = require('undici');
      configureProxyFromEnv();
      configureProxyFromEnv();
      expect(setGlobalDispatcher).toHaveBeenCalledTimes(1);
      expect(ProxyAgent).toHaveBeenCalledWith('http://127.0.0.1:8080');
      expect(isProxyConfigured()).toBe(true);
      dispatcher = setGlobalDispatcher.mock.calls[0][0];
      direct = Agent.mock.results[0].value;
      proxy = ProxyAgent.mock.results[0].value;
    });
    const handler = {};
    const local = { origin: new URL('http://[::1]:8787') };
    const excluded = { origin: 'https://files.example.com' };
    const remote = { origin: 'https://elsewhere.test' };
    expect(dispatcher!.dispatch(local, handler)).toBe(true);
    dispatcher!.dispatch(excluded, handler);
    dispatcher!.dispatch(remote, handler);
    expect(direct!.dispatch.mock.calls).toEqual([[local, handler], [excluded, handler]]);
    expect(proxy!.dispatch.mock.calls).toEqual([[remote, handler]]);
    await dispatcher!.close();
    expect(direct!.close).toHaveBeenCalledTimes(1);
    expect(proxy!.close).toHaveBeenCalledTimes(1);
  });
});
