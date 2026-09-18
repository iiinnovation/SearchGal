import { mkdir } from 'fs/promises';
import { createInterface } from 'readline/promises';
import { stdin, stdout } from 'process';
import { SearchClient } from './SearchClient.js';
import { MIN_AUTO_RELEVANCE, ResourceScorer } from './ResourceScorer.js';
import { DownloadEngine } from './DownloadEngine.js';
import { commandExists } from '../utils/process.js';
import { formatBytes } from '../utils/format.js';
import { loadConfig, type AppConfig } from '../utils/config.js';
import { LLMService } from '../services/LLMService.js';
import { extractionCommand } from '../utils/shell.js';
import type { Candidate, Capabilities, SearchOutcome } from '../types/index.js';

export interface RunOptions {
  outputDir: string;
  /** 手动从候选列表里选，而不是按评分自动尝试 */
  interactive: boolean;
  /** 自动模式最多尝试多少个候选资源 */
  maxAttempts: number;
  /** 是否开启 LLM 解压密码检测 */
  checkPassword?: boolean;
  /** 是否开启严格拦截模式（发现需额外密码则跳过） */
  strictPassword?: boolean;
}

const LIST_LIMIT = 15;

/**
 * 主流程：搜索 → 评分排序 → 逐个候选「解析真实下载地址 → 下载」，直到成功。
 */
export class Harness {
  private readonly searchClient: SearchClient;
  private readonly engine: DownloadEngine;
  private readonly resolvers: DownloadEngine['resolvers'];
  private readonly tools: DownloadEngine['tools'];
  private readonly scorer: ResourceScorer;
  private readonly config: AppConfig;
  private readonly llmService?: LLMService;
  readonly capabilities: Capabilities;

  private constructor(apiUrl: string | undefined, capabilities: Capabilities, config?: AppConfig) {
    this.searchClient = new SearchClient(apiUrl);
    this.capabilities = capabilities;
    this.config = config ?? loadConfig();
    if (this.config.llm.enabled !== false && this.config.llm.apiKey) {
      this.llmService = new LLMService(this.config.llm);
    }
    this.engine = new DownloadEngine(capabilities);
    this.resolvers = this.engine.resolvers;
    this.tools = this.engine.tools;
    this.scorer = this.engine.scorer;
  }

  static async create(apiUrl?: string, config?: AppConfig): Promise<Harness> {
    const capabilities: Capabilities = { aria2c: await commandExists('aria2c') };
    return new Harness(apiUrl, capabilities, config);
  }

  async search(gameName: string): Promise<{ outcome: SearchOutcome; candidates: Candidate[] }> {
    const query = gameName.trim();
    if (!query) throw new Error('游戏名不能为空');

    console.log(`🔍 搜索: ${query}`);
    let lastShown = 0;
    const outcome = await this.searchClient.searchGal(query, (completed, total) => {
      if (completed - lastShown >= 5 || completed === total) {
        lastShown = completed;
        process.stdout.write(`\r   平台进度 ${completed}/${total}`.padEnd(40));
      }
    });
    process.stdout.write('\r'.padEnd(40) + '\r');

    const itemCount = outcome.results.reduce((sum, r) => sum + r.items.length, 0);
    console.log(`✅ ${outcome.results.length} 个平台共 ${itemCount} 条结果` + (outcome.errors.length ? `（${outcome.errors.length} 个平台搜索出错）` : ''));

    return { outcome, candidates: this.scorer.rank(outcome.results, query) };
  }

