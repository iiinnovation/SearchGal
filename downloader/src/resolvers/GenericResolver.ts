import type { Candidate, DownloadPlan, ResolvedDownload, Resolver, ResolutionContext } from '../types/index.js';
import { fetchWithTimeout, isHtmlLike, probeUrl, readTextLimited } from '../utils/http.js';
import { filenameFromUrl, longestCommonSubstring, looksLikeArchive, multipartVolume, normalizeName, safeDecode } from '../utils/format.js';
import { groupArchives } from '../utils/archives.js';

const MAX_ALTERNATIVES = 3;
const MIN_RELEVANCE = 0.5;

/**
 * 没有专门解析器的站点走这里：
 *   - 链接本身就是文件（Content-Type 不是网页）→ 直接下载
 *   - 是网页 → 在页面里找压缩包直链和磁力链接，按与游戏名的相关度排序
 * 需要登录/转存的网盘页解析不出来，返回空数组交给下一个候选。
 */
export class GenericResolver implements Resolver {
  name = '通用';

  canResolve(url: string): boolean {
    return /^https?:\/\//i.test(url) || url.startsWith('magnet:?');
  }

  async resolve(candidate: Candidate, context: ResolutionContext = {}): Promise<DownloadPlan[]> {
    context.signal?.throwIfAborted();
    if (candidate.url.startsWith('magnet:?')) {
      return [{ files: [{ kind: 'magnet', url: candidate.url, filename: candidate.name }] }];
    }

    const probe = await probeUrl(candidate.url, {}, context);
    if (!probe.ok) return [];

    if (!isHtmlLike(probe.contentType)) {
      if (multipartVolume(probe.filename ?? filenameFromUrl(probe.finalUrl) ?? '')) {
        throw new Error('直链指向分卷文件，需要包含全部分卷的目录或下载页面');
      }
      return [
        {
          files: [
            {
              kind: 'http',
              url: probe.finalUrl,
              filename: probe.filename ?? filenameFromUrl(probe.finalUrl),
              size: probe.size,
            },
          ],
        },
      ];
    }

    if (!probe.contentType.includes('html')) return [];

    const response = await fetchWithTimeout(candidate.url, context);
    if (!response.ok) return [];
    const html = await readTextLimited(response);
    const pageUrl = response.url || candidate.url;

    let extractedPassword: string | undefined;
    let note: string | undefined;

    if (context.enablePasswordCheck) {
      try {
        context.signal?.throwIfAborted();
        if (!context.assessor) throw new Error('LLM 未配置或已禁用，无法检查解压密码');
        const assessment = await context.assessor.assessPassword(html, candidate.name, context.signal);
        context.onPasswordAssessment?.(assessment);

        if (!assessment.canExtractWithoutExtraPassword) {
          if (context.passwordCheckFailureMode === 'skip') {
            throw new Error(`资源需要额外密码: ${assessment.reason}`);
          }
          note = `资源可能需要额外密码: ${assessment.reason}`;
          console.warn(`⚠️ [密码预警] ${note}（降级继续尝试下载）`);
        } else if (assessment.extractedPassword) {
          extractedPassword = assessment.extractedPassword;
        }
      } catch (error) {
        context.signal?.throwIfAborted();
        if (context.passwordCheckFailureMode === 'skip') throw error;
        note = '密码检查未完成，请在来源页面确认解压密码';
        console.warn(`⚠️ [LLM] 密码评估失败或超时，降级放行:`, error instanceof Error ? error.message : String(error));
      }
    }

    const sets = extractDownloadSets(html, pageUrl, candidate.name);

    return sets.slice(0, MAX_ALTERNATIVES).map(links => ({
      files: links.map(link =>
        link.startsWith('magnet:?')
          ? { kind: 'magnet', url: link, filename: candidate.name }
          : ({ kind: 'http', url: link, filename: filenameFromUrl(link), headers: { Referer: pageUrl } } as ResolvedDownload),
      ),
      password: extractedPassword,
      note: extractedPassword ? `解压密码: ${extractedPassword}` : note,
    }));
  }
}

/** 从页面里找出像下载地址的链接，按文件名与游戏名的相关度排序 */
export function extractDownloadLinks(html: string, pageUrl: string, gameName: string): string[] {
  return extractDownloadSets(html, pageUrl, gameName).flat();
}

/** 先组成完整下载方案，再按游戏名筛选，避免过滤或备选上限截断卷组。 */
function extractDownloadSets(html: string, pageUrl: string, gameName: string): string[][] {
  const found = new Set<string>();

  for (const match of html.matchAll(/magnet:\?xt=urn:btih:[a-zA-Z0-9]{32,40}[^"'<>\s]*/g)) {
    found.add(match[0].replace(/&amp;/g, '&'));
  }

  for (const match of html.matchAll(/(?:href|src|data-url|data-href)=["']([^"']+)["']/gi)) {
    const raw = match[1].replace(/&amp;/g, '&');
    let absolute: string;
    try {
      absolute = new URL(raw, pageUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:/.test(absolute)) continue;
    if (looksLikeArchive(absolute)) found.add(absolute);
  }

  const httpFiles = [...found].filter(link => !link.startsWith('magnet:')).map(link => {
    const parsed = new URL(link);
    return { link, path: parsed.origin + parsed.pathname, name: safeDecode(parsed.pathname.split('/').pop() ?? '') };
  });
  const grouped = groupArchives(httpFiles);
  const sets = [
    ...[...found].filter(link => link.startsWith('magnet:')).map(link => [link]),
    ...grouped.sets.map(set => set.map(file => file.link)),
  ];
  const target = normalizeName(gameName);
  const scored = sets.map(links => ({
    links,
    relevance: Math.max(...links.map(link => {
      const name = normalizeName(safeDecode(link.startsWith('magnet:') ? link : filenameFromUrl(link) ?? ''));
      return target ? longestCommonSubstring(target, name) / target.length : 1;
    })),
  }));

  // 磁力链接的文件名藏在 dn 参数里，取不到就不按相关度过滤
  const relevant = scored.filter(s => s.links[0].startsWith('magnet:') || s.relevance >= MIN_RELEVANCE ||
    (scored.length === 1 && grouped.incomplete.length === 0));
  relevant.sort((a, b) => b.relevance - a.relevance);
  return relevant.map(s => s.links);
}
