import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import type { Settings, StoredState, StoredTask, TaskStatus } from '../shared/contracts';
import { characterImageFormat } from '../shared/character-images';
import { DEFAULT_CONFIG } from '../../../downloader/src/utils/config';

export const ACTIVE_STATUSES: TaskStatus[] = ['resolving', 'downloading', 'pausing', 'cancelling'];

export function defaultState(downloadDirectory: string, apiUrl = ''): StoredState {
  return {
    version: 1,
    settings: {
      llm: {
        enabled: false, baseURL: DEFAULT_CONFIG.llm.baseURL, model: DEFAULT_CONFIG.llm.model,
        timeoutMs: DEFAULT_CONFIG.llm.timeoutMs, failureMode: 'continue',
      },
      downloadDirectory, apiUrl, proxyUrl: '', notifications: true, sound: false,
      launchAtLogin: false, petVisible: true, petSize: 180, nickname: '小伙伴',
    },
    tasks: [], characters: [], recentSearches: [],
  };
}

/** 重启后不自动重启网络任务；用户选择继续时，下载器重新核验断点。 */
export function recoverTasks(tasks: StoredTask[]): StoredTask[] {
  return tasks.map(task => {
    if (![...ACTIVE_STATUSES, 'queued'].includes(task.status)) return task;
    return {
      ...task,
      status: task.status === 'cancelling' ? 'cancelled' : 'paused',
      bytesPerSecond: 0,
      etaSeconds: undefined,
    };
  });
}

export function validatedSettings(value: Partial<Settings>, current: Settings): Settings {
  const next: Settings = { ...current };
  if ('llm' in value) {
    const llm = value.llm;
    if (!llm || typeof llm !== 'object' || typeof llm.enabled !== 'boolean' ||
        typeof llm.baseURL !== 'string' || llm.baseURL.length > 2048 ||
        typeof llm.model !== 'string' || !llm.model.trim() || llm.model.length > 200 ||
        !Number.isInteger(llm.timeoutMs) || llm.timeoutMs < 1000 || llm.timeoutMs > 120_000 ||
        !['continue', 'skip'].includes(llm.failureMode)) throw new Error('LLM 设置不正确，超时需为 1–120 秒');
    const url = new URL(llm.baseURL.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('LLM 接口地址需为 HTTP 或 HTTPS，不能包含凭据、查询参数或片段');
    }
    next.llm = {
      enabled: llm.enabled, baseURL: url.href.replace(/\/+$/, ''), model: llm.model.trim(),
      timeoutMs: llm.timeoutMs, failureMode: llm.failureMode,
    };
  }
  if ('downloadDirectory' in value) {
    if (typeof value.downloadDirectory !== 'string' || !isAbsolute(value.downloadDirectory)) throw new Error('请选择有效的下载文件夹');
    next.downloadDirectory = value.downloadDirectory;
  }
  for (const key of ['apiUrl', 'proxyUrl'] as const) {
    if (!(key in value)) continue;
    const text = value[key];
    if (typeof text !== 'string' || text.length > 2048) throw new Error('地址格式不正确');
    const trimmed = text.trim();
    if (trimmed) {
      const url = new URL(trimmed);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('地址需要使用 http:// 或 https://');
    }
    next[key] = trimmed.replace(/\/$/, '');
  }
  for (const key of ['notifications', 'sound', 'launchAtLogin', 'petVisible'] as const) {
    if (key in value) {
      if (typeof value[key] !== 'boolean') throw new Error('设置值不正确');
      next[key] = value[key];
    }
  }
  if ('petSize' in value) {
    if (!Number.isFinite(value.petSize) || value.petSize! < 100 || value.petSize! > 360) throw new Error('角色大小需要在 100–360 之间');
    next.petSize = Math.round(value.petSize!);
  }
  if ('nickname' in value) {
    if (typeof value.nickname !== 'string' || !value.nickname.trim() || value.nickname.length > 24) throw new Error('伙伴昵称需要为 1–24 个字符');
    next.nickname = value.nickname.trim();
  }
  if ('characterId' in value) {
    if (value.characterId !== undefined && typeof value.characterId !== 'string') throw new Error('角色编号不正确');
    next.characterId = value.characterId;
  }
  if ('petPosition' in value) {
    if (value.petPosition && (!Number.isFinite(value.petPosition.x) || !Number.isFinite(value.petPosition.y))) throw new Error('窗口位置不正确');
    next.petPosition = value.petPosition;
  }
  return next;
}

