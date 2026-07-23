import { Tenant } from './tenant.entity';

export const TENANT_REPOSITORY = Symbol('TENANT_REPOSITORY');

/** Port. Implemented in infrastructure; the application layer only sees this. */
export interface TenantRepository {
  findBySlug(slug: string): Promise<Tenant | null>;
  findById(id: string): Promise<Tenant | null>;
  findByAdminPathSegment(segment: string): Promise<Tenant | null>;
  listActive(): Promise<Tenant[]>;
}
