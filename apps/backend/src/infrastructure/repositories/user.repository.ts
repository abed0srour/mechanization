import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/tenant-client';
import { StaffRole, User } from '../../domain/entities/user.entity';
import { ConflictError } from '../../domain/errors/domain-error';
import {
  CitizenChoice,
  CitizenIdentityInput,
  UserRepository,
} from '../../domain/interfaces/user-repository.interface';
import { TenantContextService } from '../context/tenant-context.service';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly tenantContext: TenantContextService) {}

  private get db() {
    return this.tenantContext.prisma;
  }

  async findStaffByEmail(email: string): Promise<User | null> {
    const row = await this.db.user.findFirst({
      where: { email: email.toLowerCase(), kind: 'STAFF' },
    });
    if (!row) return null;

    return User.staff({
      id: row.id,
      tenantSlug: row.tenantSlug,
      email: row.email!,
      passwordHash: row.passwordHash!,
      role: row.role as StaffRole,
      firstName: row.firstName,
      lastName: row.lastName,
      isActive: row.isActive,
      totpSecret: row.totpSecret,
      totpConfirmedAt: row.totpConfirmedAt,
    });
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.db.user.findUnique({ where: { id } });
    if (!row) return null;

    if (row.kind === 'STAFF') {
      return User.staff({
        id: row.id,
        tenantSlug: row.tenantSlug,
        email: row.email!,
        passwordHash: row.passwordHash!,
        role: row.role as StaffRole,
        firstName: row.firstName,
        lastName: row.lastName,
        isActive: row.isActive,
        totpSecret: row.totpSecret,
        totpConfirmedAt: row.totpConfirmedAt,
      });
    }

    return User.citizen({
      id: row.id,
      tenantSlug: row.tenantSlug,
      phone: row.phone!,
      whatsapp: row.whatsapp,
      firstName: row.firstName,
      middleName: row.middleName,
      lastName: row.lastName,
      referenceNumber: row.referenceNumber!,
      identityDocType: row.identityDocType!,
      identityDocNumber: row.identityDocNumber!,
      isActive: row.isActive,
    });
  }

  /**
   * A household commonly shares one phone. Returning the minimum needed to tell
   * two family members apart — and only the last two digits of the document
   * number — keeps the disambiguation screen from becoming a way to enumerate a
   * household's ID numbers with a phone you happen to hold.
   */
  async findCitizensByPhone(phone: string): Promise<CitizenChoice[]> {
    const rows = await this.db.user.findMany({
      where: { kind: 'CITIZEN', phone, isActive: true },
      select: { id: true, firstName: true, lastName: true, identityDocNumber: true },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      displayName: `${row.firstName} ${row.lastName}`,
      identityDocLastDigits: (row.identityDocNumber ?? '').slice(-2).padStart(2, '•'),
    }));
  }

  /**
   * Keyed on the identity document rather than the phone: re-submitting from a
   * relative's phone must update the same person, not create a second record.
   */
  async upsertCitizen(input: CitizenIdentityInput, referenceNumber: string): Promise<string> {
    try {
      const row = await this.db.user.upsert({
        where: {
          identityDocType_identityDocNumber: {
            identityDocType: input.identityDocType as never,
            identityDocNumber: input.identityDocNumber,
          },
        },
        update: {
          phone: input.phone,
          whatsapp: input.whatsapp ?? input.phone,
          firstName: input.firstName,
          middleName: input.middleName ?? null,
          lastName: input.lastName,
          gender: input.gender as never,
          nationality: input.nationality,
          isLebanese: input.isLebanese,
          residencyNumber: input.residencyNumber ?? null,
          residentStatus: input.residentStatus as never,
          civilRecordNumber: input.civilRecordNumber,
          familySize: input.familySize,
        },
        create: {
          kind: 'CITIZEN',
          tenantSlug: this.tenantContext.tenantSlug,
          phone: input.phone,
          whatsapp: input.whatsapp ?? input.phone,
          firstName: input.firstName,
          middleName: input.middleName ?? null,
          lastName: input.lastName,
          gender: input.gender as never,
          nationality: input.nationality,
          isLebanese: input.isLebanese,
          residencyNumber: input.residencyNumber ?? null,
          residentStatus: input.residentStatus as never,
          identityDocType: input.identityDocType as never,
          identityDocNumber: input.identityDocNumber,
          civilRecordNumber: input.civilRecordNumber,
          familySize: input.familySize,
          referenceNumber,
        },
        select: { id: true },
      });

      return row.id;
    } catch (error) {
      throw this.translate(error);
    }
  }

  async markLoggedIn(userId: string): Promise<void> {
    await this.db.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  async saveTotpSecret(userId: string, secret: string): Promise<void> {
    await this.db.user.update({
      where: { id: userId },
      data: { totpSecret: secret, totpConfirmedAt: null },
    });
  }

  async confirmTotp(userId: string): Promise<void> {
    await this.db.user.update({
      where: { id: userId },
      data: { totpConfirmedAt: new Date() },
    });
  }

  async listStaff(): Promise<
    Array<{ id: string; email: string; fullName: string; role: StaffRole; isActive: boolean }>
  > {
    const rows = await this.db.user.findMany({
      where: { kind: 'STAFF' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      email: row.email ?? '',
      fullName: `${row.firstName} ${row.lastName}`,
      role: row.role as StaffRole,
      isActive: row.isActive,
    }));
  }

  /** Prisma error codes stop here — no layer above this one sees them. */
  private translate(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'value';
      if (target.includes('referenceNumber')) {
        // Astronomically unlikely (32^6 per prefix per month) but a silent
        // collision would hand one citizen another's tracking code.
        return new ConflictError('تعذّر إنشاء رقم مرجعي فريد — يرجى المحاولة مرة أخرى');
      }
      if (target.includes('email')) {
        return new ConflictError('هذا البريد الإلكتروني مسجّل مسبقاً');
      }
      return new ConflictError('هذه الوثيقة مسجّلة مسبقاً لشخص آخر');
    }
    return error;
  }
}
