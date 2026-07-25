import { Inject, Injectable } from '@nestjs/common';
import { Tenant } from '../../../domain/entities/tenant.entity';
import { NotFoundError } from '../../../domain/errors/domain-error';
import { TENANT_REPOSITORY } from '../../../domain/interfaces/base-repository.interface';
import { TenantRepository } from '../../../domain/interfaces/tenant-repository.interface';

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
  ) {}

  /**
   * Resolves a slug to a municipality and refuses anything not fit to serve —
   * inactive, or registered but never provisioned.
   */
  async resolve(slug: string): Promise<Tenant> {
    const tenant = await this.tenants.findBySlug(slug.toLowerCase());
    if (!tenant) {
      throw new NotFoundError('Municipality', slug);
    }

    tenant.assertServable();
    tenant.assertSchemaNameConsistent();
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
