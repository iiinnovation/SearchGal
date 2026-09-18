import type { DownloadTask } from '../../shared/contracts';

export const api = window.searchgal;
export type RunAction = (action: () => Promise<unknown>) => void;

export function bytes(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return '大小待获取';
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let number = value / 1024;
  let index = 0;
  while (number >= 1024 && index < units.length - 1) { number /= 1024; index++; }
  return `${number.toFixed(number >= 100 ? 0 : 1)} ${units[index]}`;
}

export function time(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '';
  if (seconds < 60) return `约 ${Math.max(1, Math.ceil(seconds))} 秒`;
  if (seconds < 3600) return `约 ${Math.ceil(seconds / 60)} 分钟`;
  return `约 ${(seconds / 3600).toFixed(1)} 小时`;
}

export function progress(task: DownloadTask): { value?: number; label: string } {
  if (task.status === 'completed') return { value: 100, label: '全部文件已下载' };
  const file = task.files[task.fileIndex];
  if (!file) return { label: task.status === 'queued' ? '等待前面的任务完成' : '正在寻找下载地址' };
  const known = file.totalBytes !== undefined && file.totalBytes > 0;
  const value = known ? Math.min(100, (file.receivedBytes / file.totalBytes!) * 100) : undefined;
  return { value, label: `${bytes(file.receivedBytes)}${known ? ` / ${bytes(file.totalBytes)}` : ''}` };
}

export function characterUrl(id: string, preview = false): string { return `searchgal-asset://characters/${id}${preview ? '?preview=1' : ''}`; }

export const statusText: Record<DownloadTask['status'], string> = {
  queued: '排队中', resolving: '查找来源', downloading: '下载中', pausing: '正在暂停', paused: '已暂停',
  cancelling: '正在取消', cancelled: '已取消', completed: '已完成', failed: '需要处理',
};
