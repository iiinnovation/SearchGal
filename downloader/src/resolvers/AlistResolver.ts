import type { Candidate, DownloadPlan, ResolvedDownload, Resolver, ResolutionContext } from '../types/index.js';
import { fetchJson } from '../utils/http.js';
import { looksLikeArchive, multipartVolume, safeDecode } from '../utils/format.js';
import { groupArchives, parentPath } from '../utils/archives.js';

/** SearchGal 收录的、基于 Alist/OpenList 的自建网盘站 */
export const ALIST_HOSTS = [
  '05fx.022016.xyz',   // 05的资源小站
  'catcat.cloud',      // 猫猫网盘
  'www.nullcloud.top', // 未知云盘
  'nullcloud.top',
  'zi0.cc',            // 紫零的喵喵屋
];

interface AlistResponse<T> {
  code: number;
  message: string;
  data: T | null;
}

interface AlistEntry {
  name: string;
  size: number;
  is_dir: boolean;
  sign?: string;
  raw_url?: string;
}

interface AlistList {
  content: AlistEntry[] | null;
  total: number;
}

const MAX_DEPTH = 2;
const MAX_ENTRIES = 200;
const MAX_DIRECTORY_ENTRIES = 10_000;
const MAX_LIST_PAGES = 100;

interface ListedFile {
  path: string;
  entry: AlistEntry;
}

/**
 * Alist 的网页地址 `/<path>` 只会返回前端 HTML；真正的文件地址要通过 `POST /api/fs/get` 的 `raw_url` 拿到。
 * 搜索结果指向目录时列出目录，挑出压缩包（分卷全下）。
 */
export class AlistResolver implements Resolver {
  name = 'Alist';

  canResolve(url: string): boolean {
    const host = hostOf(url);
    return host !== undefined && ALIST_HOSTS.includes(host);
  }

  async resolve(candidate: Candidate, context: ResolutionContext = {}): Promise<DownloadPlan[]> {
    context.signal?.throwIfAborted();
    const parsed = splitAlistUrl(candidate.url);
    if (!parsed) return [];
    const { origin, path } = parsed;

    // 服务端拼出来的路径是原始字符串；万一传进来的是已编码的 URL，再用解码后的路径试一次
    const paths = [...new Set([path, safeDecode(path)])];

    for (const p of paths) {
      const entry = await this.get(origin, p, context);
      if (!entry) continue;

      let chosen: ListedFile[];
      if (entry.is_dir) {
        chosen = pickArchiveSet(await this.collectFiles(origin, p, 0, context));
      } else if (multipartVolume(entry.name) || /\.(zip|rar)$/i.test(entry.name)) {
        // 搜索结果也会直接指向某一卷；只选这份文件所属的卷组，不能改下目录里另一份游戏。
        const directory = parentPath(p) || '/';
        const siblings = (await this.list(origin, directory, context)).filter(file => !file.is_dir).map(file => ({
          path: `${directory.replace(/\/$/, '')}/${file.name}`,
          name: file.name,
          entry: file.name === entry.name ? entry : file,
        }));
        if (!siblings.some(file => file.name === entry.name)) throw new Error('完整目录列表中找不到候选文件，资源可能已变化');
        chosen = groupArchives(siblings).sets.find(set => set.some(file => file.name === entry.name)) ?? [];
      } else {
        chosen = [{ path: p, entry }];
      }
      const targets: ResolvedDownload[] = [];
      for (const file of chosen) {
        const info = file.entry.raw_url ? file.entry : await this.get(origin, file.path, context);
        const target = info && !info.is_dir ? this.toDownload(origin, file.path, info) : undefined;
        if (target) targets.push(target);
      }
      if (targets.length === chosen.length && targets.length > 0) return [{ files: targets }];
    }

    return [];
  }

  private toDownload(origin: string, path: string, entry: AlistEntry): ResolvedDownload | undefined {
    const url = entry.raw_url || `${origin}/d${encodePath(path)}${entry.sign ? `?sign=${entry.sign}` : ''}`;
    if (!url) return undefined;
    return {
      kind: 'http',
      url,
      filename: entry.name,
      size: entry.size > 0 ? entry.size : undefined,
      headers: { Referer: `${origin}/` },
    };
  }

