import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, stat } from 'fs/promises';
import { dirname, resolve } from 'path';
import type {
  ArchivePasswordAssessment, Candidate, Capabilities, DownloadOptions, DownloadPlan, DownloadProgress,
  PasswordAssessor, ResolvedDownload,
} from '../types/index.js';
import { DirectDownloader } from '../tools/DirectDownloader.js';
import { MagnetTool } from '../tools/MagnetTool.js';
import { isHtmlLike, probeUrl, strongEtag } from '../utils/http.js';
import { ResolverRegistry } from './ResolverRegistry.js';
import { ResourceScorer, MIN_AUTO_RELEVANCE } from './ResourceScorer.js';
import { ToolRegistry } from './ToolRegistry.js';

/** 仅信任由成功下载生成、且经当前来源和本地 SHA-256 复核的完成记录。 */
export interface FileCheckpoint {
  source: string;
  filepath: string;
  url: string;
  etag: string;
  size: number;
  sha256: string;
}

export type DownloadEvent =
  | { type: 'candidate'; candidate: Candidate; index: number; total: number }
  | { type: 'resolving'; candidate: Candidate; resolver: string }
  | { type: 'password-assessment'; candidate: Candidate; assessment: ArchivePasswordAssessment }
  | { type: 'plan'; candidate: Candidate; files: ResolvedDownload[]; password?: string; note?: string }
  | { type: 'file-start'; file: ResolvedDownload; index: number; total: number }
  | { type: 'file-progress'; file: ResolvedDownload; index: number; progress: DownloadProgress }
  | { type: 'file-complete'; file: ResolvedDownload; index: number; filepath?: string; reused: boolean; checkpoint?: FileCheckpoint }
  | { type: 'candidate-error'; candidate: Candidate; error: string }
  | { type: 'complete'; candidate: Candidate; paths: string[] };

export interface EngineOptions extends DownloadOptions {
  onEvent?: (event: DownloadEvent) => void;
  checkpoints?: FileCheckpoint[];
  assessor?: PasswordAssessor;
  enablePasswordCheck?: boolean;
  passwordCheckFailureMode?: 'continue' | 'skip';
}

export interface EngineResult {
  success: boolean;
  paths: string[];
  manualHints: string[];
  password?: string;
  error?: string;
}

/** 无终端交互的下载编排，同时供 CLI 和桌面后台使用。 */
export class DownloadEngine {
  readonly resolvers = new ResolverRegistry();
  readonly tools = new ToolRegistry();
  readonly scorer: ResourceScorer;

  constructor(readonly capabilities: Capabilities) {
    this.tools.register(new MagnetTool(capabilities));
    this.tools.register(new DirectDownloader(capabilities));
    this.scorer = new ResourceScorer({ hasDedicatedResolver: url => this.resolvers.hasDedicated(url), capabilities });
  }

  buildQueue(candidates: Candidate[], query: string, limit = 6): Candidate[] {
    const relevant = candidates.filter(item => this.scorer.relevance(item.name, query) >= MIN_AUTO_RELEVANCE);
    const perPlatform = new Map<string, number>();
    const queue: Candidate[] = [];
    for (const candidate of relevant.length ? relevant : candidates) {
      const count = perPlatform.get(candidate.platform) ?? 0;
      if (count >= 2) continue;
      perPlatform.set(candidate.platform, count + 1);
      queue.push(candidate);
      if (queue.length >= limit) break;
    }
    return queue;
  }

  async run(queue: Candidate[], options: EngineOptions): Promise<EngineResult> {
    options.signal?.throwIfAborted();
    if (!options.outputDir.trim()) throw new Error('下载目录不能为空');
    await mkdir(options.outputDir, { recursive: true });
    const manualHints: string[] = [];
    let lastError = '没有可尝试的下载来源';
    for (let index = 0; index < queue.length; index++) {
      options.signal?.throwIfAborted();
      const candidate = queue[index];
      options.onEvent?.({ type: 'candidate', candidate, index, total: queue.length });
      const result = await this.downloadCandidate(candidate, options);
      manualHints.push(...result.manualHints);
      if (result.success) {
        options.onEvent?.({ type: 'complete', candidate, paths: result.paths });
        return { ...result, manualHints };
      }
      lastError = result.error ?? lastError;
    }
    return { success: false, paths: [], manualHints, error: lastError };
  }

