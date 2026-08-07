import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/tenant-client';
import { PropertyEntry } from '../../domain/entities/property-entry.entity';
import { Registration } from '../../domain/entities/registration.entity';
import { ConflictError } from '../../domain/errors/domain-error';
import {
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
            // `status` is no longer written. The column still exists with its
            // PENDING default, unread by anything — see the note on
            // `Registration`. Dropping it is a separate migration across every
            // tenant schema.
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

  /** Rehydrates the aggregate, properties and their units included. */
  async findById(id: string): Promise<Registration | null> {
    const row = await this.db.registration.findUnique({
      where: { id },
      include: { properties: { include: { units: true } } },
    });
    return row ? this.toDomain(row) : null;
  }

  /**
   * How many people have already registered this parcel.
   *
   * Reported to the entry form as context ("three neighbours are already
   * registered here") rather than used to refuse the write — a building is one
   * cadastral number shared by everyone inside it.
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
    properties?: Array<Record<string, unknown>>;
  }): Registration {
    return Registration.rehydrate({
      id: row.id,
      citizenId: row.citizenId,
      referenceNumber: row.referenceNumber,
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

