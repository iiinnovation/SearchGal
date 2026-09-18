import type { DownloadTool, ResolvedDownload } from '../types/index.js';

/**
 * 下载工具注册表：按解析出来的目标类型找能处理的工具。
 */
export class ToolRegistry {
  private readonly tools: DownloadTool[] = [];

  register(tool: DownloadTool): void {
    this.tools.push(tool);
  }

  findTool(target: ResolvedDownload): DownloadTool | undefined {
    return this.tools.find(tool => tool.canHandle(target));
  }

  getAll(): DownloadTool[] {
    return [...this.tools];
  }
}
