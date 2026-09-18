import type { Candidate, Capabilities, SearchResult } from '../types/index.js';
import { longestCommonSubstring, looksLikeArchive, normalizeName } from '../utils/format.js';

/** 标签含义见主项目 README：NoReq 无门槛、Login 需登录、LoginPay 需付费、LoginRep 需回复…… */
const TAG_SCORES: Record<string, { score: number; reason: string }> = {
  NoReq: { score: 20, reason: '无门槛' },
  SuDrive: { score: 15, reason: '自建网盘' },
  NoSplDrive: { score: 10, reason: '不限速网盘' },
  SplDrive: { score: -10, reason: '限速网盘' },
  MixDrive: { score: -5, reason: '混合网盘' },
  BTmag: { score: -10, reason: 'BT/磁力' },
  Rep: { score: -30, reason: '需回复' },
  Login: { score: -40, reason: '需登录' },
  LoginRep: { score: -40, reason: '需登录回复' },
  LoginPay: { score: -60, reason: '需付费' },
  magic: { score: -15, reason: '需魔法' },
};

const RESOLVER_BONUS = 60;
const RELEVANCE_WEIGHT = 100;
const MOBILE_PORT_PENALTY = -30;
const CHINESE_BONUS = 5;
const ARCHIVE_HINT_BONUS = 10;

/** 自动模式下，名字和搜索词相关度低于这个值的候选不会被尝试（除非没有更好的） */
export const MIN_AUTO_RELEVANCE = 0.5;

const MOBILE_PORT = /kirikiroid|krkr|安卓|android|apk|ons\b|手机版|移动端/i;
const CHINESE_VERSION = /官中|汉化|中文|简中|繁中|生肉/;
const PAN_HOSTS = /pan\.baidu\.com|alipan\.com|aliyundrive\.com|pan\.quark\.cn|123pan\.com|123865\.com|lanzou|cloud\.189\.cn|drive\.uc\.cn/i;

export interface ScorerContext {
  hasDedicatedResolver: (url: string) => boolean;
  capabilities: Capabilities;
}

/**
 * 给每个搜索结果条目打分。分数只决定尝试顺序：先试最可能自动下成功、且最像用户要找的那个。
 */
export class ResourceScorer {
  constructor(private readonly context: ScorerContext) {}

  rank(results: SearchResult[], query: string): Candidate[] {
    const candidates: Candidate[] = [];
    for (const result of results) {
      for (const item of result.items) {
        if (!item?.url) continue;
        candidates.push(this.score(result, item.name ?? '', item.url, query));
      }
    }
    return candidates.sort((a, b) => b.score - a.score);
  }

  relevance(name: string, query: string): number {
    const target = normalizeName(query);
    const source = normalizeName(name);
    if (!target || !source) return 0;
    if (source.includes(target)) return 1;
    return longestCommonSubstring(target, source) / target.length;
  }

  private score(result: SearchResult, name: string, url: string, query: string): Candidate {
    const reasons: string[] = [];
    let score = 0;

    const relevance = this.relevance(name, query);
    score += Math.round(relevance * RELEVANCE_WEIGHT);
    if (relevance >= 1) reasons.push('名字完全匹配');
    else if (relevance >= MIN_AUTO_RELEVANCE) reasons.push('名字部分匹配');
    else reasons.push('名字不太相关');

    if (this.context.hasDedicatedResolver(url)) {
      score += RESOLVER_BONUS;
      reasons.push('可自动解析下载地址');
    } else if (PAN_HOSTS.test(url)) {
      score -= 50;
      reasons.push('第三方网盘需手动转存');
    }

    for (const tag of result.tags ?? []) {
      const entry = TAG_SCORES[tag];
      if (!entry) continue;
      score += entry.score;
      reasons.push(entry.reason);
      if (tag === 'BTmag' && !this.context.capabilities.aria2c) {
        score -= 40;
        reasons.push('缺少 aria2c 无法下 BT');
      }
    }

    if (MOBILE_PORT.test(name) && !MOBILE_PORT.test(query)) {
      score += MOBILE_PORT_PENALTY;
      reasons.push('疑似手机移植版');
    }
    if (CHINESE_VERSION.test(name)) {
      score += CHINESE_BONUS;
      reasons.push('中文版');
    }
    if (looksLikeArchive(url)) {
      score += ARCHIVE_HINT_BONUS;
      reasons.push('链接指向压缩包');
    }

    return {
      platform: result.name,
      platformTags: result.tags ?? [],
      name,
      url,
      score,
      reasons,
    };
  }
}
