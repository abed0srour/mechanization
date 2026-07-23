import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared-kernel/infrastructure/prisma.service';
import {
  CitizenProfileRepository,
  CitizenProfileSummary,
} from '../domain/citizen-profile.repository';

@Injectable()
export class PrismaCitizenProfileRepository implements CitizenProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByPhone(tenantId: string, phone: string): Promise<CitizenProfileSummary[]> {
    const rows = await this.prisma.citizen.findMany({
      where: { tenantId, phone },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        identityDocNumber: true,
        referenceNumber: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      displayName: `${row.firstName} ${row.lastName}`,
      identityHint: maskDocument(row.identityDocNumber),
      referenceNumber: row.referenceNumber,
    }));
  }

  async findById(tenantId: string, citizenId: string): Promise<CitizenProfileSummary | null> {
    const row = await this.prisma.citizen.findFirst({
      where: { id: citizenId, tenantId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        identityDocNumber: true,
        referenceNumber: true,
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      displayName: `${row.firstName} ${row.lastName}`,
      identityHint: maskDocument(row.identityDocNumber),
      referenceNumber: row.referenceNumber,
    };
  }

  async linkSupabaseUser(
    tenantId: string,
    citizenId: string,
    supabaseUserId: string,
  ): Promise<void> {
    await this.prisma.citizen.updateMany({
      where: { id: citizenId, tenantId },
      data: { supabaseUserId },
    });
  }
}

/** Shows only the last two characters — enough to recognise, not to copy. */
function maskDocument(value: string): string {
  const tail = value.slice(-2);
  return `••••${tail}`;
}
