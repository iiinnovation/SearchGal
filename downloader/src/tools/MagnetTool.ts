import type { Capabilities, DownloadOptions, DownloadResult, DownloadTool, ResolvedDownload } from '../types/index.js';
import { runInherit } from '../utils/process.js';

/**
 * 磁力链接 / 种子：交给 aria2c。没有 aria2c 时只能把链接给用户手动处理。
 */
export class MagnetTool implements DownloadTool {
  name = 'MagnetTool';

  constructor(private readonly capabilities: Capabilities) {}

  get description(): string {
    return this.capabilities.aria2c ? '磁力链接 / BT 种子（aria2c）' : '磁力链接 / BT 种子（需要安装 aria2c）';
  }

  canHandle(target: ResolvedDownload): boolean {
    return target.kind === 'magnet' || /\.torrent(\?|$)/i.test(target.url);
  }

  async download(target: ResolvedDownload, options: DownloadOptions): Promise<DownloadResult> {
    options.signal?.throwIfAborted();
    if (!this.capabilities.aria2c) {
      return {
        success: false,
        manual: true,
        error: `没有 aria2c，无法自动下载 BT 资源。可以把这个链接粘贴到 qBittorrent 等客户端：\n   ${target.url}`,
      };
    }

    const args = [
      target.url,
      '-d', options.outputDir,
      '--seed-time=0',
      '--bt-stop-timeout=600',
      '--follow-torrent=mean',
      '--bt-max-peers=100',
      '--file-allocation=none',
      '--summary-interval=0',
      '--console-log-level=warn',
    ];

    if (!options.quiet) console.log('🔧 aria2c BT 下载中（无种子时最多等待 10 分钟）...');
    try {
      const { code } = await runInherit('aria2c', args, { signal: options.signal });
      if (code === 0) {
        return { success: true, filepath: options.outputDir };
      }
      return { success: false, error: `aria2c 退出码 ${code}（可能没有可用的做种）` };
    } catch (error) {
      options.signal?.throwIfAborted();
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
