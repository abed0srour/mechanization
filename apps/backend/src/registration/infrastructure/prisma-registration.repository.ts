import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConflictError } from '../../shared-kernel/domain/errors';
import { PrismaService } from '../../shared-kernel/infrastructure/prisma.service';
import { PropertyEntry } from '../domain/property-entry.entity';
import { Registration, ReportStatus } from '../domain/registration.entity';
import {
  CitizenIdentityInput,
  PersistedRegistration,
  RegistrationRepository,
} from '../domain/registration.repository';

@Injectable()
export class PrismaRegistrationRepository implements RegistrationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async submit(input: {
    tenantId: string;
    citizen: CitizenIdentityInput;
    citizenReference: string;
    registrationReference: string;
    properties: PropertyEntry[];
  }): Promise<PersistedRegistration> {
    try {
      return await this.prisma.withTenant(input.tenantId, async (tx) => {
        /**
         * A returning citizen is matched on their identity document, not their
         * phone — households share phones, but not ID numbers.
         */
        const citizen = await tx.citizen.upsert({
          where: {
            tenantId_identityDocType_identityDocNumber: {
              tenantId: input.tenantId,
              identityDocType: input.citizen.identityDocType,
              identityDocNumber: input.citizen.identityDocNumber,
            },
          },
          create: {
            tenantId: input.tenantId,
            referenceNumber: input.citizenReference,
            ...input.citizen,
          },
          update: {
            phone: input.citizen.phone,
            whatsapp: input.citizen.whatsapp,
            familySize: input.citizen.familySize,
            residentStatus: input.citizen.residentStatus,
          },
        });

        const registration = await tx.registration.create({
          data: {
            tenantId: input.tenantId,
            citizenId: citizen.id,
            referenceNumber: input.registrationReference,
            status: 'PENDING',
          },
        });

        const propertyIds: string[] = [];
        for (const property of input.properties) {
          const created = await tx.propertyEntry.create({
            data: {
              tenantId: input.tenantId,
              registrationId: registration.id,
              occupancyType: property.props.occupancyType,
              landlordName: property.props.landlordName ?? null,
              landlordPhone: property.props.landlordPhone ?? null,
              propertyType: property.props.propertyType,
              propertyNumber: property.props.propertyNumber,
              unitType: property.props.unitType ?? null,
              landType: property.props.landType ?? null,
              buildingName: property.props.buildingName ?? null,
              floor: property.props.floor ?? null,
              side: property.props.side ?? null,
              tentLocation: property.props.tentLocation ?? null,
              unitArea: property.props.unitArea ?? null,
              sharedRights: property.props.sharedRights ?? [],
              latitude: property.props.latitude ?? null,
              longitude: property.props.longitude ?? null,
            },
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
      // P2002 = unique constraint. Inside this transaction it can only be the
      // per-tenant property number, so report it in the citizen's terms.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = (error.meta?.target as string[] | undefined)?.join(',') ?? '';
        if (target.includes('propertyNumber')) {
          throw new ConflictError('رقم العقار مسجّل مسبقاً في هذه البلدية');
        }
        throw new ConflictError('This record already exists');
      }
      throw error;
    }
  }

  async isPropertyNumberAvailable(tenantId: string, propertyNumber: string): Promise<boolean> {
    const existing = await this.prisma.propertyEntry.findUnique({
      where: { tenantId_propertyNumber: { tenantId, propertyNumber } },
      select: { id: true },
    });
    return existing === null;
  }

  async findById(tenantId: string, id: string): Promise<Registration | null> {
    const row = await this.prisma.registration.findFirst({ where: { id, tenantId } });
    if (!row) return null;
    return Registration.rehydrate({
      id: row.id,
      tenantId: row.tenantId,
      citizenId: row.citizenId,
      referenceNumber: row.referenceNumber,
      status: row.status as ReportStatus,
    });
  }

  async updateStatus(input: {
    tenantId: string;
    registrationId: string;
    status: ReportStatus;
    reason?: string;
    reviewedById: string;
  }): Promise<void> {
    await this.prisma.registration.updateMany({
      where: { id: input.registrationId, tenantId: input.tenantId },
      data: {
        status: input.status,
        rejectionReason: input.reason ?? null,
        reviewedById: input.reviewedById,
        reviewedAt: new Date(),
      },
    });
  }

  async listByCitizen(tenantId: string, citizenId: string) {
    return this.prisma.registration.findMany({
      where: { tenantId, citizenId },
      orderBy: { submittedAt: 'desc' },
      select: {
        id: true,
        referenceNumber: true,
        status: true,
        rejectionReason: true,
        submittedAt: true,
        properties: {
          select: {
            id: true,
            propertyNumber: true,
            propertyType: true,
            unitType: true,
            buildingName: true,
            occupancyType: true,
          },
        },
      },
    });
  }
}
