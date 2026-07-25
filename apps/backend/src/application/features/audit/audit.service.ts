import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuditLogEntry } from '../../../domain/entities/audit-log-entry.entity';
import { AUDIT_REPOSITORY } from '../../../domain/interfaces/base-repository.interface';
import {
  AuditQuery,
  AuditRepository,
} from '../../../domain/interfaces/audit-repository.interface';

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

  async query(query: AuditQuery) {
    return this.audit.query(query);
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
