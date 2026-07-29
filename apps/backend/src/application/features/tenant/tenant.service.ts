import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Tenant, TenantProps } from '../../../domain/entities/tenant.entity';
import { NotFoundError } from '../../../domain/errors/domain-error';
import { TENANT_REPOSITORY } from '../../../domain/interfaces/base-repository.interface';
import { TenantRepository } from '../../../domain/interfaces/tenant-repository.interface';
import { RedisCacheService } from '../../../infrastructure/cache/redis-cache.service';

export interface PublicTenantConfig {
  slug: string;
  name: string;
  nameAr: string;
  enabledPropertyTypes: string[];
  requiredDocuments: string[];
  branding: { logoUrl?: string; primaryColor?: string; accentColor?: string };
  supportPhone?: string;
}

@Injectable()
export class TenantService {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    private readonly cache: RedisCacheService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Resolves a slug to a municipality and refuses anything not fit to serve —
   * inactive, or registered but never provisioned.
   *
   * Cached: `TenantMiddleware` calls this on every tenant-scoped request,
   * before anything else runs, against a table that only changes at
   * onboarding time — so an uncached lookup here taxes every single request
   * with a round trip to the registry (hosted on Supabase) for data that is,
   * for practical purposes, static. `RedisCacheService` degrades to a no-op
   * when `REDIS_URL` is unset, so this is additive, same as the dashboard
   * cache. A newly onboarded tenant is never stale — a not-found slug is
   * never cached, so the first request after provisioning is always a live
   * lookup. A tenant deactivated mid-window stays servable for up to
   * `TENANT_CACHE_TTL_SECONDS`, which is the accepted trade for taking this
   * off the hot path; that operation is rare and deliberate, not something
   * that needs to take effect within milliseconds.
   */
  async resolve(slug: string): Promise<Tenant> {
    const normalizedSlug = slug.toLowerCase();
    const key = `tenant:resolve:${normalizedSlug}`;

    const cached = await this.cache.get<TenantProps>(key);
    const tenant = cached ? this.rehydrate(cached) : await this.fetchAndCache(normalizedSlug, key);

    tenant.assertServable();
    tenant.assertSchemaNameConsistent();
    return tenant;
  }

  private rehydrate(props: TenantProps): Tenant {
    // JSON round-tripped through Redis, so provisionedAt comes back as a
    // string rather than a Date.
    return Tenant.rehydrate({
      ...props,
      provisionedAt: props.provisionedAt ? new Date(props.provisionedAt) : null,
    });
  }

  private async fetchAndCache(slug: string, key: string): Promise<Tenant> {
    const tenant = await this.tenants.findBySlug(slug);
    if (!tenant) {
      throw new NotFoundError('Municipality', slug);
    }

    const ttl = this.config.get<number>('TENANT_CACHE_TTL_SECONDS') ?? 300;
    await this.cache.set(key, tenant.toProps(), ttl);
    return tenant;
  }

  /**
   * What the public wizard is allowed to know. Deliberately excludes
   * `adminPathSegment` and `schemaName`: this endpoint is unauthenticated, and
   * handing out the admin URL would remove what little the obscure path buys.
   */
  async getPublicConfig(slug: string): Promise<PublicTenantConfig> {
    const tenant = await this.resolve(slug);
    const config = tenant.config;

    return {
      slug: tenant.slug,
      name: tenant.name,
      nameAr: tenant.nameAr,
      enabledPropertyTypes: config.enabledPropertyTypes ?? ['BUILDING', 'HOUSE', 'LAND', 'TENT'],
      requiredDocuments: config.requiredDocuments ?? ['IDENTITY'],
      branding: config.branding ?? {},
      supportPhone: config.supportPhone,
    };
  }

  /** Staff-only: includes the admin path so the dashboard can build links. */
  async getAdminConfig(slug: string): Promise<PublicTenantConfig & { adminPathSegment: string }> {
    const tenant = await this.resolve(slug);
    const publicConfig = await this.getPublicConfig(slug);
    return { ...publicConfig, adminPathSegment: tenant.adminPathSegment };
  }
}
