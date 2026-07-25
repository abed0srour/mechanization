import { Injectable } from '@nestjs/common';
import {
  ParcelLocation,
  ParcelRepository,
} from '../../domain/interfaces/parcel-repository.interface';
import { TenantContextService } from '../context/tenant-context.service';

@Injectable()
export class PrismaParcelRepository implements ParcelRepository {
  constructor(private readonly tenantContext: TenantContextService) {}

  private get db() {
    return this.tenantContext.prisma;
  }

  async count(): Promise<number> {
    return this.db.parcel.count();
  }

  async findByNumber(parcelNumber: string): Promise<ParcelLocation | null> {
    const row = await this.db.parcel.findUnique({
      where: { parcelNumber: parcelNumber.trim() },
    });
    return row ? toLocation(row) : null;
  }

  async findManyByNumber(
    parcelNumbers: readonly string[],
  ): Promise<Map<string, ParcelLocation>> {
    const wanted = [...new Set(parcelNumbers.map((n) => n.trim()).filter(Boolean))];
    if (wanted.length === 0) return new Map();

    const rows = await this.db.parcel.findMany({ where: { parcelNumber: { in: wanted } } });
    return new Map(rows.map((row) => [row.parcelNumber, toLocation(row)]));
  }

  /**
   * Nearest real parcel numbers, ordered by numeric distance rather than by
   * prefix.
   *
   * Prefix matching answers the wrong question here. This runs only after a
   * number failed to resolve, and the failures that matter are transposed or
   * fat-fingered digits — someone who types 1934 meant 1933, and no parcel
   * begins with "1934" to offer them. Distance surfaces the neighbours; a
   * prefix search surfaces nothing at all.
   *
   * Non-digits are stripped first so "15x" still anchors on 15.
   */
  async suggest(input: string, limit: number): Promise<string[]> {
    const digits = input.replace(/\D/g, '');
    if (!digits) return [];

    // Parcel numbers top out in the low thousands; the clamp keeps a pasted
    // 40-character string from overflowing the bigint cast below.
    const anchor = Number(digits.slice(0, 9));

    const rows = await this.db.$queryRawUnsafe<Array<{ parcelNumber: string }>>(
      `SELECT "parcelNumber" FROM "parcels"
        WHERE "parcelNumber" ~ '^[0-9]+$'
        ORDER BY abs("parcelNumber"::bigint - $1::bigint), "parcelNumber"::bigint
        LIMIT $2`,
      anchor,
      limit,
    );

    return rows.map((row) => row.parcelNumber);
  }
}

function toLocation(row: {
  parcelNumber: string;
  latitude: number;
  longitude: number;
  pointCount: number;
}): ParcelLocation {
  return {
    parcelNumber: row.parcelNumber,
    latitude: row.latitude,
    longitude: row.longitude,
    approximate: row.pointCount > 1,
  };
}
