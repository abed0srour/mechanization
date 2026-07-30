import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { AuditLogEntry } from '../../../domain/entities/audit-log-entry.entity';
import { AUDIT_REPOSITORY } from '../../../domain/interfaces/base-repository.interface';
import {
  AuditQuery,
  AuditRepository,
  AuditRow,
} from '../../../domain/interfaces/audit-repository.interface';
import { RedisCacheService } from '../../../infrastructure/cache/redis-cache.service';
import { TenantContextService } from '../../../infrastructure/context/tenant-context.service';

/**
 * The audit trail subscribes to domain events rather than being called by the
 * features it records.
 *
 * This is the one piece of CQRS-era machinery v2 kept, because it earns its
 * keep: `RegistrationService` does not know audit logging exists, so adding a
 * new recorded action never means editing the feature that triggers it — and
 * forgetting to log is a missing subscriber, not a missing line inside a method.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    private readonly tenantContext: TenantContextService,
    private readonly cache: RedisCacheService,
    private readonly config: ConfigService,
  ) {}

  @OnEvent('registration.submitted')
  async onRegistrationSubmitted(payload: {
    registrationId: string;
    citizenId: string;
    referenceNumber: string;
    propertyCount: number;
  }): Promise<void> {
    await this.record({
      actorId: payload.citizenId,
      actorType: 'CITIZEN',
      action: 'REGISTRATION_SUBMITTED',
      entityType: 'Registration',
      entityId: payload.registrationId,
      after: {
        referenceNumber: payload.referenceNumber,
        propertyCount: payload.propertyCount,
      },
    });
  }

  @OnEvent('registration.status-changed')
  async onStatusChanged(payload: {
    registrationId: string;
    referenceNumber: string;
    from: string;
    to: string;
    reason?: string;
    actorId: string;
    actorRole: string;
  }): Promise<void> {
    await this.record({
      actorId: payload.actorId,
      actorType: 'STAFF',
      actorRole: payload.actorRole as never,
      action: 'STATUS_CHANGE',
      entityType: 'Registration',
      entityId: payload.registrationId,
      before: { status: payload.from },
      after: { status: payload.to, reason: payload.reason },
    });
  }

  /**
   * Every change to a staff account, under one subscriber.
   *
   * One event carrying its own `action` rather than five event names matched
   * by a wildcard: `EventEmitterModule.forRoot` here does not enable
   * wildcards, so `staff.*` would register a listener that never fires — and
   * an audit subscriber that silently records nothing is worse than none.
   *
   * Nothing about the credential itself is recorded: `changed` names which
   * fields moved, never their values.
   */
  @OnEvent('staff.changed')
  async onStaffChanged(payload: {
    staffId: string;
    action: string;
    email?: string;
    role?: string;
    changed?: string[];
    actorId: string;
    actorRole: string;
  }): Promise<void> {
    await this.record({
      actorId: payload.actorId,
      actorType: 'STAFF',
      actorRole: payload.actorRole as never,
      action: payload.action,
      entityType: 'User',
      entityId: payload.staffId,
      after: {
        ...(payload.email ? { email: payload.email } : {}),
        ...(payload.role ? { role: payload.role } : {}),
        ...(payload.changed ? { changed: payload.changed } : {}),
      },
    });
  }

  /**
   * A citizen answering a rejection with corrected values.
   *
   * The counterpart to `STATUS_CHANGE` — a claim moving back to PENDING with
   * no reviewer behind it is otherwise an unexplained gap in the sequence.
   */
  @OnEvent('registration.resubmitted')
  async onResubmitted(payload: {
    registrationId: string;
    citizenId: string;
    referenceNumber: string;
    correctedFields: string[];
  }): Promise<void> {
    await this.record({
      actorId: payload.citizenId,
      actorType: 'CITIZEN',
      action: 'REGISTRATION_RESUBMITTED',
      entityType: 'Registration',
      entityId: payload.registrationId,
      after: {
        referenceNumber: payload.referenceNumber,
        correctedFields: payload.correctedFields,
      },
    });
  }

  /** Sector writes — who redrew which sector, and how its membership moved. */
  @OnEvent('zone.changed')
  async onZoneChanged(payload: {
    zoneId: string;
    action: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    actorId: string;
    actorRole: string;
  }): Promise<void> {
    await this.record({
      actorId: payload.actorId,
      actorType: 'STAFF',
      actorRole: payload.actorRole as never,
      action: payload.action,
      entityType: 'Zone',
      entityId: payload.zoneId,
      before: payload.before,
      after: payload.after,
    });
  }

  @OnEvent('user.logged-in')
  async onLogin(payload: {
    userId: string;
    kind: string;
    role?: string;
    email?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.record({
      actorId: payload.userId,
      actorType: payload.kind === 'STAFF' ? 'STAFF' : 'CITIZEN',
      actorRole: (payload.role ?? null) as never,
      actorEmail: payload.email,
      action: 'LOGIN',
      entityType: 'User',
      entityId: payload.userId,
      ipAddress: payload.ip,
      userAgent: payload.userAgent,
    });
  }

  @OnEvent('document.viewed')
  async onDocumentViewed(payload: {
    documentId: string;
    documentType: string;
    actorId: string;
    actorRole: string;
    actorEmail?: string;
  }): Promise<void> {
    await this.record({
      actorId: payload.actorId,
      actorType: 'STAFF',
      actorRole: payload.actorRole as never,
      actorEmail: payload.actorEmail,
      action: 'DOCUMENT_VIEW',
      entityType: 'Document',
      entityId: payload.documentId,
      after: { documentType: payload.documentType },
    });
  }

  @OnEvent('cadastre.imported')
  async onCadastreImported(payload: {
    actorId: string;
    actorRole: string;
    parcelsImported: number;
    parcelsSkipped: number;
    linesImported: number;
  }): Promise<void> {
    // Rebuilding the parcel registry a citizen's submission validates against
    // is exactly the kind of system-wide change an audit trail exists to
    // record, not just per-registration edits.
    await this.record({
      actorId: payload.actorId,
      actorType: 'STAFF',
      actorRole: payload.actorRole as never,
      action: 'CADASTRE_IMPORT',
      entityType: 'Parcel',
      after: {
        parcelsImported: payload.parcelsImported,
        parcelsSkipped: payload.parcelsSkipped,
        linesImported: payload.linesImported,
      },
    });
  }

  @OnEvent('report.exported')
  async onExport(payload: {
    actorId: string;
    actorRole: string;
    actorEmail?: string;
    rowCount: number;
    filter: Record<string, unknown>;
  }): Promise<void> {
    // Bulk export is the highest-consequence action in the system: one click
    // turns a controlled dashboard into a spreadsheet on someone's laptop.
    await this.record({
      actorId: payload.actorId,
      actorType: 'STAFF',
      actorRole: payload.actorRole as never,
      actorEmail: payload.actorEmail,
      action: 'CSV_EXPORT',
      entityType: 'Registration',
      after: { rowCount: payload.rowCount, filter: payload.filter },
    });
  }

  /**
   * Its own cache namespace, separate from the dashboard's, and TTL-only
   * rather than event-invalidated: the trail is appended to on almost every
   * action here (including every login), so clearing it on write would
   * invalidate about as often as it's read. A short TTL is enough to absorb
   * repeated reads of the same page — reopening it, paginating back — without
   * the log ever needing to look perfectly live.
   */
  async query(query: AuditQuery): Promise<{ items: AuditRow[]; total: number }> {
    const key = this.cacheKey(query);
    const cached = await this.cache.get<{ items: AuditRow[]; total: number }>(key);
    if (cached) return cached;

    const result = await this.audit.query(query);
    const ttl = this.config.get<number>('AUDIT_CACHE_TTL_SECONDS') ?? 20;
    await this.cache.set(key, result, ttl);
    return result;
  }

  private cacheKey(query: AuditQuery): string {
    const parts = [
      query.actorId ?? 'ALL',
      query.entityType ?? 'ALL',
      query.entityId ?? 'ALL',
      query.from ? query.from.toISOString() : 'ALL',
      query.to ? query.to.toISOString() : 'ALL',
      query.limit,
      query.offset,
    ];
    return `audit:${this.tenantContext.tenantSlug}:query:${parts.join(':')}`;
  }

  /**
   * A failed audit write must not fail the action that triggered it — a citizen
   * losing their submission because a log row would not insert is the wrong
   * trade. It is logged loudly instead; a gap in the trail is an operational
   * alarm, not a user-facing error.
   */
  private async record(entry: Parameters<typeof AuditLogEntry.create>[0]): Promise<void> {
    try {
      await this.audit.append(AuditLogEntry.create(entry));
    } catch (error) {
      this.logger.error(
        `AUDIT WRITE FAILED for ${entry.action} on ${entry.entityType}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }
}