  private async get(origin: string, path: string, context: ResolutionContext): Promise<AlistEntry | undefined> {
    const response = await fetchJson<AlistResponse<AlistEntry>>(`${origin}/api/fs/get`, {
      signal: context.signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, password: '' }),
    });
    if (response.code !== 200 || !response.data) return undefined;
    return response.data;
  }

  private async list(origin: string, path: string, context: ResolutionContext): Promise<AlistEntry[]> {
    const entries: AlistEntry[] = [];
    const seen = new Set<string>();
    let total: number | undefined;
    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
      const response = await fetchJson<AlistResponse<AlistList>>(`${origin}/api/fs/list`, {
        signal: context.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, password: '', page, per_page: MAX_ENTRIES, refresh: false }),
      });
      const data = response.data;
      if (response.code !== 200 || !data || !Number.isSafeInteger(data.total) || data.total < 0 ||
          (data.content !== null && !Array.isArray(data.content))) {
        throw new Error(`无法完整读取目录 ${path}: ${response.message}`);
      }
      if (data.total > MAX_DIRECTORY_ENTRIES) throw new Error(`目录超过 ${MAX_DIRECTORY_ENTRIES} 项，无法确认分卷完整`);
      if (total !== undefined && data.total !== total) throw new Error('分页期间目录数量变化，无法确认分卷完整');
      total = data.total;
      const content = data.content ?? [];
      for (const entry of content) {
        if (seen.has(entry.name)) throw new Error('目录分页重复，无法确认分卷完整');
        seen.add(entry.name);
        entries.push(entry);
      }
      if (entries.length === total) return entries;
      if (entries.length > total || content.length === 0) throw new Error('目录分页不完整或数量不一致');
    }
    throw new Error('目录分页超过上限，无法确认分卷完整');
  }

  private async collectFiles(origin: string, dir: string, depth: number, context: ResolutionContext): Promise<Array<{ path: string; entry: AlistEntry }>> {
    const entries = await this.list(origin, dir, context);
    const files: Array<{ path: string; entry: AlistEntry }> = [];
    for (const entry of entries) {
      const path = `${dir.replace(/\/$/, '')}/${entry.name}`;
      if (entry.is_dir) {
        if (depth < MAX_DEPTH) files.push(...(await this.collectFiles(origin, path, depth + 1, context)));
      } else {
        files.push({ path, entry });
      }
    }
    return files;
  }
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * 服务端生成的 URL 是 `BASE_URL + parent + "/" + name`，路径部分没有编码，
 * 也可能出现 `//`。这里不用 URL 解析（`#`、`?` 会被吃掉），直接按 host 切分。
 */
function splitAlistUrl(url: string): { origin: string; path: string } | undefined {
  const match = url.match(/^(https?:\/\/[^/]+)(\/.*)?$/);
  if (!match) return undefined;
  const origin = match[1];
  const rawPath = match[2] ?? '/';
  const path = rawPath.replace(/\/{2,}/g, '/');
  return { origin, path: path === '' ? '/' : path };
}

function encodePath(path: string): string {
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

/**
 * 目录里挑要下的文件：优先成套的分卷压缩包，其次最大的压缩包，再不然就是最大的文件。
 * 忽略 Alist 的隐藏文件和明显不是游戏本体的小文件。
 */
export function pickArchiveSet<T extends { path: string; entry: AlistEntry }>(files: T[]): T[] {
  const visible = files.filter(f => !f.entry.name.startsWith('.') && f.entry.size > 0);
  if (visible.length === 0) return [];
  const grouped = groupArchives(visible.map(file => ({ path: file.path, name: file.entry.name, file })));
  const sets = grouped.sets.map(set => set.map(item => item.file));
  const multipart = sets.filter(set => set.length > 1);
  if (multipart.length > 0) {
    multipart.sort((a, b) => totalSize(b) - totalSize(a));
    return multipart[0];
  }
  const eligible = sets.flat();
  if (eligible.length === 0) return [];
  const archives = eligible.filter(f => looksLikeArchive(f.entry.name));
  if (grouped.incomplete.length > 0 && archives.length === 0) return [];
  const pool = archives.length > 0 ? archives : eligible;
  pool.sort((a, b) => b.entry.size - a.entry.size);
  return [pool[0]];
}

function totalSize(files: Array<{ entry: AlistEntry }>): number {
  return files.reduce((sum, f) => sum + f.entry.size, 0);
}
