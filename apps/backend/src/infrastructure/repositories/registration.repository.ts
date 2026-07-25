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
        citizen: { select: { firstName: true, lastName: true } },
        _count: { select: { properties: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });

    return rows.map((row) => ({
      id: row.id,
      referenceNumber: row.referenceNumber,
      status: row.status as ReportStatus,
      submittedAt: row.submittedAt,
      citizenName: `${row.citizen.firstName} ${row.citizen.lastName}`,
      propertyCount: row._count.properties,
    }));
  }

  async listForReview(filter: {
    status?: ReportStatus;
    limit: number;
    offset: number;
  }): Promise<{ items: RegistrationListItem[]; total: number }> {
    const where = filter.status ? { status: filter.status as never } : {};

    const [rows, total] = await Promise.all([
      this.db.registration.findMany({
        where,
        include: {
          citizen: { select: { firstName: true, lastName: true } },
          _count: { select: { properties: true } },
        },
        orderBy: { submittedAt: 'desc' },
        take: filter.limit,
        skip: filter.offset,
      }),
      this.db.registration.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        referenceNumber: row.referenceNumber,
        status: row.status as ReportStatus,
        submittedAt: row.submittedAt,
        citizenName: `${row.citizen.firstName} ${row.citizen.lastName}`,
        propertyCount: row._count.properties,
      })),
      total,
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
   * Straight indexed lookup on a unique column. v1 put a 10-second Redis cache
   * in front of this; it is a single-row index probe on a table of thousands,
   * and the cache was more moving parts than the query it accelerated.
   */
  async isPropertyNumberAvailable(propertyNumber: string): Promise<boolean> {
    const existing = await this.db.propertyEntry.findUnique({
      where: { propertyNumber: propertyNumber.trim() },
      select: { id: true },
    });
    return existing === null;
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

      if (target.includes('propertyNumber')) {
        return new ConflictError('رقم العقار مسجّل مسبقاً');
      }
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
