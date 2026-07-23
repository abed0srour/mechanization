import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
}

/**
 * Carries the resolved municipality through the whole request without threading
 * it manually. Repositories read from here, so a query written without tenant
 * scoping fails loudly instead of silently reading another municipality's rows.
 */
@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantContext>();

  run<T>(context: TenantContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  /** Returns undefined on platform-level routes that legitimately have no tenant. */
  peek(): TenantContext | undefined {
    return this.storage.getStore();
  }

  require(): TenantContext {
    const ctx = this.storage.getStore();
    if (!ctx) {
      throw new Error(
        'Tenant context is missing. This route must run behind TenantMiddleware.',
      );
    }
    return ctx;
  }

  get tenantId(): string {
    return this.require().tenantId;
  }
}
