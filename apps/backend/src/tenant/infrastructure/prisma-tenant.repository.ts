import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared-kernel/infrastructure/prisma.service';
import { Tenant } from '../domain/tenant.entity';
import { TenantRepository } from '../domain/tenant.repository';

@Injectable()
export class PrismaTenantRepository implements TenantRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findBySlug(slug: string): Promise<Tenant | null> {
    const row = await this.prisma.tenant.findUnique({ where: { slug } });
    return row ? Tenant.rehydrate(row) : null;
  }

  async findById(id: string): Promise<Tenant | null> {
    const row = await this.prisma.tenant.findUnique({ where: { id } });
    return row ? Tenant.rehydrate(row) : null;
  }

  async findByAdminPathSegment(segment: string): Promise<Tenant | null> {
    const row = await this.prisma.tenant.findUnique({
      where: { adminPathSegment: segment },
    });
    return row ? Tenant.rehydrate(row) : null;
  }

  async listActive(): Promise<Tenant[]> {
    const rows = await this.prisma.tenant.findMany({ where: { isActive: true } });
    return rows.map(Tenant.rehydrate);
  }
}
