import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared-kernel/infrastructure/prisma.service';
import { StaffRole, StaffUser } from '../domain/staff-user.entity';
import { StaffUserRepository } from '../domain/staff-user.repository';

@Injectable()
export class PrismaStaffUserRepository implements StaffUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(tenantId: string, email: string): Promise<StaffUser | null> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.municipalityUser.findUnique({
        where: { tenantId_email: { tenantId, email: email.toLowerCase() } },
      });
      return row ? StaffUser.rehydrate({ ...row, role: row.role as StaffRole }) : null;
    });
  }

  async findById(tenantId: string, id: string): Promise<StaffUser | null> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.municipalityUser.findFirst({ where: { id, tenantId } });
      return row ? StaffUser.rehydrate({ ...row, role: row.role as StaffRole }) : null;
    });
  }

  async recordLogin(id: string, at: Date): Promise<void> {
    await this.prisma.municipalityUser.update({
      where: { id },
      data: { lastLoginAt: at },
    });
  }

  async create(input: {
    tenantId: string;
    email: string;
    fullName: string;
    passwordHash: string;
    role: string;
  }): Promise<StaffUser> {
    const row = await this.prisma.municipalityUser.create({
      data: {
        tenantId: input.tenantId,
        email: input.email.toLowerCase(),
        fullName: input.fullName,
        passwordHash: input.passwordHash,
        role: input.role as StaffRole,
      },
    });
    return StaffUser.rehydrate({ ...row, role: row.role as StaffRole });
  }
}
