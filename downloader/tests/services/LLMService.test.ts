import { extractRelevantContent, LLMService } from '../../src/services/LLMService.js';
import { TEST_SAMPLES } from '../fixtures/password-samples.js';
import { DEFAULT_CONFIG } from '../../src/utils/config.js';

describe('LLMService', () => {
  describe('extractRelevantContent', () => {
    it('过滤 script、style 标签并优先保留密码关键词段落', () => {
      const html = `
        <html>
          <head>
            <style>body { color: red; }</style>
            <script>alert("test");</script>
          </head>
          <body>
            <p>无关内容123456</p>
            <div class="footer">
              <p>解压密码：终点论坛发布</p>
            </div>
          </body>
        </html>
      `;
      const result = extractRelevantContent(html);
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('color: red');
      expect(result).toContain('解压密码：终点论坛发布');
      expect(result).toContain('【重点密码相关片段】');
    });

    it('限制最大输出长度', () => {
      const longHtml = '<p>密码：123</p>' + 'a'.repeat(20_000);
      const result = extractRelevantContent(longHtml, 500);
      expect(result.length).toBeLessThanOrEqual(500);
      expect(result).toContain('密码：123');
    });

    it('retains a multiline password at the end of a long page', () => {
      const html = '<div>' + 'a'.repeat(20_000) + '</div>\n<p>解压密码：</p>\n<p>footer-secret</p>';
      expect(extractRelevantContent(html)).toContain('footer-secret');
    });
  });

  describe('parseResponse', () => {
    const service = new LLMService({
      enabled: true,
      provider: 'openai-compatible',
      baseURL: 'http://localhost',
      apiKey: 'test-key',
      model: 'test-model',
      timeoutMs: 5000,
    });

    it('正确解析标准的纯 JSON 输出', () => {
      const raw = '{"canExtractWithoutExtraPassword": true, "hasPassword": true, "extractedPassword": "abc", "riskType": "none", "reason": "已提供公开密码"}';
      const parsed = service.parseResponse(raw);
      expect(parsed).toEqual({
        canExtractWithoutExtraPassword: true,
        hasPassword: true,
        extractedPassword: 'abc',
        riskType: 'none',
        reason: '已提供公开密码',
      });
    });

    it('能够剥离 markdown 代码块包裹', () => {
      const raw = '```json\n{"canExtractWithoutExtraPassword": false, "hasPassword": true, "riskType": "need_contact", "reason": "需要加群"}\n```';
      const parsed = service.parseResponse(raw);
      expect(parsed.canExtractWithoutExtraPassword).toBe(false);
      expect(parsed.riskType).toBe('need_contact');
      expect(parsed.reason).toBe('需要加群');
    });

    it('对缺失的可选字段进行降级兜底', () => {
      const raw = '{"canExtractWithoutExtraPassword": true,"hasPassword":false}';
      const parsed = service.parseResponse(raw);
      expect(parsed.canExtractWithoutExtraPassword).toBe(true);
      expect(parsed.hasPassword).toBe(false);
      expect(parsed.riskType).toBe('none');
      expect(parsed.extractedPassword).toBeUndefined();
    });

    it.each([
      null, [], {}, { canExtractWithoutExtraPassword: true },
      { canExtractWithoutExtraPassword: 'false', hasPassword: true },
      { canExtractWithoutExtraPassword: true, hasPassword: 'false' },
      { canExtractWithoutExtraPassword: 1, hasPassword: false },
      { canExtractWithoutExtraPassword: true, hasPassword: true },
    ])('rejects invalid or incomplete assessments: %j', value => {
      expect(() => service.parseResponse(JSON.stringify(value))).toThrow();
    });

    it('无法解析的脏数据应抛出异常', () => {
      expect(() => service.parseResponse('这不是有效的JSON')).toThrow(/无法解析 LLM 返回的 JSON/);
    });
  });

  describe('assessPassword 与 API 调用', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('未配置 apiKey 时调用应抛出明确错误', async () => {
      const unconfigured = new LLMService({
        enabled: true,
        provider: 'openai-compatible',
        baseURL: 'http://localhost',
        apiKey: '',
        model: 'test-model',
        timeoutMs: 5000,
      });

      await expect(unconfigured.assessPassword('<html></html>', '游戏')).rejects.toThrow('未配置 LLM API Key');
    });

    it('调用成功并返回结构化结果', async () => {
      const service = new LLMService({
        enabled: true,
        provider: 'openai-compatible',
        baseURL: 'https://api.test.com/v1',
        apiKey: 'sk-test',
        model: 'test-model',
        timeoutMs: 5000,
      });

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  canExtractWithoutExtraPassword: true,
                  hasPassword: true,
                  extractedPassword: 'moyu',
                  riskType: 'none',
                  reason: '正文已给出密码',
                }),
              },
            },
          ],
        }),
      });

      const sample = TEST_SAMPLES[1]; // 公开密码样本
      const result = await service.assessPassword(sample.html, sample.gameName);

      expect(result.canExtractWithoutExtraPassword).toBe(true);
      expect(result.extractedPassword).toBe('moyu');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.test.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
        }),
      );
      const request = (globalThis.fetch as jest.Mock).mock.calls[0][1];
      expect(new Headers(request.headers).get('Authorization')).toBe('Bearer sk-test');
    });

    it('API 返回非 200 时应正确抛错', async () => {
      const service = new LLMService({
        enabled: true,
        provider: 'openai-compatible',
        baseURL: 'https://api.test.com/v1',
        apiKey: 'sk-test',
        model: 'test-model',
        timeoutMs: 5000,
      });

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized Invalid Key',
      });

      await expect(service.assessPassword('<html></html>', '测试')).rejects.toThrow('LLM 接口响应异常 HTTP 401');
    });

    it('does not send requests after cancellation or explicit disable', async () => {
      globalThis.fetch = jest.fn();
      const service = new LLMService({ ...DEFAULT_CONFIG.llm, apiKey: 'test-key' });
      await expect(service.assessPassword('', '', AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled');
      const disabled = new LLMService({ ...DEFAULT_CONFIG.llm, enabled: false, apiKey: 'test-key' });
      await expect(disabled.assessPassword('', '')).rejects.toThrow('LLM 已禁用');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it.each(['parent', 'timeout'])('aborts during response body reading: %s', async mode => {
      const controller = new AbortController();
      const service = new LLMService({ ...DEFAULT_CONFIG.llm, apiKey: 'test-key', timeoutMs: 20 });
      globalThis.fetch = jest.fn(async (_url, options) => ({
        ok: true,
        json: () => new Promise((_resolve, reject) => {
          const signal = options!.signal!;
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          if (mode === 'parent') controller.abort(new Error('cancelled during body'));
        }),
      })) as unknown as typeof fetch;
      // Keep the event loop alive while AbortSignal.timeout uses an unref'ed timer.
      const keepAlive = setInterval(() => undefined, 100);
      try { await expect(service.assessPassword('', '', controller.signal)).rejects.toThrow(); }
      finally { clearInterval(keepAlive); }
    });
  });
});
