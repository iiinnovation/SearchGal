// ---- SearchGal API 返回的数据（与主项目 src/types.ts 中的 StreamResult 保持一致）----

export interface SearchResultItem {
  name: string;
  url: string;
  tags?: string[];
}

export interface SearchResult {
  name: string;      // 平台名称
  color: string;
  tags: string[];
  items: SearchResultItem[];
  error?: string;    // 平台搜索出错时服务端会带上错误信息（items 为空）
}

export interface SearchOutcome {
  results: SearchResult[];   // 有资源的平台
  errors: SearchResult[];    // 搜索出错的平台
  total?: number;            // 服务端参与搜索的平台总数
}

// ---- 候选资源：搜索结果中的单个条目 + 评分 ----

export interface Candidate {
  platform: string;
  platformTags: string[];
  name: string;
  url: string;          // 搜索结果给出的链接（几乎总是网页，而不是文件）
  score: number;
  reasons: string[];
}

// ---- 解析结果：真正可以交给下载器的目标 ----

export type DownloadKind = 'http' | 'magnet';

export interface ResolvedDownload {
  kind: DownloadKind;
  url: string;
  filename?: string;
  size?: number;                     // 字节；未知则为 undefined
  headers?: Record<string, string>;  // 下载时需要附带的请求头（Referer 等）
  note?: string;                     // 展示给用户的补充说明
}

/** 一次下载方案：里面的文件必须全部成功（分卷压缩包） */
export interface DownloadPlan {
  files: ResolvedDownload[];
  password?: string;  // 从页面提取的解压密码（若有）
  note?: string;      // 方案提示信息
}

/** LLM 密码检测判定结果 */
export interface ArchivePasswordAssessment {
  canExtractWithoutExtraPassword: boolean;
  hasPassword: boolean;
  extractedPassword?: string;
  riskType: 'none' | 'need_contact' | 'need_payment' | 'incomplete' | 'unknown';
  reason: string;
}

export interface PasswordAssessor {
  assessPassword(html: string, gameName: string, signal?: AbortSignal): Promise<ArchivePasswordAssessment>;
}

/**
 * 把搜索结果页解析成可下载方案。返回的多个方案是备选关系，按顺序尝试；
 * 解析不出任何东西（需要登录、网盘转存等）就返回空数组。
 */
export interface Resolver {
  name: string;
  canResolve(url: string): boolean;
  resolve(candidate: Candidate, context?: ResolutionContext): Promise<DownloadPlan[]>;
}

export interface ResolutionContext {
  signal?: AbortSignal;
  assessor?: PasswordAssessor;
  enablePasswordCheck?: boolean;
  passwordCheckFailureMode?: 'continue' | 'skip';
  onPasswordAssessment?: (assessment: ArchivePasswordAssessment) => void;
}

// ---- 下载工具 ----

export interface DownloadOptions {
  outputDir: string;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
  quiet?: boolean;
  recordVerification?: boolean;
}

/** 收到的文件字节进度；完成仍以下载结果中的完整性校验为准。 */
export interface DownloadProgress {
  receivedBytes: number;
  totalBytes?: number;
  bytesPerSecond: number;
  etaSeconds?: number;
}

export interface DownloadResult {
  success: boolean;
  filepath?: string;
  error?: string;
  verification?: { url: string; etag: string; size: number };
  /** 为 true 表示这条链接无法自动下载，error 中是给用户的手动操作提示 */
  manual?: boolean;
}

export interface DownloadTool {
  name: string;
  description: string;
  canHandle(target: ResolvedDownload): boolean;
  download(target: ResolvedDownload, options: DownloadOptions): Promise<DownloadResult>;
}

/** 当前机器上可用的外部程序，用于评分和选择下载方式 */
export interface Capabilities {
  aria2c: boolean;
}
