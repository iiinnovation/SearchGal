import type { ArchivePasswordAssessment, PasswordAssessor } from '../types/index.js';
import type { LLMConfig } from '../utils/config.js';
import { fetchWithTimeout } from '../utils/http.js';

/**
 * 智能提取页面与解压密码最相关的文本，优先捕获包含“密码/解压”关键词的段落，
 * 去除无用标签并压缩空白，防止 token 爆炸或尾部密码被截断。
 */
export function extractRelevantContent(html: string, maxChars = 12_000): string {
  // 1. 过滤干扰标签
  const cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

  const sections: string[] = [];
  const rawTextOnly = cleaned.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // 2. 优先级 1：关键词前后上下文（密码 / 解压码 / 提取码 / password / 访问码 等）
  const passwordMatches = rawTextOnly.match(/.{0,200}(?:密码|解压码|解压|提取码|访问码|password|passwd).{0,200}/gi);
  if (passwordMatches && passwordMatches.length > 0) {
    const uniqueMatches = [...new Set(passwordMatches.map(s => s.replace(/<[^>]+>/g, ' ').trim()))];
    sections.push('【重点密码相关片段】:\n' + uniqueMatches.slice(0, 10).join('\n---\n'));
  }

  // 3. 优先级 2：正文主体容器 (main / article / content)
  const mainContent = cleaned.match(/<(?:main|article|div[^>]*class="[^"]*(?:content|post|entry|article)[^"]*")[^>]*>(.*?)<\/(?:main|article|div)>/is);
  if (mainContent && mainContent[1]) {
    const textOnly = mainContent[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    sections.push('【正文片段】:\n' + textOnly);
  }

  // 4. 优先级 3：页面全文本兜底
  sections.push('【页面概览】:\n' + rawTextOnly);

  return sections.join('\n\n').slice(0, maxChars);
}

export class LLMService implements PasswordAssessor {
  constructor(private readonly config: LLMConfig) {}

  async assessPassword(html: string, gameName: string, signal?: AbortSignal): Promise<ArchivePasswordAssessment> {
    signal?.throwIfAborted();
    if (this.config.enabled === false) throw new Error('LLM 已禁用');
    if (!this.config.apiKey) {
      throw new Error('未配置 LLM API Key，无法执行密码检测');
    }

    const snippet = extractRelevantContent(html);
    const prompt = this.buildPrompt(snippet, gameName);
    const responseText = await this.callOpenAI(prompt, signal);
    return this.parseResponse(responseText);
  }

  private buildPrompt(snippet: string, gameName: string): string {
    return `
你是一个专门分析 Galgame 资源页面的助手。请分析以下网页内容，判断其中的游戏压缩包是否能直接解压（无需额外去第三方获取密码）。

【游戏名称】
${gameName}

【页面内容】
${snippet}

【判断规则】
1. 无密码：页面未提及密码，或明确标注"免密/无密码/解压即玩"，判定为通过 (canExtractWithoutExtraPassword: true)。
2. 公开密码：页面正文明确直接公开了解压密码（如"解压密码: 终点"、"密码: loli"），判定为通过 (canExtractWithoutExtraPassword: true)，并提取该密码。
3. 障碍密码：需要额外操作才能获取密码（如关注公众号、加QQ群看公告、回复后可见、付费/赞助、跳转外部网盘备注），判定为不通过 (canExtractWithoutExtraPassword: false)。

【输出格式】
你必须且只能返回一个有效的 JSON 对象，不要添加任何解释、注释、代码块标记或其他文字。格式如下：
{"canExtractWithoutExtraPassword":true,"hasPassword":false,"extractedPassword":null,"riskType":"none","reason":"页面未提及密码"}
`.trim();
  }

  private async callOpenAI(prompt: string, parentSignal?: AbortSignal): Promise<string> {
    const url = `${this.config.baseURL.replace(/\/+$/, '')}/chat/completions`;
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: 'You are a helpful assistant that strictly outputs JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
      }),
      signal: parentSignal,
      timeoutMs: this.config.timeoutMs,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`LLM 接口响应异常 HTTP ${response.status}: ${errorText.slice(0, 150)}`);
    }

    const json = await response.json() as any;
    const content = json?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      throw new Error('LLM 响应未包含有效 content 文本');
    }
    return content;
  }

  parseResponse(rawText: string): ArchivePasswordAssessment {
    let cleaned = rawText.trim();
    // 剥离可能存在的 markdown 代码块包裹
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
    }

    try {
      const data = JSON.parse(cleaned);
      if (!data || typeof data !== 'object' || Array.isArray(data) ||
          typeof data.canExtractWithoutExtraPassword !== 'boolean' || typeof data.hasPassword !== 'boolean') {
        throw new Error('密码评估结果必须包含布尔类型的 canExtractWithoutExtraPassword 和 hasPassword');
      }
      const canExtractWithoutExtraPassword = data.canExtractWithoutExtraPassword;
      const hasPassword = data.hasPassword;
      const extractedPassword = (typeof data.extractedPassword === 'string' && data.extractedPassword.trim())
        ? data.extractedPassword.trim()
        : undefined;
      if (canExtractWithoutExtraPassword && hasPassword && !extractedPassword) {
        throw new Error('加密资源缺少公开解压密码');
      }

      const validRisks = ['none', 'need_contact', 'need_payment', 'incomplete', 'unknown'];
      const riskType = validRisks.includes(data.riskType) ? data.riskType : (canExtractWithoutExtraPassword ? 'none' : 'unknown');
      const reason = typeof data.reason === 'string' && data.reason.trim() ? data.reason.trim() : (canExtractWithoutExtraPassword ? '可以解压' : '需要额外密码');

      return {
        canExtractWithoutExtraPassword,
        hasPassword,
        extractedPassword,
        riskType,
        reason,
      };
    } catch (err) {
      throw new Error(`无法解析 LLM 返回的 JSON: ${err instanceof Error ? err.message : String(err)}，原文本: ${cleaned.slice(0, 100)}`);
    }
  }
}
