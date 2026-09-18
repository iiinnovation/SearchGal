import { GGBasesResolver } from '../../src/resolvers/GGBasesResolver.js';
import type { Candidate } from '../../src/types/index.js';

describe('GGBasesResolver', () => {
  let resolver: GGBasesResolver;

  beforeEach(() => {
    resolver = new GGBasesResolver();
  });

  describe('canResolve', () => {
    it('应该识别带 id 参数的 GGBases URL', () => {
      expect(resolver.canResolve('https://www.ggbases.com/view.so?id=130850')).toBe(true);
      expect(resolver.canResolve('https://www.ggbases.com/magnet.so?id=12345')).toBe(true);
      expect(resolver.canResolve('https://ggbases.com/view.so?id=999')).toBe(true);
    });

    it('应该拒绝不带 id 参数的 URL', () => {
      expect(resolver.canResolve('https://www.ggbases.com/resource/130850')).toBe(false);
      expect(resolver.canResolve('https://www.ggbases.com/')).toBe(false);
    });

    it('应该拒绝其他域名', () => {
      expect(resolver.canResolve('https://example.com/view.so?id=123')).toBe(false);
    });

    it('应该处理无效 URL', () => {
      expect(resolver.canResolve('not-a-url')).toBe(false);
      expect(resolver.canResolve('')).toBe(false);
    });
  });

  describe('resolve (network)', () => {
    // 跳过网络测试，除非显式通过环境变量启用
    const networkTest = process.env.RUN_NETWORK_TESTS === '1' ? it : it.skip;

    networkTest('应该返回磁力链接结构', async () => {
      const candidate: Candidate = {
        url: 'https://www.ggbases.com/view.so?id=130850',
        name: 'Test Game',
        platform: 'GGBases',
        platformTags: [],
        score: 120,
        reasons: [],
      };

      const plans = await resolver.resolve(candidate);

      expect(plans.length).toBeGreaterThan(0);
      expect(plans[0].files.length).toBe(1);
      expect(plans[0].files[0].kind).toBe('magnet');
      expect(plans[0].files[0].url).toMatch(/^magnet:\?xt=urn:btih:/);
    }, 30000);
  });
});
