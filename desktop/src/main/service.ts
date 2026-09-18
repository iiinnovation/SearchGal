import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DownloadEngine } from '../../../downloader/src/core/DownloadEngine';
import { MIN_AUTO_RELEVANCE } from '../../../downloader/src/core/ResourceScorer';
import { sanitizeFilename } from '../../../downloader/src/utils/format';
import type { Candidate, SearchResult } from '../../../downloader/src/types';
import type {
  AppSnapshot, Character, SearchState, Settings, StoredState, StoredTask, WorkerRequest, WorkerResponse,
} from '../shared/contracts';
import { StateStore, ACTIVE_STATUSES, validatedSettings } from './state';

export interface JobProcess {
  postMessage(message: WorkerRequest): void;
  kill(): boolean;
}

export type WorkerFactory = (
  request: Exclude<WorkerRequest, { kind: 'abort' }>,
  onMessage: (message: WorkerResponse) => void,
  onExit: (code: number) => void,
) => JobProcess;

interface ActiveDownload {
  runId: string;
  taskId: string;
  process: JobProcess;
  stopping?: NodeJS.Timeout;
  done: Promise<void>;
  resolveDone(): void;
}

export class DesktopService extends EventEmitter {
  private state!: StoredState;
  private readonly engine = new DownloadEngine({ aria2c: false });
  private searchState: SearchState = { status: 'idle', query: '', completed: 0, total: 0, candidates: [], errors: [] };
  private searchJob?: { id: string; process: JobProcess; timeout: NodeJS.Timeout; downloadDirectory?: string };
  private results: SearchResult[] = [];
  private active?: ActiveDownload;
  private closing = false;
  private saveTimer?: NodeJS.Timeout;
  private notice?: string;

  constructor(
    private readonly store: StateStore,
    private readonly createWorker: WorkerFactory,
    private readonly appInfo: { version: string; platform: string; packaged: boolean },
  ) { super(); }

  async initialize(): Promise<void> {
    this.state = await this.store.load();
    this.notice = this.store.notice;
    await this.persist();
  }

  snapshot(): AppSnapshot {
    return structuredClone({
      ...this.appInfo,
      llmKeyConfigured: Boolean(this.state.llmApiKey),
      settings: this.state.settings,
      tasks: this.state.tasks.map(({ queue: _queue, checkpoints: _checkpoints, ...task }) => task),
      characters: this.state.characters,
      search: this.searchState,
      recentSearches: this.state.recentSearches,
      notice: this.notice,
    });
  }

  get settings(): Settings { return this.state.settings; }
  get characters(): Character[] { return this.state.characters; }

  async search(query: string, autoDownload = false): Promise<void> {
    if (this.closing) throw new Error('应用正在退出');
    if (typeof autoDownload !== 'boolean') throw new Error('搜索模式不正确');
    if (typeof query !== 'string' || !query.trim() || query.trim().length > 200) throw new Error('请输入 1–200 个字符的游戏名');
    this.stopSearch();
    query = query.trim();
    this.results = [];
    this.searchState = { status: 'searching', query, autoDownload, completed: 0, total: 0, candidates: [], errors: [] };
    this.state.recentSearches = [query, ...this.state.recentSearches.filter(item => item !== query)].slice(0, 8);
    const id = randomUUID();
    const process = this.createWorker(
      { kind: 'search', query, apiUrl: this.settings.apiUrl, proxyUrl: this.settings.proxyUrl },
      message => this.searchMessage(id, message),
      () => { if (this.searchJob?.id === id) this.failSearch('搜索服务已退出，请重试'); },
    );
    const timeout = setTimeout(() => {
      if (this.searchJob?.id === id) this.failSearch('搜索超时，已保留收到的结果，可以重试其他来源。');
    }, 90_000);
    this.searchJob = { id, process, timeout, downloadDirectory: autoDownload ? this.settings.downloadDirectory : undefined };
    this.publish();
    await this.persist();
  }

  stopSearch(): void {
    if (!this.searchJob) return;
    const job = this.searchJob;
    this.searchJob = undefined;
    clearTimeout(job.timeout);
    job.process.kill();
    this.searchState.autoDownload = false;
    if (this.searchState.status === 'searching') this.searchState.status = 'idle';
    this.publish();
  }

