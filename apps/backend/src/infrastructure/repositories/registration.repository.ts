import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/tenant-client';
import { PropertyEntry } from '../../domain/entities/property-entry.entity';
import { Registration, ReportStatus } from '../../domain/entities/registration.entity';
import { ConflictError } from '../../domain/errors/domain-error';
import {
  RegistrationListItem,
  RegistrationRepository,
  SubmitRegistrationInput,
  SubmitRegistrationResult,
} from '../../domain/interfaces/registration-repository.interface';
import { TenantContextService } from '../context/tenant-context.service';
import { withConnectionRetry } from '../prisma/with-connection-retry';

@Injectable()
export class PrismaRegistrationRepository implements RegistrationRepository {
  constructor(private readonly tenantContext: TenantContextService) {}

  private get db() {
    return this.tenantContext.prisma;
  }

  /**
   * Citizen upsert + registration + every property row in one transaction.
   *
   * A partial write is worse than a clean failure here: the citizen sees an
   * error, retries the whole wizard, and collides with the property rows their
   * "failed" attempt already committed — leaving them unable to file at all.
   */
  async submit(input: SubmitRegistrationInput): Promise<SubmitRegistrationResult> {
    const tenantSlug = this.tenantContext.tenantSlug;

    try {
      return await this.db.$transaction(async (tx) => {
        const citizen = await tx.user.upsert({
          where: {
            identityDocType_identityDocNumber: {
              identityDocType: input.citizen.identityDocType as never,
              identityDocNumber: input.citizen.identityDocNumber,
            },
          },
          update: {
            phone: input.citizen.phone,
            whatsapp: input.citizen.whatsapp ?? input.citizen.phone,
            firstName: input.citizen.firstName,
            middleName: input.citizen.middleName ?? null,
            lastName: input.citizen.lastName,
            gender: input.citizen.gender as never,
            nationality: input.citizen.nationality,
            isLebanese: input.citizen.isLebanese,
            residencyNumber: input.citizen.residencyNumber ?? null,
            residentStatus: input.citizen.residentStatus as never,
            civilRecordNumber: input.citizen.civilRecordNumber,
            familySize: input.citizen.familySize,
            maritalStatus: input.citizen.maritalStatus as never,
          },
          create: {
            kind: 'CITIZEN',
            tenantSlug,
            phone: input.citizen.phone,
            whatsapp: input.citizen.whatsapp ?? input.citizen.phone,
            firstName: input.citizen.firstName,
            middleName: input.citizen.middleName ?? null,
            lastName: input.citizen.lastName,
            gender: input.citizen.gender as never,
            nationality: input.citizen.nationality,
            isLebanese: input.citizen.isLebanese,
            residencyNumber: input.citizen.residencyNumber ?? null,
            residentStatus: input.citizen.residentStatus as never,
            identityDocType: input.citizen.identityDocType as never,
            identityDocNumber: input.citizen.identityDocNumber,
            civilRecordNumber: input.citizen.civilRecordNumber,
            familySize: input.citizen.familySize,
            maritalStatus: input.citizen.maritalStatus as never,
            referenceNumber: input.citizenReference,
          },
          select: { id: true },
        });

        const registration = await tx.registration.create({
          data: {
            citizenId: citizen.id,
            referenceNumber: input.registrationReference,
            status: 'PENDING',
          },
          select: { id: true, referenceNumber: true },
        });

        const propertyIds: string[] = [];
        for (const property of input.properties) {
          const p = property.props;
          const created = await tx.propertyEntry.create({
            data: {
              registrationId: registration.id,
              occupancyType: p.occupancyType as never,
              landlordName: p.landlordName ?? null,
              landlordPhone: p.landlordPhone ?? null,
              propertyType: p.propertyType as never,
              neighborhood: p.neighborhood,
              propertyNumber: p.propertyNumber,
              unitType: (p.unitType ?? null) as never,
              landType: (p.landType ?? null) as never,
              buildingName: p.buildingName ?? null,
              floor: p.floor ?? null,
              side: p.side ?? null,
              tentLocation: p.tentLocation ?? null,
              unitArea: p.unitArea ?? null,
              sharedRights: p.sharedRights ?? [],
              latitude: p.latitude ?? null,
              longitude: p.longitude ?? null,
              // A building carries its units here rather than in the columns
              // above — one parcel, one رقم العقار, many apartments.
              units: {
                create: (p.units ?? []).map((unit) => ({
                  unitType: unit.unitType as never,
                  floor: unit.floor,
                  side: unit.side ?? null,
                  unitArea: unit.unitArea,
                  sharedRights: unit.sharedRights ?? [],
                })),
              },
            },
            select: { id: true },
          });
          propertyIds.push(created.id);
        }

        return {
          registrationId: registration.id,
          citizenId: citizen.id,
          referenceNumber: registration.referenceNumber,
          propertyIds,
        };
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  async findById(id: string): Promise<Registration | null> {
    const row = await this.db.registration.findUnique({
      where: { id },
      include: { properties: { include: { units: true } } },
    });
    return row ? this.toDomain(row) : null;
  }

  async findByReferenceNumber(reference: string): Promise<Registration | null> {
    const row = await this.db.registration.findUnique({
      where: { referenceNumber: reference },
      include: { properties: { include: { units: true } } },
    });
    return row ? this.toDomain(row) : null;
  }

  async listByCitizen(citizenId: string): Promise<RegistrationListItem[]> {
    const rows = await this.db.registration.findMany({
      where: { citizenId },
      include: {
        citizen: { select: { id: true, firstName: true, lastName: true } },
        properties: { select: { neighborhood: true } },
        _count: { select: { properties: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });

    return rows.map((row) => ({
      id: row.id,
      referenceNumber: row.referenceNumber,
      status: row.status as ReportStatus,
      submittedAt: row.submittedAt,
      citizenId: row.citizen.id,
      citizenName: `${row.citizen.firstName} ${row.citizen.lastName}`,
      propertyCount: row._count.properties,
      neighborhoods: distinctNeighborhoods(row.properties),
    }));
  }

  /**
   * One round trip via a window function rather than the `findMany` +
   * `count` pair this used to be: `count(*) OVER()` computes the filtered
   * total across the whole result set before `LIMIT` is applied, in the same
   * query as the page of rows. Two queries meant two connections briefly
   * competing for the same tenant schema's pool — with `connection_limit=1`
   * on the Supabase pooler, that competition is exactly what surfaced as
   * "Timed out fetching a new connection from the pool" under any concurrent
   * request.
   */
  async listForReview(filter: {
    status?: ReportStatus;
    limit: number;
    offset: number;
  }): Promise<{ items: RegistrationListItem[]; total: number }> {
    const statusFilter = filter.status
      ? Prisma.sql`WHERE r.status = ${filter.status}::"ReportStatus"`
      : Prisma.empty;

    const rows = await withConnectionRetry(() =>
      this.db.$queryRaw<
        Array<{
          id: string;
          referenceNumber: string;
          status: string;
          submittedAt: Date;
          citizenId: string;
          citizenName: string;
          propertyCount: number;
          neighborhoods: string[];
          total: number;
        }>
      >`
        SELECT
          r.id,
          r."referenceNumber",
          r.status,
          r."submittedAt",
          r."citizenId",
          u."firstName" || ' ' || u."lastName" AS "citizenName",
          (SELECT count(*)::int FROM property_entries pe WHERE pe."registrationId" = r.id) AS "propertyCount",
          COALESCE(
            (SELECT array_agg(DISTINCT pe.neighborhood) FROM property_entries pe WHERE pe."registrationId" = r.id),
            ARRAY[]::text[]
          ) AS neighborhoods,
          count(*) OVER()::int AS total
        FROM registrations r
        JOIN users u ON u.id = r."citizenId"
        ${statusFilter}
        ORDER BY r."submittedAt" DESC
        LIMIT ${filter.limit} OFFSET ${filter.offset}
      `,
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        referenceNumber: row.referenceNumber,
        status: row.status as ReportStatus,
        submittedAt: row.submittedAt,
        citizenId: row.citizenId,
        citizenName: row.citizenName,
        propertyCount: row.propertyCount,
        neighborhoods: row.neighborhoods,
      })),
      total: rows[0]?.total ?? 0,
    };
  }

  async persistStatusChange(input: {
    registrationId: string;
    status: ReportStatus;
    reason?: string;
    reviewedById: string;
  }): Promise<void> {
    await this.db.registration.update({
      where: { id: input.registrationId },
      data: {
        status: input.status as never,
        rejectionReason: input.reason ?? null,
        reviewedById: input.reviewedById,
        reviewedAt: new Date(),
      },
    });
  }

  /**
   * How many people have already registered this parcel.
   *
   * This used to answer "is the number free", gating the submission. It no
   * longer gates anything — a building is one cadastral number shared by
   * everyone inside it — so the count is reported to the citizen as context
   * ("three neighbours are already registered here") rather than used to
   * refuse the write.
   *
   * Straight indexed count. v1 put a 10-second Redis cache in front of the
   * old version of this; it is an index scan on a table of thousands, and the
   * cache was more moving parts than the query it accelerated.
   */
  async countRegistrationsForParcel(propertyNumber: string): Promise<number> {
    return this.db.propertyEntry.count({
      where: { propertyNumber: propertyNumber.trim() },
    });
  }

  private toDomain(row: {
    id: string;
    citizenId: string;
    referenceNumber: string;
    status: string;
    properties?: Array<Record<string, unknown>>;
  }): Registration {
    return Registration.rehydrate({
      id: row.id,
      citizenId: row.citizenId,
      referenceNumber: row.referenceNumber,
      status: row.status as ReportStatus,
      properties: (row.properties ?? []).map((p) =>
        PropertyEntry.rehydrate({
          occupancyType: p.occupancyType as never,
          landlordName: p.landlordName as string | null,
          landlordPhone: p.landlordPhone as string | null,
          propertyType: p.propertyType as never,
          neighborhood: p.neighborhood as string,
          propertyNumber: p.propertyNumber as string,
          unitType: p.unitType as never,
          landType: p.landType as never,
          buildingName: p.buildingName as string | null,
          floor: p.floor as string | null,
          side: p.side as string | null,
          tentLocation: p.tentLocation as string | null,
          unitArea: p.unitArea == null ? null : Number(p.unitArea),
          sharedRights: (p.sharedRights as string[]) ?? [],
          units: ((p.units as Array<Record<string, unknown>>) ?? []).map((unit) => ({
            unitType: unit.unitType as never,
            floor: unit.floor as string,
            side: unit.side as string | null,
            unitArea: Number(unit.unitArea),
            sharedRights: (unit.sharedRights as string[]) ?? [],
          })),
          latitude: p.latitude as number | null,
          longitude: p.longitude as number | null,
        }),
      ),
    });
  }

  /**
   * The one place a Prisma error code becomes a domain error. Above this line
   * nothing knows what P2002 is.
   */
  private translate(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? '';

      // No propertyNumber branch: that column is deliberately not unique any
      // more (see migration 0004), so a P2002 naming it would mean the index
      // came back — worth surfacing as the generic conflict rather than as a
      // reassuring message that hides a schema drift.
      if (target.includes('identityDocNumber')) {
        return new ConflictError('هذه الوثيقة مسجّلة مسبقاً لشخص آخر');
      }
      if (target.includes('referenceNumber')) {
        return new ConflictError('تعذّر إنشاء رقم مرجعي فريد — يرجى المحاولة مرة أخرى');
      }
      return new ConflictError('هذه البيانات مسجّلة مسبقاً');
    }
    return error;
  }
}

/**
 * A registration is usually one property, but a landlord filing several at
 * once can span more than one حي — deduping rather than just taking the first
 * is what keeps the dashboard row honest about that instead of silently
 * showing only part of the claim.
 */
function distinctNeighborhoods(properties: Array<{ neighborhood: string }>): string[] {
  return [...new Set(properties.map((p) => p.neighborhood))];
}
