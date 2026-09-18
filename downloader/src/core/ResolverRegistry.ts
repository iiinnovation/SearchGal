import type { Resolver } from '../types/index.js';
import { AlistResolver } from '../resolvers/AlistResolver.js';
import { ShinnkuResolver } from '../resolvers/ShinnkuResolver.js';
import { GGBasesResolver } from '../resolvers/GGBasesResolver.js';
import { GenericResolver } from '../resolvers/GenericResolver.js';

/**
 * 解析器注册表。专用解析器排在前面，GenericResolver 兜底。
 */
export class ResolverRegistry {
  private readonly resolvers: Resolver[] = [];
  private readonly fallback: Resolver;

  constructor() {
    this.resolvers.push(new ShinnkuResolver(), new AlistResolver(), new GGBasesResolver());
    this.fallback = new GenericResolver();
  }

  register(resolver: Resolver): void {
    this.resolvers.push(resolver);
  }

  /** 有专门解析器的链接，自动下载成功率高得多，评分时会优先 */
  hasDedicated(url: string): boolean {
    return this.resolvers.some(r => r.canResolve(url));
  }

  find(url: string): Resolver | undefined {
    return this.resolvers.find(r => r.canResolve(url)) ?? (this.fallback.canResolve(url) ? this.fallback : undefined);
  }

  getAll(): Resolver[] {
    return [...this.resolvers, this.fallback];
  }
}
