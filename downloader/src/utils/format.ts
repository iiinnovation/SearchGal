import { basename } from 'path';

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '大小未知';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 去掉文件名里在各系统上不合法的字符 */
export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[<>:"\/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.replace(/^\.+$/, '_') || 'download';
}

export function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** 从 URL 的最后一段推断文件名 */
export function filenameFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    const last = basename(pathname);
    if (!last || last === '/') return undefined;
    return sanitizeFilename(safeDecode(last));
  } catch {
    return undefined;
  }
}

const ARCHIVE_EXT = /\.(7z|zip|rar|exe|iso|tar|gz|bz2|xz|apk|part\d+\.rar|z\d{2}|7z\.\d{3}|r\d{2})$/i;

export function looksLikeArchive(nameOrUrl: string): boolean {
  let path = nameOrUrl;
  try {
    path = new URL(nameOrUrl).pathname;
  } catch {
    /* 普通文件名 */
  }
  const decoded = safeDecode(path);
  return ARCHIVE_EXT.test(decoded) || multipartVolume(basename(decoded)) !== undefined;
}

/**
 * 分卷压缩包的"卷组"标识：`foo.part1.rar`、`foo.7z.001`、`foo.z01` 都归到 `foo`。
 * 不是分卷的文件返回 undefined。
 */
export function multipartGroup(filename: string): string | undefined {
  return multipartVolume(filename)?.group;
}

export interface MultipartVolume {
  group: string;
  format: string;
  index: number;
  firstIndex: number;
  companion?: string;
}

/** 分卷格式、编号和必需的主卷；同名的不同压缩格式不能混成一组。 */
export function multipartVolume(filename: string): MultipartVolume | undefined {
  const patterns = [
    [/^(.*)\.part(\d+)\.rar$/i, 'rar-part', 1],
    [/^(.*)\.7z\.(\d{3})$/i, '7z', 1],
    [/^(.*)\.zip\.(\d{3})$/i, 'zip-split', 1],
    [/^(.*)\.z(\d{2})$/i, 'zip', 1],
    [/^(.*)\.r(\d{2})$/i, 'rar', 0],
    [/^(.*)\.(\d{3})$/i, 'split', 1],
  ] as const;
  for (const [pattern, format, firstIndex] of patterns) {
    const match = filename.match(pattern);
    if (match) {
      const group = match[1].toLowerCase();
      return {
        group, format, firstIndex, index: Number(match[2]),
        companion: format === 'zip' || format === 'rar' ? `${group}.${format}` : undefined,
      };
    }
  }
  return undefined;
}

/** 归一化名字用于相关度比较：全角转半角、小写、去掉空白和标点 */
export function normalizeName(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

/** 最长公共子串长度，用于模糊匹配名字（名字很短，O(n*m) 足够） */
export function longestCommonSubstring(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) best = current[j];
      }
    }
    previous = current;
  }
  return best;
}
