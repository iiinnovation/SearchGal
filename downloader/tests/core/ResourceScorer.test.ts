import { ResourceScorer, MIN_AUTO_RELEVANCE } from '../../src/core/ResourceScorer.js';
import type { SearchResult, Capabilities } from '../../src/types/index.js';

describe('ResourceScorer', () => {
  let scorer: ResourceScorer;
  const capabilities: Capabilities = { aria2c: true };

  beforeEach(() => {
    scorer = new ResourceScorer({
      hasDedicatedResolver: (url) => url.includes('shinnku.com'),
      capabilities,
    });
  });

  describe('relevance', () => {
    it('应该计算名称相关性', () => {
      const query = '千恋万花';

      expect(scorer.relevance('千恋万花', query)).toBeGreaterThanOrEqual(MIN_AUTO_RELEVANCE);
      expect(scorer.relevance('千恋万花(官中)', query)).toBeGreaterThanOrEqual(MIN_AUTO_RELEVANCE);
      expect(scorer.relevance('完全不相关的游戏', query)).toBeLessThan(MIN_AUTO_RELEVANCE);
    });

    it('应该处理空字符串', () => {
      expect(scorer.relevance('', '')).toBe(0);
      expect(scorer.relevance('test', '')).toBe(0);
    });
  });

  describe('rank', () => {
    it('应该按评分排序候选资源', () => {
      const results: SearchResult[] = [
        {
          name: '百度网盘',
          color: '#2932e1',
          tags: [],
          items: [
            {
              name: '千恋万花',
              url: 'https://pan.baidu.com/s/xxx',
              tags: ['需要登录', '网盘'],
            },
          ],
        },
        {
          name: '真红小站',
          color: '#ff0000',
          tags: [],
          items: [
            {
              name: '千恋万花(官中).7z',
              url: 'https://www.shinnku.com/files/test.7z',
              tags: ['直链', '无需登录'],
            },
          ],
        },
      ];

      const candidates = scorer.rank(results, '千恋万花');

      expect(candidates.length).toBe(2);
      // 真红小站应该排在前面（直链+无需登录）
      expect(candidates[0].platform).toBe('真红小站');
      expect(candidates[0].score).toBeGreaterThan(candidates[1].score);
    });

    it('应该处理空结果', () => {
      const candidates = scorer.rank([], '测试');
      expect(candidates).toEqual([]);
    });

    it('应该添加评分原因', () => {
      const results: SearchResult[] = [
        {
          name: '真红小站',
          color: '#ff0000',
          tags: [],
          items: [
            {
              name: '测试游戏.7z',
              url: 'https://www.shinnku.com/files/test.7z',
              tags: ['直链', '无需登录'],
            },
          ],
        },
      ];

      const candidates = scorer.rank(results, '测试');

      expect(candidates[0].reasons.length).toBeGreaterThan(0);
      expect(candidates[0].reasons.some(r => r.includes('解析'))).toBe(true);
    });
  });
});
