import type { Candidate, DownloadPlan, Resolver, ResolutionContext } from '../types/index.js';
import { fetchWithTimeout, readTextLimited } from '../utils/http.js';
import { filenameFromUrl, looksLikeArchive } from '../utils/format.js';

const PAGE_HOST = 'www.shinnku.com';
const FILE_HOST = 'zd.shinnku.top';

/**
 * 真红小站：搜索结果是 `https://www.shinnku.com/files/<path>.7z` 这样的**页面**（Next.js 路由，返回 HTML），
 * 页面里才有真正的文件地址 `https://zd.shinnku.top/file/<path>.7z`。
 */
export class ShinnkuResolver implements Resolver {
  name = '真红小站';

  canResolve(url: string): boolean {
    try {
      return new URL(url).hostname.toLowerCase().endsWith('shinnku.com');
    } catch {
      return false;
    }
  }

  async resolve(candidate: Candidate, context: ResolutionContext = {}): Promise<DownloadPlan[]> {
    const pageUrl = new URL(candidate.url);
    const fromPage = await this.findDownloadLink(pageUrl, context);
    const url = fromPage ?? this.guessFileUrl(pageUrl);
    if (!url) return [];

    return [
      {
        files: [
          {
            kind: 'http',
            url,
            filename: filenameFromUrl(url),
            headers: { Referer: candidate.url },
          },
        ],
      },
    ];
  }

  private async findDownloadLink(pageUrl: URL, context: ResolutionContext): Promise<string | undefined> {
    const response = await fetchWithTimeout(pageUrl, context);
    if (!response.ok) return undefined;
    const html = await readTextLimited(response);

    const links = [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
    return links.find(link => {
      try {
        const parsed = new URL(link);
        return parsed.hostname !== PAGE_HOST && looksLikeArchive(parsed.pathname);
      } catch {
        return false;
      }
    });
  }

  // 页面结构变了拿不到链接时，按已知的镜像规则拼一个；后面下载前会探测 Content-Type，拼错也不会下到网页
  private guessFileUrl(pageUrl: URL): string | undefined {
    if (!pageUrl.pathname.startsWith('/files/')) return undefined;
    return `https://${FILE_HOST}/file/${pageUrl.pathname.slice('/files/'.length)}`;
  }
}
