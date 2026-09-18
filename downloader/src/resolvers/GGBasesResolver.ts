import type { Candidate, DownloadPlan, Resolver, ResolutionContext } from '../types/index.js';
import { cookieHeaderFrom, fetchWithTimeout, readTextLimited } from '../utils/http.js';

/**
 * GGBases 是 BT 站，详情页 `view.so?id=` 里没有明文磁力。取磁力的流程和网页按钮一致：
 *   1. GET  magnet.so?id=<id>            → 302 到 ggb.dlgal.com，同时下发会话 cookie
 *   2. 页面脚本里有一次性令牌 downid
 *   3. POST magnet.so?downid=..&json=1&id= （带 cookie）→ {"hash": "<btih>"}
 */
export class GGBasesResolver implements Resolver {
  name = 'GGBases';

  canResolve(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname.endsWith('ggbases.com') && parsed.searchParams.has('id');
    } catch {
      return false;
    }
  }

  async resolve(candidate: Candidate, context: ResolutionContext = {}): Promise<DownloadPlan[]> {
    const id = new URL(candidate.url).searchParams.get('id');
    if (!id) return [];

    const page = await fetchWithTimeout(`https://www.ggbases.com/magnet.so?id=${id}`, {
      signal: context.signal,
      headers: { Referer: candidate.url },
      redirect: 'follow',
    });
    const html = await readTextLimited(page);
    const downid = html.match(/downid=([a-f0-9-]+)&json=1/i)?.[1];
    if (!downid) return [];

    const origin = new URL(page.url || 'https://ggb.dlgal.com').origin;
    const response = await fetchWithTimeout(`${origin}/magnet.so?downid=${downid}&json=1&id=${id}`, {
      signal: context.signal,
      method: 'POST',
      headers: {
        Cookie: cookieHeaderFrom(page),
        Referer: page.url,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    const text = await response.text();
    let hash: string | undefined;
    try {
      hash = (JSON.parse(text) as { hash?: string }).hash;
    } catch {
      return [];
    }
    if (!hash || !/^[a-f0-9]{40}$/i.test(hash)) return [];

    return [
      {
        files: [
          {
            kind: 'magnet',
            url: `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(candidate.name)}`,
            filename: candidate.name,
            note: 'BT 下载速度取决于做种情况',
          },
        ],
      },
    ];
  }
}