  private failSearch(error: string): void {
    const downloadDirectory = this.searchJob?.downloadDirectory;
    this.stopSearch();
    this.searchState.status = 'failed';
    this.searchState.error = error;
    if (downloadDirectory) this.startAutomaticDownload(downloadDirectory);
    this.publish();
  }

  private startAutomaticDownload(directory: string): void {
    const state = this.searchState;
    state.autoDownload = true;
    // Search failures may still leave usable results; use the same queue as manual auto-selection.
    const queue = this.automaticQueue();
    if (!queue.length) {
      state.error ??= '没有找到足够匹配的下载来源，请换一个完整游戏名，或查看搜索结果。';
      return;
    }
    void this.enqueue(queue, state.query, directory).then(taskId => {
      if (this.searchState !== state) return;
      state.taskId = taskId;
      this.publish();
    }).catch(error => {
      if (this.searchState !== state) return;
      state.error = `无法开始自动下载：${error instanceof Error ? error.message : String(error)}`;
      this.publish();
    });
  }

  private automaticQueue(): Candidate[] {
    const { candidates, query } = this.searchState;
    const matching = candidates.filter(candidate => this.engine.scorer.relevance(candidate.name, query) >= MIN_AUTO_RELEVANCE);
    return this.engine.buildQueue(matching, query);
  }

  private searchMessage(id: string, message: WorkerResponse): void {
    if (this.searchJob?.id !== id) return;
    if (message.kind === 'search-event') {
      const event = message.event;
      if (event.total !== undefined) this.searchState.total = event.total;
      if (event.progress) Object.assign(this.searchState, event.progress);
      if (event.result) {
        this.results = [...this.results.filter(result => result.name !== event.result!.name), event.result];
        this.rankResults();
      }
      this.publish();
    } else if (message.kind === 'search-complete') {
      const downloadDirectory = this.searchJob.downloadDirectory;
      this.results = [...message.outcome.results, ...message.outcome.errors];
      this.rankResults();
      this.stopSearch();
      this.searchState.status = 'complete';
      this.searchState.total = message.outcome.total ?? this.searchState.total;
      this.searchState.completed = this.searchState.total;
      if (downloadDirectory) this.startAutomaticDownload(downloadDirectory);
      this.publish();
    } else if (message.kind === 'error') this.failSearch(message.error);
  }

  private rankResults(): void {
    this.searchState.candidates = this.engine.scorer.rank(this.results.filter(result => !result.error), this.searchState.query)
      .slice(0, 1000).map(candidate => ({
        ...candidate,
        id: createHash('sha256').update(JSON.stringify([candidate.platform, candidate.url, candidate.name])).digest('hex').slice(0, 24),
      }));
    this.searchState.errors = this.results.filter(result => result.error).map(result => ({ platform: result.name, message: result.error! }));
  }

  async download(candidateId?: string): Promise<string> {
    if (this.closing) throw new Error('应用正在退出');
    const candidates = candidateId === undefined ? this.automaticQueue()
      : this.searchState.candidates.filter(candidate => candidate.id === candidateId);
    if (!candidates.length) throw new Error('请先搜索并选择一个下载来源');
    // Selecting a source while automatic search is running takes over that request.
    if (this.searchState.autoDownload) this.stopSearch();
    return this.enqueue(candidates, this.searchState.query, this.settings.downloadDirectory);
  }

  private async enqueue(candidates: Candidate[], title: string, directory: string): Promise<string> {
    if (this.closing) throw new Error('应用正在退出');
    const id = randomUUID();
    const now = new Date().toISOString();
    const task: StoredTask = {
      id, title, status: 'queued', createdAt: now, updatedAt: now,
      outputDirectory: join(directory, `${sanitizeFilename(title).slice(0, 80)} - ${id.slice(0, 8)}`),
      attemptIndex: 0, attemptCount: candidates.length, fileIndex: 0,
      files: [], queue: candidates, checkpoints: [], bytesPerSecond: 0, manualHints: [],
    };
    this.state.tasks.unshift(task);
    this.publish();
    await this.persist();
    this.schedule();
    return id;
  }

  task(id: string): StoredTask {
    const task = this.state.tasks.find(task => task.id === id);
    if (!task) throw new Error('任务不存在');
    return task;
  }

