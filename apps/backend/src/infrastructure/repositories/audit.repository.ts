import { Injectable } from '@nestjs/common';
import { AuditLogEntry } from '../../domain/entities/audit-log-entry.entity';
import {
  AuditQuery,
  AuditRepository,
  AuditRow,
} from '../../domain/interfaces/audit-repository.interface';
import { TenantContextService } from '../context/tenant-context.service';

/**
 * Append and read. There is deliberately no update or delete method — and the
 * tenant migration installs a Postgres trigger that rejects both anyway, so
 * adding one here would fail at runtime rather than quietly work.
 */
@Injectable()
export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly tenantContext: TenantContextService) {}

  private get db() {
    return this.tenantContext.prisma;
  }

  async append(entry: AuditLogEntry): Promise<void> {
    await this.db.auditLogEntry.create({
      data: {
        actorId: entry.props.actorId ?? null,
        actorType: entry.props.actorType,
        actorRole: (entry.props.actorRole ?? null) as never,
        actorEmail: entry.props.actorEmail ?? null,
        action: entry.props.action,
        entityType: entry.props.entityType,
        entityId: entry.props.entityId ?? null,
        before: (entry.props.before ?? undefined) as never,
        after: (entry.props.after ?? undefined) as never,
        ipAddress: entry.props.ipAddress ?? null,
        userAgent: entry.props.userAgent ?? null,
      },
    });
  }

  async query(query: AuditQuery): Promise<{ items: AuditRow[]; total: number }> {
    const where = {
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.auditLogEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.db.auditLogEntry.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        actorType: row.actorType,
        actorRole: row.actorRole,
        actorEmail: row.actorEmail,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        before: row.before,
        after: row.after,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt,
      })),
      total,
    };
  }
}
