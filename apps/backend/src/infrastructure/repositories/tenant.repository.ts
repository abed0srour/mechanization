import { Injectable } from '@nestjs/common';
import { Tenant, TenantConfig } from '../../domain/entities/tenant.entity';
import { TenantRepository } from '../../domain/interfaces/tenant-repository.interface';
import { RegistryPrismaService } from '../prisma/registry-prisma.service';

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  nameAr: string;
  schemaName: string;
  adminPathSegment: string;
  referencePrefix: string;
  config: unknown;
  isActive: boolean;
  provisionedAt: Date | null;
};

/**
 * Reads the shared registry in `public`. This is the one repository that does
 * NOT go through the tenant context — it is what resolves the tenant in the
 * first place.
 */
@Injectable()
export class PrismaTenantRepository implements TenantRepository {
  constructor(private readonly registry: RegistryPrismaService) {}

  async findBySlug(slug: string): Promise<Tenant | null> {
    const row = await this.registry.tenant.findUnique({ where: { slug } });
    return row ? this.toDomain(row) : null;
  }

  async findById(id: string): Promise<Tenant | null> {
    const row = await this.registry.tenant.findUnique({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async listActive(): Promise<Tenant[]> {
    const rows = await this.registry.tenant.findMany({
      where: { isActive: true, provisionedAt: { not: null } },
      orderBy: { slug: 'asc' },
    });
    return rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: TenantRow): Tenant {
    return Tenant.rehydrate({
      id: row.id,
      slug: row.slug,
      name: row.name,
      nameAr: row.nameAr,
      schemaName: row.schemaName,
      adminPathSegment: row.adminPathSegment,
      referencePrefix: row.referencePrefix,
      config: (row.config as TenantConfig | null) ?? null,
      isActive: row.isActive,
      provisionedAt: row.provisionedAt,
    });
  }
}
