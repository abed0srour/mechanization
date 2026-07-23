import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared-kernel/infrastructure/prisma.service';
import { AuditEntry, AuditRepository } from '../domain/audit-entry';

@Injectable()
export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async append(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLogEntry.create({
      data: {
        tenantId: entry.tenantId,
        actorId: entry.actorId ?? null,
        actorType: entry.actorType,
        actorRole: (entry.actorRole as never) ?? null,
        actorEmail: entry.actorEmail ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: (entry.before as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        after: (entry.after as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  }

  async list(input: {
    tenantId: string;
    page: number;
    pageSize: number;
    action?: string;
    actorId?: string;
  }) {
    const where = {
      tenantId: input.tenantId,
      ...(input.action ? { action: input.action } : {}),
      ...(input.actorId ? { actorId: input.actorId } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.auditLogEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.auditLogEntry.count({ where }),
    ]);

    return { items, total };
  }
}
