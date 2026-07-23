import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '../../shared-kernel/domain/errors';
import { Tenant } from '../domain/tenant.entity';
import { TENANT_REPOSITORY, TenantRepository } from '../domain/tenant.repository';

@Injectable()
export class ResolveTenantUseCase {
  private readonly cache = new Map<string, { tenant: Tenant; expiresAt: number }>();
  private readonly ttlMs = 60_000;

  constructor(@Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository) {}

  /**
   * Called on every request, so it is cached briefly. One minute is short
   * enough that deactivating a municipality takes effect quickly.
   */
  async bySlug(slug: string): Promise<Tenant> {
    const cached = this.cache.get(slug);
    if (cached && cached.expiresAt > Date.now()) return cached.tenant;

    const tenant = await this.tenants.findBySlug(slug);
    if (!tenant || !tenant.isActive) throw new NotFoundError('Municipality', slug);

    this.cache.set(slug, { tenant, expiresAt: Date.now() + this.ttlMs });
    return tenant;
  }

  invalidate(slug: string): void {
    this.cache.delete(slug);
  }
}