  async downloadCandidate(candidate: Candidate, options: EngineOptions): Promise<EngineResult> {
    const manualHints: string[] = [];
    const fail = (error: string): EngineResult => {
      options.onEvent?.({ type: 'candidate-error', candidate, error });
      return { success: false, paths: [], manualHints, error };
    };
    options.signal?.throwIfAborted();
    const resolver = this.resolvers.find(candidate.url);
    if (!resolver) return fail('暂不支持这个链接类型');
    options.onEvent?.({ type: 'resolving', candidate, resolver: resolver.name });
    let plans: DownloadPlan[];
    try {
      plans = await resolver.resolve(candidate, {
        signal: options.signal,
        assessor: options.assessor,
        enablePasswordCheck: options.enablePasswordCheck,
        passwordCheckFailureMode: options.passwordCheckFailureMode,
        onPasswordAssessment: assessment => {
          options.onEvent?.({ type: 'password-assessment', candidate, assessment });
        },
      });
    } catch (error) {
      options.signal?.throwIfAborted();
      return fail(message(error));
    }
    if (!plans.length) return fail('页面中没有可直接下载的文件，可能需要登录或手动转存');
    let lastError = '下载方案不可用';
    for (const plan of plans) {
      if (!plan.files.length) continue;
      options.signal?.throwIfAborted();
      options.onEvent?.({ type: 'plan', candidate, files: plan.files, password: plan.password, note: plan.note });
      const paths: string[] = [];
      let complete = true;
      for (let index = 0; index < plan.files.length; index++) {
        options.signal?.throwIfAborted();
        const file = plan.files[index];
        options.onEvent?.({ type: 'file-start', file, index, total: plan.files.length });
        try {
          const checkpoint = await this.reusable(file, options);
          if (checkpoint) {
            paths.push(checkpoint.filepath);
            options.onEvent?.({ type: 'file-complete', file, index, filepath: checkpoint.filepath, reused: true, checkpoint });
            continue;
          }
          const tool = this.tools.findTool(file);
          if (!tool) throw new Error('没有能处理此链接的下载工具');
          const result = await tool.download(file, {
            ...options,
            recordVerification: options.checkpoints !== undefined,
            onProgress: progress => {
              options.onProgress?.(progress);
              options.onEvent?.({ type: 'file-progress', file, index, progress });
            },
          });
          options.signal?.throwIfAborted();
          if (!result.success) {
            if (result.manual && result.error) manualHints.push(result.error);
            throw new Error(result.error ?? '下载未完成');
          }
          let saved: FileCheckpoint | undefined;
          if (options.checkpoints !== undefined && result.filepath && result.verification) {
            saved = {
              source: sourceIdentity(file), filepath: result.filepath, ...result.verification,
              sha256: await hashFile(result.filepath, options.signal),
            };
          }
          if (result.filepath) paths.push(result.filepath);
          options.onEvent?.({ type: 'file-complete', file, index, filepath: result.filepath, reused: false, checkpoint: saved });
        } catch (error) {
          options.signal?.throwIfAborted();
          lastError = message(error);
          complete = false;
          break;
        }
      }
      if (complete) return { success: true, paths, manualHints, password: plan.password };
    }
    return fail(lastError);
  }

  private async reusable(file: ResolvedDownload, options: EngineOptions): Promise<FileCheckpoint | undefined> {
    if (file.kind !== 'http') return undefined;
    const identity = sourceIdentity(file);
    const checkpoint = options.checkpoints?.find(entry => entry.source === identity);
    if (!checkpoint || !strongEtag(checkpoint.etag) || dirname(resolve(checkpoint.filepath)) !== resolve(options.outputDir)) return undefined;
    try {
      const info = await stat(checkpoint.filepath);
      if (!info.isFile() || info.size !== checkpoint.size) return undefined;
      const probe = await probeUrl(file.url, file.headers, { signal: options.signal });
      if (!probe.ok || isHtmlLike(probe.contentType) || probe.finalUrl !== checkpoint.url ||
          probe.etag !== checkpoint.etag || probe.size !== checkpoint.size) return undefined;
      return await hashFile(checkpoint.filepath, options.signal) === checkpoint.sha256 ? checkpoint : undefined;
    } catch {
      options.signal?.throwIfAborted();
      return undefined;
    }
  }
}

function sourceIdentity(file: ResolvedDownload): string {
  return createHash('sha256').update(JSON.stringify([
    file.kind, file.url, file.filename, file.size, [...new Headers(file.headers).entries()],
  ])).digest('hex');
}

async function hashFile(path: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  signal?.throwIfAborted();
  return hash.digest('hex');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
