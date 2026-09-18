import { spawn } from 'child_process';

/**
 * 检查外部命令是否可用。不用 `which`（Windows 上没有），而是直接尝试启动它：
 * 启动失败得到 ENOENT 就是没装。
 */
export function commandExists(cmd: string, args: string[] = ['--version']): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: boolean) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    try {
      const child = spawn(cmd, args, { stdio: 'ignore' });
      child.on('error', () => finish(false));
      child.on('close', () => finish(true));
    } catch {
      finish(false);
    }
  });
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * 以参数数组的形式运行外部程序（不经过 shell，URL 里的任何字符都不会被当成命令），
 * 并把它的输出直接透传到终端，这样 aria2c 的进度条能正常显示。
 */
export function runInherit(cmd: string, args: string[], options: { signal?: AbortSignal } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(options.signal.reason); return; }
    const child = spawn(cmd, args, { stdio: 'inherit', windowsHide: true });
    const abort = () => { child.kill('SIGINT'); };
    const clean = () => options.signal?.removeEventListener('abort', abort);
    options.signal?.addEventListener('abort', abort, { once: true });
    child.on('error', err => { clean(); reject(new Error(`${cmd} 启动失败: ${err.message}`)); });
    child.on('close', (code, signal) => {
      clean();
      if (options.signal?.aborted) reject(options.signal.reason);
      else resolve({ code, signal });
    });
  });
}
