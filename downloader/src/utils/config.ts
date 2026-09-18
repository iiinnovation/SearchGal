import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface LLMConfig {
  /** Undefined permits use when password checking is requested; false explicitly disables it. */
  enabled?: boolean;
  provider: 'openai-compatible';
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export interface PasswordCheckConfig {
  enabled: boolean;
  failureMode: 'continue' | 'skip';
}

export interface AppConfig {
  llm: LLMConfig;
  passwordCheck: PasswordCheckConfig;
}

export const DEFAULT_CONFIG: AppConfig = {
  llm: {
    provider: 'openai-compatible',
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    timeoutMs: 15_000,
  },
  passwordCheck: {
    enabled: false,
    failureMode: 'continue',
  },
};

/**
 * 按照优先级合并配置：环境变量 > ~/.searchgal/config.json > 本地 .config.json > 默认配置
 */
export function loadConfig(customConfigPath?: string): AppConfig {
  const config: AppConfig = structuredClone(DEFAULT_CONFIG);

  // 1. 尝试从文件加载
  const candidatePaths = [
    customConfigPath,
    join(homedir(), '.searchgal', 'config.json'),
    join(process.cwd(), 'downloader', '.config.json'),
    join(process.cwd(), '.config.json'),
  ].filter((p): p is string => Boolean(p && existsSync(p)));

  for (const filePath of [...new Set(candidatePaths)].reverse()) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed.llm) Object.assign(config.llm, parsed.llm);
      if (parsed.passwordCheck) Object.assign(config.passwordCheck, parsed.passwordCheck);
    } catch {
      // 忽略无法解析的配置文件，回退至默认或环境变量
    }
  }

  // 2. 环境变量覆盖（优先级最高）
  if (process.env.SEARCHGAL_LLM_ENABLED !== undefined) {
    config.llm.enabled = ['1', 'true', 'yes'].includes(process.env.SEARCHGAL_LLM_ENABLED.toLowerCase());
  }
  if (process.env.SEARCHGAL_LLM_BASE_URL) {
    config.llm.baseURL = process.env.SEARCHGAL_LLM_BASE_URL.replace(/\/+$/, '');
  }
  if (process.env.SEARCHGAL_LLM_API_KEY) {
    config.llm.apiKey = process.env.SEARCHGAL_LLM_API_KEY;
  }
  if (process.env.SEARCHGAL_LLM_MODEL) {
    config.llm.model = process.env.SEARCHGAL_LLM_MODEL;
  }
  if (process.env.SEARCHGAL_LLM_TIMEOUT) {
    const timeout = Number(process.env.SEARCHGAL_LLM_TIMEOUT);
    if (Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 2_147_483_647) config.llm.timeoutMs = timeout;
  }

  if (process.env.SEARCHGAL_PASSWORD_CHECK_ENABLED !== undefined) {
    config.passwordCheck.enabled = ['1', 'true', 'yes'].includes(process.env.SEARCHGAL_PASSWORD_CHECK_ENABLED.toLowerCase());
  }
  if (process.env.SEARCHGAL_PASSWORD_CHECK_MODE) {
    const mode = process.env.SEARCHGAL_PASSWORD_CHECK_MODE.toLowerCase();
    if (mode === 'continue' || mode === 'skip') {
      config.passwordCheck.failureMode = mode;
    }
  }

  config.llm.baseURL = config.llm.baseURL.replace(/\/+$/, '');
  return config;
}
