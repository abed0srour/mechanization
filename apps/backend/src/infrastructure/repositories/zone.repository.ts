import { Injectable } from '@nestjs/common';
import type {
  Zone,
  ZoneParcelOwner,
  ZoneRepository,
} from '../../domain/interfaces/zone-repository.interface';
import { TenantContextService } from '../context/tenant-context.service';

@Injectable()
export class PrismaZoneRepository implements ZoneRepository {
  constructor(private readonly tenantContext: TenantContextService) {}

  private get db() {
    return this.tenantContext.prisma;
  }

  async findAll(): Promise<Zone[]> {
    return this.db.zone.findMany({ orderBy: { code: 'asc' } });
  }

  async findById(id: string): Promise<Zone | null> {
    return this.db.zone.findUnique({ where: { id } });
  }

  async findByCode(code: string): Promise<Zone | null> {
    return this.db.zone.findUnique({ where: { code } });
  }

  /**
   * `hasSome` pushes the membership test into the GIN index on the array rather
   * than pulling every zone back to intersect in JS — the editor asks this on
   * each save with the full selection, which can be thousands of numbers.
   */
  async findOwnersOfParcels(
    parcelNumbers: readonly string[],
    excludeZoneId?: string,
  ): Promise<ZoneParcelOwner[]> {
    const wanted = [...new Set(parcelNumbers.map((n) => n.trim()).filter(Boolean))];
    if (wanted.length === 0) return [];

    const rows = await this.db.zone.findMany({
      where: {
        parcelNumbers: { hasSome: wanted },
        ...(excludeZoneId ? { id: { not: excludeZoneId } } : {}),
      },
      select: { id: true, name: true, parcelNumbers: true },
    });

    const claimed = new Set(wanted);
    const owners: ZoneParcelOwner[] = [];
    for (const row of rows) {
      for (const parcelNumber of row.parcelNumbers) {
        if (!claimed.has(parcelNumber)) continue;
        owners.push({ parcelNumber, zoneId: row.id, zoneName: row.name });
      }
    }
    return owners;
  }

  async create(input: {
    name: string;
    code: string;
    color: string;
    description?: string;
    parcelNumbers: string[];
  }): Promise<Zone> {
    return this.db.zone.create({
      data: {
        name: input.name,
        code: input.code,
        color: input.color,
        description: input.description ?? null,
        parcelNumbers: input.parcelNumbers,
      },
    });
  }

  async update(
    id: string,
    input: {
      name?: string;
      code?: string;
      color?: string;
      description?: string | null;
      parcelNumbers?: string[];
    },
  ): Promise<Zone> {
    return this.db.zone.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.parcelNumbers !== undefined ? { parcelNumbers: input.parcelNumbers } : {}),
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.zone.delete({ where: { id } });
  }
}
