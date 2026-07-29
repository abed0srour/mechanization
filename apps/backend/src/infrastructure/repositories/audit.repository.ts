import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/tenant-client';
import { AuditLogEntry } from '../../domain/entities/audit-log-entry.entity';
import {
  AuditQuery,
  AuditRepository,
  AuditRow,
} from '../../domain/interfaces/audit-repository.interface';
import { TenantContextService } from '../context/tenant-context.service';
import { withConnectionRetry } from '../prisma/with-connection-retry';

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
    await withConnectionRetry(() =>
      this.db.auditLogEntry.create({
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
      }),
    );
  }

  /**
   * One round trip via `count(*) OVER()` rather than a `findMany` + `count`
   * pair — see the identical rationale on `RegistrationRepository.listForReview`.
   */
  async query(query: AuditQuery): Promise<{ items: AuditRow[]; total: number }> {
    const conditions: Prisma.Sql[] = [];
    if (query.actorId) conditions.push(Prisma.sql`"actorId" = ${query.actorId}`);
    if (query.entityType) conditions.push(Prisma.sql`"entityType" = ${query.entityType}`);
    if (query.entityId) conditions.push(Prisma.sql`"entityId" = ${query.entityId}`);
    if (query.from) conditions.push(Prisma.sql`"createdAt" >= ${query.from}`);
    if (query.to) conditions.push(Prisma.sql`"createdAt" <= ${query.to}`);

    const where =
      conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    const rows = await withConnectionRetry(() =>
      this.db.$queryRaw<
        Array<{
          id: string;
          actorId: string | null;
          actorType: string;
          actorRole: string | null;
          actorEmail: string | null;
          action: string;
          entityType: string;
          entityId: string | null;
          before: unknown;
          after: unknown;
          ipAddress: string | null;
          userAgent: string | null;
          createdAt: Date;
          total: number;
        }>
      >`
        SELECT *, count(*) OVER()::int AS total
        FROM audit_log_entries
        ${where}
        ORDER BY "createdAt" DESC
        LIMIT ${query.limit} OFFSET ${query.offset}
      `,
    );

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
      total: rows[0]?.total ?? 0,
    };
  }
}