  async searchAndDownload(gameName: string, options: RunOptions): Promise<boolean> {
    if (!options.outputDir?.trim()) throw new Error('下载目录不能为空');
    try {
      await mkdir(options.outputDir, { recursive: true });
    } catch (error) {
      throw new Error(`无法创建目录 ${options.outputDir}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!this.capabilities.aria2c) {
      console.log('ℹ️  未检测到 aria2c，将使用内置下载器（BT 资源无法自动下载）。安装 aria2c 可提速: brew install aria2 / scoop install aria2');
    }

    const { candidates } = await this.search(gameName);
    if (candidates.length === 0) {
      console.log('❌ 没有找到任何资源，换个关键词试试（例如只输入主标题、或日文原名）');
      return false;
    }

    this.printCandidates(candidates);

    const queue = options.interactive ? await this.pickInteractively(candidates) : this.buildAutoQueue(candidates, gameName, options.maxAttempts);
    if (queue.length === 0) return false;

    console.log(`\n📂 下载目录: ${options.outputDir}`);
    const shouldCheckPassword = options.checkPassword ?? this.config.passwordCheck.enabled;
    const isStrict = options.strictPassword ?? (this.config.passwordCheck.failureMode === 'skip');
    if (shouldCheckPassword) {
      console.log(`🤖 已启用 LLM 解压密码智能检测 (模式: ${isStrict ? '严格拦截' : '预警放行'}${this.llmService ? '' : ' - LLM 未配置或已禁用'})`);
    }

    const manualHints: string[] = [];
    for (let i = 0; i < queue.length; i++) {
      const candidate = queue[i];
      console.log(`\n${'─'.repeat(64)}`);
      console.log(`🎯 [${i + 1}/${queue.length}] ${candidate.platform} · ${candidate.name}`);
      console.log(`   ${candidate.url}`);

      const success = await this.tryCandidate(candidate, options.outputDir, manualHints, options);
      if (success) {
        return true;
      }
    }

    console.log(`\n${'─'.repeat(64)}`);
    console.log('❌ 尝试的资源都没能自动下载。');
    if (manualHints.length > 0) {
      console.log('\n💡 可以手动处理的链接：');
      for (const hint of manualHints) console.log(`   ${hint}`);
    }
    console.log('\n💡 也可以用 `-i` 手动选择资源，或直接打开这些页面：');
    for (const candidate of candidates.slice(0, 5)) {
      console.log(`   [${candidate.platform}] ${candidate.url}`);
    }
    return false;
  }

  private async tryCandidate(
    candidate: Candidate,
    outputDir: string,
    manualHints: string[],
    options: RunOptions,
  ): Promise<boolean> {
    const enablePasswordCheck = options.checkPassword ?? this.config.passwordCheck.enabled;
    const failureMode = (options.strictPassword ?? (this.config.passwordCheck.failureMode === 'skip')) ? 'skip' : 'continue';

    const result = await this.engine.downloadCandidate(candidate, {
      outputDir,
      assessor: this.llmService,
      enablePasswordCheck,
      passwordCheckFailureMode: failureMode,
      onEvent: event => {
        if (event.type === 'resolving') console.log(`🔎 解析下载地址（${event.resolver}）...`);
        if (event.type === 'password-assessment') {
          const a = event.assessment;
          if (a.canExtractWithoutExtraPassword) {
            console.log(`🤖 [LLM密码检测] ✅ 允许解压${a.extractedPassword ? ` (密码: ${a.extractedPassword})` : ' (免密)'} - ${a.reason}`);
          } else {
            console.log(`🤖 [LLM密码检测] ⚠️ 发现障碍密码 (${a.riskType}): ${a.reason}`);
          }
        }
        if (event.type === 'plan') {
          const total = event.files.reduce((sum, file) => sum + (file.size ?? 0), 0);
          const description = event.files.length > 1 ? `${event.files.length} 个分卷` : event.files[0].kind === 'magnet' ? '磁力链接' : '1 个文件';
          console.log(`📦 找到 ${description}${total > 0 ? `，合计 ${formatBytes(total)}` : ''}`);
          if (event.note || event.files[0].note) console.log(`   ${event.note || event.files[0].note}`);
        }
        if (event.type === 'file-start') console.log(`⬇️  ${event.file.kind === 'magnet' ? event.file.url.slice(0, 80) + '…' : event.file.url}`);
        if (event.type === 'file-complete' && event.filepath) console.log(`✅ 已保存: ${event.filepath}`);
        if (event.type === 'candidate-error') console.log(`❌ 下载失败: ${event.error}`);
      },
    });
    manualHints.push(...result.manualHints);
    if (result.success) {
      console.log('\n🎉 下载完成');
      if (result.password) {
        console.log(`\n🔑 检测到解压密码: \x1b[32m${result.password}\x1b[0m`);
        console.log(`💡 解压提示：如果文件加密，可使用上述密码解压。${process.platform === 'win32' ? 'PowerShell' : '终端'}命令：`);
        if (result.paths.length > 0) {
          console.log(`   ${extractionCommand(result.paths[0], result.password)}`);
        }
      }
      return true;
    }
    return false;
  }

  /**
   * 自动模式的尝试队列：优先名字相关的候选，同一个平台最多试两条（一条不行通常整站都不行）。
   */
  private buildAutoQueue(candidates: Candidate[], query: string, maxAttempts: number): Candidate[] {
    const relevant = candidates.filter(c => this.scorer.relevance(c.name, query) >= MIN_AUTO_RELEVANCE);
    const pool = relevant.length > 0 ? relevant : candidates;
    if (relevant.length === 0) {
      console.log('⚠️  没有名字匹配的结果，将按评分尝试（结果可能不是你要找的游戏）');
    }

    return this.engine.buildQueue(pool, query, maxAttempts);
  }

  private async pickInteractively(candidates: Candidate[]): Promise<Candidate[]> {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const answer = (await rl.question(`\n请输入要下载的序号（1-${Math.min(candidates.length, LIST_LIMIT)}，回车默认 1，q 退出）: `)).trim();
      if (answer.toLowerCase() === 'q') return [];
      const index = answer === '' ? 1 : Number(answer);
      if (!Number.isInteger(index) || index < 1 || index > Math.min(candidates.length, LIST_LIMIT)) {
        console.log('❌ 无效的序号');
        return [];
      }
      return [candidates[index - 1]];
    } finally {
      rl.close();
    }
  }

  printCandidates(candidates: Candidate[]): void {
    console.log(`\n📊 候选资源（按自动下载成功可能性排序，共 ${candidates.length} 条，显示前 ${Math.min(candidates.length, LIST_LIMIT)}）:`);
    candidates.slice(0, LIST_LIMIT).forEach((candidate, index) => {
      console.log(`${String(index + 1).padStart(3)}. [${String(candidate.score).padStart(4)}分] ${candidate.platform} · ${candidate.name}`);
      console.log(`      ${candidate.reasons.join('，')}`);
      console.log(`      ${candidate.url}`);
    });
  }

  listTools(): void {
    console.log(`🔧 下载工具（aria2c: ${this.capabilities.aria2c ? '已安装' : '未安装'}）:`);
    for (const tool of this.tools.getAll()) {
      console.log(`  - ${tool.name}: ${tool.description}`);
    }
    console.log('\n🔎 下载地址解析器:');
    for (const resolver of this.resolvers.getAll()) {
      console.log(`  - ${resolver.name}`);
    }
  }
}
