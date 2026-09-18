#!/usr/bin/env node

import { Command, InvalidArgumentError } from 'commander';
import { homedir } from 'os';
import { join } from 'path';
import { Harness } from './core/Harness.js';
import { DEFAULT_API_URL } from './core/SearchClient.js';
import { configureProxyFromEnv } from './utils/proxy.js';

const program = new Command();

// 从环境变量配置代理（如果有的话）
configureProxyFromEnv();

const defaultApi = process.env.SEARCHGAL_API || DEFAULT_API_URL;

function parsePositiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('必须是正整数');
  }
  return parsed;
}

function fail(error: unknown): never {
  console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

program
  .name('searchgal-dl')
  .description('SearchGal 自动下载工具：输入游戏名 → 搜索全部平台 → 解析真实下载地址 → 下载到指定目录')
  .version('2.0.0')
  .option('-a, --api <url>', 'SearchGal 后端地址（环境变量 SEARCHGAL_API）', defaultApi);

program
  .command('download <game>')
  .alias('dl')
  .description('搜索并自动下载')
  .option('-d, --dir <path>', '下载目录', join(homedir(), 'Downloads', 'SearchGal'))
  .option('-i, --interactive', '手动从候选列表中选择，而不是自动尝试', false)
  .option('-n, --max-attempts <n>', '自动模式最多尝试的资源数', parsePositiveInt, 6)
  .option('--check-password', '开启 LLM 解压密码智能检测与提取')
  .option('--strict-password', '若检测到障碍密码（需加群/付费等）则跳过该候选')
  .action(async (game: string, options: {
    dir: string;
    interactive: boolean;
    maxAttempts: number;
    checkPassword?: boolean;
    strictPassword?: boolean;
  }) => {
    try {
      const harness = await Harness.create(program.opts<{ api: string }>().api);
      const ok = await harness.searchAndDownload(game, {
        outputDir: options.dir,
        interactive: options.interactive,
        maxAttempts: options.maxAttempts,
        checkPassword: options.checkPassword,
        strictPassword: options.strictPassword,
      });
      process.exit(ok ? 0 : 2);
    } catch (error) {
      fail(error);
    }
  });

program
  .command('search <game>')
  .description('只搜索并列出候选资源，不下载')
  .action(async (game: string) => {
    try {
      const harness = await Harness.create(program.opts<{ api: string }>().api);
      const { candidates } = await harness.search(game);
      if (candidates.length === 0) {
        console.log('❌ 没有找到任何资源');
        process.exit(2);
      }
      harness.printCandidates(candidates);
    } catch (error) {
      fail(error);
    }
  });

program
  .command('tools')
  .description('列出下载工具与解析器，并检测 aria2c 是否可用')
  .action(async () => {
    const harness = await Harness.create(program.opts<{ api: string }>().api);
    harness.listTools();
  });

program.parseAsync().catch(fail);
