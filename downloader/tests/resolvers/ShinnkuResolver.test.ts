import { ShinnkuResolver } from '../../src/resolvers/ShinnkuResolver.js';
import type { Candidate } from '../../src/types/index.js';

describe('ShinnkuResolver', () => {
  let resolver: ShinnkuResolver;

  beforeEach(() => {
    resolver = new ShinnkuResolver();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('canResolve', () => {
    it('应该识别真红小站 URL', () => {
      expect(resolver.canResolve('https://www.shinnku.com/files/test.7z')).toBe(true);
      expect(resolver.canResolve('https://shinnku.com/files/test.7z')).toBe(true);
    });

    it('应该拒绝其他域名', () => {
      expect(resolver.canResolve('https://example.com/test.7z')).toBe(false);
      expect(resolver.canResolve('https://ggbases.com/resource/123')).toBe(false);
    });

    it('应该处理无效 URL', () => {
      expect(resolver.canResolve('not-a-url')).toBe(false);
      expect(resolver.canResolve('')).toBe(false);
    });
  });

  describe('resolve', () => {
    it('应该返回正确的文件 URL 结构', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
        '<a href="https://zd.shinnku.top/file/shinnku/0/win/test/test.7z">下载</a>',
        { headers: { 'Content-Type': 'text/html' } },
      ));
      const candidate: Candidate = {
        url: 'https://www.shinnku.com/files/shinnku/0/win/test/test.7z',
        name: 'test.7z',
        platform: '真红小站',
        platformTags: [],
        score: 190,
        reasons: [],
      };

      const plans = await resolver.resolve(candidate);

      expect(plans.length).toBeGreaterThan(0);
      expect(plans[0].files.length).toBe(1);
      expect(plans[0].files[0].kind).toBe('http');
      expect(plans[0].files[0].url).toContain('zd.shinnku.top');
      expect(plans[0].files[0].headers?.Referer).toBe(candidate.url);
    });
  });
});
