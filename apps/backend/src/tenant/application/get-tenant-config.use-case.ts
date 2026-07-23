import { Injectable } from '@nestjs/common';
import { ResolveTenantUseCase } from './resolve-tenant.use-case';

export interface PublicTenantConfig {
  slug: string;
  name: string;
  nameAr: string;
  logoUrl?: string;
  primaryColor?: string;
  enabledPropertyTypes?: string[];
  contactPhone?: string;
}

@Injectable()
export class GetTenantConfigUseCase {
  constructor(private readonly resolveTenant: ResolveTenantUseCase) {}

  /**
   * Public payload for the citizen wizard. Deliberately excludes
   * `adminPathSegment` — the hidden staff route must not be discoverable.
   */
  async execute(slug: string): Promise<PublicTenantConfig> {
    const tenant = await this.resolveTenant.bySlug(slug);
    return {
      slug: tenant.slug,
      name: tenant.name,
      nameAr: tenant.nameAr,
      logoUrl: tenant.config.logoUrl,
      primaryColor: tenant.config.primaryColor,
      enabledPropertyTypes: tenant.config.enabledPropertyTypes,
      contactPhone: tenant.config.contactPhone,
    };
  }
}