export interface SecretCodec {
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export class StateStore {
  private pending: Promise<void> = Promise.resolve();
  private readonly path: string;
  notice?: string;

  constructor(readonly directory: string, private readonly defaults: StoredState, private readonly secrets?: SecretCodec) {
    this.path = join(directory, 'state.json');
  }

  async load(): Promise<StoredState> {
    await mkdir(this.directory, { recursive: true });
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(this.defaults);
      throw error;
    }
    try {
      const data = JSON.parse(raw) as StoredState & { llmApiKeyEncrypted?: string };
      if (data.version !== 1 || !Array.isArray(data.tasks) || !Array.isArray(data.characters) || !Array.isArray(data.recentSearches)) throw new Error('invalid state');
      const settings = validatedSettings(data.settings, this.defaults.settings);
      if (!data.tasks.every(validTask)) throw new Error('invalid task state');
      if (!data.characters.every(character => typeof character.id === 'string' && /^[a-f0-9-]{36}$/.test(character.id) &&
          typeof character.name === 'string' && typeof character.image === 'string' && characterImageFormat(character.image) &&
          character.image === `${character.id}.${characterImageFormat(character.image)}` &&
          (character.preview === undefined || character.preview === `${character.id}.preview.png`) &&
          (character.frameCount === undefined || (Number.isSafeInteger(character.frameCount) && character.frameCount > 0)) &&
          Number.isSafeInteger(character.width) && character.width > 0 && character.width <= 4096 &&
          Number.isSafeInteger(character.height) && character.height > 0 && character.height <= 4096)) throw new Error('invalid character state');
      let llmApiKey: string | undefined;
      if (data.llmApiKeyEncrypted) {
        try {
          if (!this.secrets) throw new Error('secure storage unavailable');
          llmApiKey = this.secrets.decrypt(data.llmApiKeyEncrypted);
        } catch { this.notice = '已保存的 LLM API Key 无法读取，请在偏好设置中重新配置。'; }
      }
      return {
        version: 1, characters: data.characters, llmApiKey, settings, tasks: recoverTasks(data.tasks),
        recentSearches: data.recentSearches.filter(query => typeof query === 'string' && query.length <= 200).slice(0, 8),
      };
    } catch {
      await copyFile(this.path, join(this.directory, `state.unreadable-${Date.now()}.json`));
      this.notice = '上次的任务记录无法读取，已保留备份。下载文件仍在原文件夹中。';
      return structuredClone(this.defaults);
    }
  }

  save(state: StoredState): Promise<void> {
    const { llmApiKey, ...publicState } = state;
    if (llmApiKey && !this.secrets) return Promise.reject(new Error('系统安全存储不可用，无法保存 API Key'));
    const json = JSON.stringify({ ...publicState, llmApiKeyEncrypted: llmApiKey ? this.secrets!.encrypt(llmApiKey) : undefined }, null, 2);
    const write = this.pending.catch(() => undefined).then(async () => {
      await writeFile(this.path + '.tmp', json, { mode: 0o600 });
      await rename(this.path + '.tmp', this.path);
    });
    this.pending = write;
    return write;
  }

  flush(): Promise<void> { return this.pending; }
}

function validTask(task: StoredTask): boolean {
  const statuses: TaskStatus[] = ['queued', ...ACTIVE_STATUSES, 'paused', 'cancelled', 'completed', 'failed'];
  return typeof task.id === 'string' && /^[a-f0-9-]{36}$/.test(task.id) && typeof task.title === 'string' &&
    (task.password === undefined || typeof task.password === 'string') &&
    (task.passwordNote === undefined || typeof task.passwordNote === 'string') &&
    (task.passwordAssessment === undefined || (task.passwordAssessment !== null &&
      typeof task.passwordAssessment.canExtractWithoutExtraPassword === 'boolean' &&
      typeof task.passwordAssessment.hasPassword === 'boolean' && typeof task.passwordAssessment.reason === 'string')) &&
    typeof task.outputDirectory === 'string' && isAbsolute(task.outputDirectory) && statuses.includes(task.status) &&
    Array.isArray(task.files) && task.files.every(file => typeof file.name === 'string' && Number.isFinite(file.receivedBytes)) &&
    Array.isArray(task.checkpoints) && task.checkpoints.every(entry => typeof entry.filepath === 'string' && typeof entry.source === 'string' &&
      typeof entry.url === 'string' && typeof entry.etag === 'string' && Number.isSafeInteger(entry.size) && /^[a-f0-9]{64}$/.test(entry.sha256)) &&
    Array.isArray(task.queue) && task.queue.length <= 100 && task.queue.every(candidate => typeof candidate.name === 'string' &&
      typeof candidate.platform === 'string' && typeof candidate.url === 'string' && /^(https?:\/\/|magnet:\?)/.test(candidate.url)) &&
    Number.isInteger(task.attemptIndex) && task.attemptIndex >= 0 && Array.isArray(task.manualHints);
}
