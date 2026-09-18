import { GenericResolver } from '../../src/resolvers/GenericResolver.js';
import { startServer } from '../helpers/httpServer.js';
import type { ArchivePasswordAssessment, PasswordAssessor } from '../../src/types/index.js';

describe('GenericResolver Password Assessment', () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  let pageContent: string;

  beforeEach(async () => {
    pageContent = `
      <html>
        <body>
          <p>游戏介绍</p>
          <a href="/files/game.zip">下载游戏</a>
        </body>
      </html>
    `;
    server = await startServer((request, response) => {
      if (request.url === '/page') {
        response.setHeader('Content-Type', 'text/html');
        response.end(pageContent);
      } else {
        response.setHeader('Content-Type', 'application/octet-stream');
        response.end('binary');
      }
    });
  });

  afterEach(async () => {
    await server.close();
  });

  const candidate = (url: string) => ({
    platform: 'local',
    platformTags: [],
    name: '测试游戏',
    score: 0,
    reasons: [],
    url,
  });

  it('提取到公开密码时，DownloadPlan 应绑定该密码和 note', async () => {
    const mockAssessor: PasswordAssessor = {
      assessPassword: jest.fn().mockResolvedValue({
        canExtractWithoutExtraPassword: true,
        hasPassword: true,
        extractedPassword: 'secret-password-123',
        riskType: 'none',
        reason: '正文已包含密码',
      } as ArchivePasswordAssessment),
    };

    const resolver = new GenericResolver();
    const plans = await resolver.resolve(candidate(server.url + '/page'), {
      enablePasswordCheck: true,
      assessor: mockAssessor,
      passwordCheckFailureMode: 'continue',
    });

    expect(plans).toHaveLength(1);
    expect(plans[0].password).toBe('secret-password-123');
    expect(plans[0].note).toBe('解压密码: secret-password-123');
  });

  it('严格拦截模式下检测到障碍密码时，应抛出错误阻止当前候选', async () => {
    const mockAssessor: PasswordAssessor = {
      assessPassword: jest.fn().mockResolvedValue({
        canExtractWithoutExtraPassword: false,
        hasPassword: true,
        riskType: 'need_contact',
        reason: '需要加QQ群获取密码',
      } as ArchivePasswordAssessment),
    };

    const resolver = new GenericResolver();
    await expect(
      resolver.resolve(candidate(server.url + '/page'), {
        enablePasswordCheck: true,
        assessor: mockAssessor,
        passwordCheckFailureMode: 'skip',
      }),
    ).rejects.toThrow('资源需要额外密码: 需要加QQ群获取密码');
  });

  it('放行预警模式下检测到障碍密码时，应降级放行并返回下载方案', async () => {
    const mockAssessor: PasswordAssessor = {
      assessPassword: jest.fn().mockResolvedValue({
        canExtractWithoutExtraPassword: false,
        hasPassword: true,
        riskType: 'need_payment',
        reason: '需付费开通会员',
      } as ArchivePasswordAssessment),
    };

    const resolver = new GenericResolver();
    const plans = await resolver.resolve(candidate(server.url + '/page'), {
      enablePasswordCheck: true,
      assessor: mockAssessor,
      passwordCheckFailureMode: 'continue',
    });

    expect(plans).toHaveLength(1);
    expect(plans[0].files[0].filename).toBe('game.zip');
    expect(plans[0].password).toBeUndefined();
  });

  it('LLM 服务报错但在放行预警模式下，应降级放行不阻塞下载', async () => {
    const mockAssessor: PasswordAssessor = {
      assessPassword: jest.fn().mockRejectedValue(new Error('LLM 接口请求超时')),
    };

    const resolver = new GenericResolver();
    const plans = await resolver.resolve(candidate(server.url + '/page'), {
      enablePasswordCheck: true,
      assessor: mockAssessor,
      passwordCheckFailureMode: 'continue',
    });

    expect(plans).toHaveLength(1);
    expect(plans[0].files[0].filename).toBe('game.zip');
    expect(plans[0].note).toContain('密码检查未完成');
  });

  it('strict mode rejects a missing assessor', async () => {
    await expect(new GenericResolver().resolve(candidate(server.url + '/page'), {
      enablePasswordCheck: true, passwordCheckFailureMode: 'skip',
    })).rejects.toThrow('LLM 未配置或已禁用');
  });

  it('continue mode propagates cancellation during assessment', async () => {
    const controller = new AbortController();
    await expect(new GenericResolver().resolve(candidate(server.url + '/page'), {
      signal: controller.signal, enablePasswordCheck: true, passwordCheckFailureMode: 'continue',
      assessor: { assessPassword: async () => { controller.abort(new Error('cancelled')); throw controller.signal.reason; } },
    })).rejects.toThrow('cancelled');
  });
});