  candidateUrl(id: string): string {
    const candidate = this.searchState.candidates.find(candidate => candidate.id === id);
    if (!candidate || !/^https?:\/\//i.test(candidate.url)) throw new Error('来源页面不可用');
    return candidate.url;
  }

  async pause(id: string): Promise<void> { await this.stopTask(id, false); }
  async cancel(id: string): Promise<void> { await this.stopTask(id, true); }

  private async stopTask(id: string, cancel: boolean): Promise<void> {
    const task = this.task(id);
    if (['completed', 'cancelled'].includes(task.status)) return;
    // 退出时会暂停任务，但不能撤销用户已经发出的取消请求。
    if (task.status === 'cancelling' && !cancel) return;
    if (this.active?.taskId === id) {
      task.status = cancel ? 'cancelling' : 'pausing';
      this.active.process.postMessage({ kind: 'abort' });
      if (!this.active.stopping) this.active.stopping = setTimeout(() => {
        if (this.active?.taskId === id) this.finish(task, task.status === 'cancelling' ? 'cancelled' : 'paused');
      }, 5000);
    } else {
      task.status = cancel ? 'cancelled' : 'paused';
      task.bytesPerSecond = 0;
      task.etaSeconds = undefined;
    }
    task.updatedAt = new Date().toISOString();
    this.publish();
    await this.persist();
  }

  async resume(id: string): Promise<void> {
    const task = this.task(id);
    if (!['paused', 'failed', 'cancelled'].includes(task.status) || this.closing) return;
    if (task.status === 'failed' || task.status === 'cancelled') task.attemptIndex = 0;
    task.status = 'queued';
    task.error = undefined;
    task.password = undefined;
    task.passwordNote = undefined;
    task.passwordAssessment = undefined;
    task.manualHints = [];
    task.updatedAt = new Date().toISOString();
    this.publish();
    await this.persist();
    this.schedule();
  }

  private schedule(): void {
    if (this.active || this.closing) return;
    const task = [...this.state.tasks].reverse().find(task => task.status === 'queued');
    if (!task) return;
    task.status = 'resolving';
    const startingIndex = task.attemptIndex;
    const runId = randomUUID();
    let resolveDone!: () => void;
    const done = new Promise<void>(resolve => { resolveDone = resolve; });
    const process = this.createWorker(
      { kind: 'download', queue: task.queue.slice(startingIndex), outputDirectory: task.outputDirectory,
        checkpoints: task.checkpoints, proxyUrl: this.settings.proxyUrl,
        llm: {
          llm: { ...this.settings.llm, provider: 'openai-compatible', apiKey: this.state.llmApiKey ?? '' },
          passwordCheck: { enabled: this.settings.llm.enabled, failureMode: this.settings.llm.failureMode },
        } },
      message => this.downloadMessage(task, startingIndex, runId, message),
      () => {
        if (this.active?.runId !== runId) return;
        if (task.status === 'pausing' || task.status === 'cancelling') this.finish(task, task.status === 'pausing' ? 'paused' : 'cancelled');
        else this.finish(task, 'failed', '下载服务意外退出，已保留可继续的文件。');
      },
    );
    this.active = { taskId: task.id, runId, process, done, resolveDone };
    this.publish();
    this.saveSoon();
  }

  private downloadMessage(task: StoredTask, startingIndex: number, runId: string, message: WorkerResponse): void {
    if (this.active?.runId !== runId) return;
    if (message.kind === 'download-event') {
      const event = message.event;
      const stopping = task.status === 'pausing' || task.status === 'cancelling';
      if (event.type === 'candidate') {
        Object.assign(task, {
          candidateName: event.candidate.name, platform: event.candidate.platform, sourceUrl: event.candidate.url,
          attemptIndex: startingIndex + event.index, fileIndex: 0, error: undefined,
          password: undefined, passwordNote: undefined, passwordAssessment: undefined,
        });
      } else if (event.type === 'resolving') {
        if (!stopping) task.status = 'resolving';
      } else if (event.type === 'password-assessment') {
        task.passwordAssessment = event.assessment;
      } else if (event.type === 'plan') {
        task.password = event.password;
        task.passwordNote = event.note;
        task.files = event.files.map(file => ({ name: file.filename ?? '下载文件', state: 'pending', receivedBytes: 0, totalBytes: file.size }));
      } else if (event.type === 'file-start') {
        if (!stopping) task.status = 'downloading';
        task.fileIndex = event.index;
        if (task.files[event.index]) task.files[event.index].state = 'downloading';
      } else if (event.type === 'file-progress') {
        const file = task.files[event.index];
        if (file) Object.assign(file, { receivedBytes: event.progress.receivedBytes, totalBytes: event.progress.totalBytes });
        task.bytesPerSecond = event.progress.bytesPerSecond;
        task.etaSeconds = event.progress.etaSeconds;
      } else if (event.type === 'file-complete') {
        const file = task.files[event.index];
        if (file) {
          file.state = 'completed';
          file.filepath = event.filepath;
          file.receivedBytes = event.checkpoint?.size ?? file.totalBytes ?? file.receivedBytes;
          file.totalBytes = file.receivedBytes;
        }
        if (event.checkpoint) task.checkpoints = [...task.checkpoints.filter(item => item.source !== event.checkpoint!.source), event.checkpoint];
      } else if (event.type === 'candidate-error') task.error = event.error;
      task.updatedAt = new Date().toISOString();
      this.publish();
      this.saveSoon();
    } else if (message.kind === 'download-complete') {
      task.manualHints = message.result.manualHints;
      if (message.result.success) task.password = message.result.password;
      const stopped = task.status === 'cancelling' ? 'cancelled' : task.status === 'pausing' ? 'paused' : undefined;
      this.finish(task, stopped ?? (message.result.success ? 'completed' : 'failed'), stopped ? undefined : message.result.error);
    } else if (message.kind === 'aborted') {
      this.finish(task, task.status === 'cancelling' ? 'cancelled' : 'paused');
    } else if (message.kind === 'error') {
      this.finish(task, task.status === 'pausing' ? 'paused' : task.status === 'cancelling' ? 'cancelled' : 'failed', message.error);
    }
  }

  private finish(task: StoredTask, status: StoredTask['status'], error?: string): void {
    const active = this.active;
    this.active = undefined;
    if (active?.stopping) clearTimeout(active.stopping);
    active?.process.kill();
    task.status = status;
    task.error = error;
    task.bytesPerSecond = 0;
    task.etaSeconds = undefined;
    task.updatedAt = new Date().toISOString();
    this.publish();
    void this.persist().catch(() => undefined).finally(() => { active?.resolveDone(); this.schedule(); });
    if (status === 'completed') this.emit('completed', task.title);
  }

  async updateSettings(change: Partial<Settings>): Promise<void> {
    const next = validatedSettings(change, this.state.settings);
    if (next.characterId && !this.characters.some(character => character.id === next.characterId)) throw new Error('角色不存在');
    this.state.settings = next;
    await this.persist();
    this.publish();
    this.emit('settings', next);
  }

  async updateLLMSettings(llm: Settings['llm'], apiKey?: string): Promise<void> {
    const next = validatedSettings({ llm }, this.settings);
    if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length > 8192 || /\s/.test(apiKey))) {
      throw new Error('API Key 格式不正确');
    }
    const previous = { llm: this.settings.llm, apiKey: this.state.llmApiKey };
    this.state.settings.llm = next.llm;
    this.state.llmApiKey = apiKey === undefined ? previous.apiKey : apiKey || undefined;
    try { await this.persist(); }
    catch (error) {
      this.state.settings.llm = previous.llm;
      this.state.llmApiKey = previous.apiKey;
      this.publish();
      throw error;
    }
    this.publish();
  }

  async addCharacter(character: Character): Promise<void> {
    this.state.characters.push(character);
    this.state.settings.characterId = character.id;
    this.state.settings.petVisible = true;
    await this.persist();
    this.publish();
    this.emit('settings', this.settings);
  }

  async removeCharacter(id: string): Promise<void> {
    this.state.characters = this.state.characters.filter(character => character.id !== id);
    if (this.settings.characterId === id) this.settings.characterId = this.characters[0]?.id;
    await this.persist();
    this.publish();
    this.emit('settings', this.settings);
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    this.stopSearch();
    for (const task of this.state.tasks) if (task.status === 'queued') task.status = 'paused';
    const active = this.active;
    if (active) { await this.pause(active.taskId); await active.done; }
    if (this.saveTimer) clearTimeout(this.saveTimer);
    await this.persist();
    await this.store.flush();
  }

  private publish(): void { if (this.state) this.emit('change', this.snapshot()); }

  private saveSoon(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.persist().catch(() => undefined);
    }, 400);
  }

  private async persist(): Promise<void> {
    try { await this.store.save(this.state); }
    catch (error) {
      this.notice = '任务记录未能保存，请检查磁盘空间和文件夹权限。';
      this.publish();
      throw error;
    }
  }
}
