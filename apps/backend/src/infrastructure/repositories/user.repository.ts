import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/tenant-client';
import { StaffRole, User } from '../../domain/entities/user.entity';
import { ConflictError } from '../../domain/errors/domain-error';
import {
  CitizenChoice,
  CitizenIdentityInput,
  StaffSummary,
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
          maritalStatus: input.maritalStatus as never,
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
          maritalStatus: input.maritalStatus as never,
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

  async listStaff(): Promise<StaffSummary[]> {
    const rows = await this.db.user.findMany({
      where: { kind: 'STAFF' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
        lastLoginAt: true,
        // Counted in the same query rather than per row: the alternative is
        // a history lookup per staff member, and this list is rendered in
        // full on every visit to the page.
        _count: { select: { reviewedRegistrations: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Audit entries carry `actorId` as a plain column with no relation to
    // join against, so they are counted in one grouped pass.
    const auditCounts = await this.db.auditLogEntry.groupBy({
      by: ['actorId'],
      where: { actorId: { in: rows.map((row) => row.id) } },
      _count: { _all: true },
    });
    const auditByActor = new Map(
      auditCounts.map((entry) => [entry.actorId, entry._count._all]),
    );

    return rows.map((row) => ({
      id: row.id,
      email: row.email ?? '',
      fullName: `${row.firstName} ${row.lastName}`,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role as StaffRole,
      isActive: row.isActive,
      historyCount:
        row._count.reviewedRegistrations + (auditByActor.get(row.id) ?? 0),
      createdAt: row.createdAt.toISOString(),
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    }));
  }

  async createStaff(input: {
    tenantSlug: string;
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    role: StaffRole;
  }): Promise<string> {
    const existing = await this.db.user.findFirst({
      where: { email: input.email.toLowerCase(), kind: 'STAFF' },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError('هذا البريد الإلكتروني مستخدم بالفعل');
    }

    const row = await this.db.user.create({
      data: {
        kind: 'STAFF',
        tenantSlug: input.tenantSlug,
        email: input.email.toLowerCase(),
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role as never,
      },
      select: { id: true },
    });

    return row.id;
  }

  async updateStaff(
    id: string,
    patch: {
      email?: string;
      passwordHash?: string;
      firstName?: string;
      lastName?: string;
      role?: StaffRole;
    },
  ): Promise<void> {
    if (patch.email) {
      const clash = await this.db.user.findFirst({
        where: { email: patch.email.toLowerCase(), kind: 'STAFF', id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictError('هذا البريد الإلكتروني مستخدم بالفعل');
      }
    }

    await this.db.user.update({
      where: { id },
      data: {
        ...(patch.email ? { email: patch.email.toLowerCase() } : {}),
        ...(patch.passwordHash ? { passwordHash: patch.passwordHash } : {}),
        ...(patch.firstName ? { firstName: patch.firstName } : {}),
        ...(patch.lastName ? { lastName: patch.lastName } : {}),
        ...(patch.role ? { role: patch.role as never } : {}),
      },
    });
  }

  async setStaffActive(id: string, isActive: boolean): Promise<void> {
    await this.db.user.update({ where: { id }, data: { isActive } });
  }

  async hardDeleteStaff(id: string): Promise<void> {
    await this.db.user.delete({ where: { id } });
  }

  async countStaffHistory(id: string): Promise<number> {
    const [reviewed, audited] = await Promise.all([
      this.db.registration.count({ where: { reviewedById: id } }),
      this.db.auditLogEntry.count({ where: { actorId: id } }),
    ]);
    return reviewed + audited;
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
