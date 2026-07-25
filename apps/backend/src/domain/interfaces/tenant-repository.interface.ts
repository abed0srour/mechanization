import { Tenant } from '../entities/tenant.entity';

export interface TenantRepository {
  /** Resolves the URL slug against the shared registry. */
  findBySlug(slug: string): Promise<Tenant | null>;
  findById(id: string): Promise<Tenant | null>;
  listActive(): Promise<Tenant[]>;
}
