import { join } from 'path';
import { createHash } from 'crypto';
import type { Capabilities, DownloadOptions, DownloadResult, DownloadTool, ResolvedDownload } from '../types/index.js';
import { isHtmlLike, probeUrl } from '../utils/http.js';
import { downloadWithNode } from '../utils/nodeDownload.js';
import { downloadWithAria2 } from '../utils/aria2Download.js';
import { filenameFromUrl, formatBytes, sanitizeFilename } from '../utils/format.js';

/**
 * HTTP 文件下载：来源有强 ETag 和完整大小时可用 aria2c，否则使用内置 Node 下载器。
 * 下载前先探测 Content-Type，坚决不把网页当文件存下来。
 */
export class DirectDownloader implements DownloadTool {
  name = 'DirectDownloader';

  constructor(private readonly capabilities: Capabilities) {}

  get description(): string {
    return this.capabilities.aria2c ? 'HTTP 直链（aria2c 16 线程）' : 'HTTP 直链（内置下载器，安装 aria2c 可提速）';
  }

  canHandle(target: ResolvedDownload): boolean {
    return target.kind === 'http' && /^https?:\/\//i.test(target.url);
  }

  async download(target: ResolvedDownload, options: DownloadOptions): Promise<DownloadResult> {
    try {
      const probe = await probeUrl(target.url, target.headers, { signal: options.signal });
      if (!probe.ok) {
        return { success: false, error: `文件地址不可访问 (HTTP ${probe.status})` };
      }
      if (isHtmlLike(probe.contentType)) {
        return { success: false, error: `链接返回的是网页（${probe.contentType || '未知类型'}），不是文件` };
      }

      const filename = sanitizeFilename(target.filename ?? probe.filename ?? filenameFromUrl(probe.finalUrl) ?? 'download.bin');
      const size = target.size ?? probe.size;
      const destPath = join(options.outputDir, filename);

      if (!options.quiet) console.log(`📄 文件: ${filename}  (${formatBytes(size)})`);

      const transfer = {
        url: probe.finalUrl, destPath, headers: target.headers, expectedSize: size,
        signal: options.signal, onProgress: options.onProgress, quiet: options.quiet,
      };
      let verification: DownloadResult['verification'];

      if (this.capabilities.aria2c && probe.etag && size !== undefined) {
        await downloadWithAria2({ ...transfer, expectedSize: size, etag: probe.etag });
        verification = { url: probe.finalUrl, etag: probe.etag, size };
      } else {
        if (this.capabilities.aria2c && !options.quiet) console.log('ℹ️  来源未提供强 ETag 或完整大小，使用内置下载器。');
        const downloaded = await downloadWithNode(transfer);
        if (probe.etag && downloaded.etag === probe.etag && downloaded.resource ===
            createHash('sha256').update(JSON.stringify(probe.finalUrl)).digest('hex')) {
          verification = { url: probe.finalUrl, etag: downloaded.etag, size: downloaded.size };
        }
      }
      return { success: true, filepath: destPath, ...(options.recordVerification && verification ? { verification } : {}) };
    } catch (error) {
      options.signal?.throwIfAborted();
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

}
