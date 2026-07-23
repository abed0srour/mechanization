import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { NotFoundError } from '../../shared-kernel/domain/errors';
import { TenantContextService } from '../../shared-kernel/infrastructure/tenant-context.service';
import { ResolveTenantUseCase } from '../application/resolve-tenant.use-case';

declare module 'express-serve-static-core' {
  interface Request {
    tenant?: { id: string; slug: string };
  }
}

/**
 * Resolves `/api/v1/t/:tenantSlug/...` into a tenant and opens an
 * AsyncLocalStorage scope for the rest of the request. Everything downstream —
 * guards, use-cases, repositories — reads the tenant from that scope, so no
 * handler can accidentally act on a tenant supplied in a request body.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly resolveTenant: ResolveTenantUseCase,
    private readonly tenantContext: TenantContextService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const slug = this.extractSlug(req);
    if (!slug) {
      next(new NotFoundError('Municipality'));
      return;
    }

    try {
      const tenant = await this.resolveTenant.bySlug(slug);
      req.tenant = { id: tenant.id, slug: tenant.slug };
      this.tenantContext.run({ tenantId: tenant.id, tenantSlug: tenant.slug }, () => next());
    } catch (error) {
      next(error);
    }
  }

  private extractSlug(req: Request): string | undefined {
    const fromParams = (req.params as Record<string, string | undefined>)?.tenantSlug;
    if (fromParams) return fromParams;

    // Params are not populated for middleware mounted by path pattern, so fall
    // back to reading the segment straight out of the URL.
    const match = req.baseUrl.concat(req.path).match(/\/t\/([a-z0-9][a-z0-9-]*)/i);
    return match?.[1]?.toLowerCase();
  }
}
