import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AUDIT_REPOSITORY, AuditEntry, AuditRepository, redact } from '../domain/audit-entry';

/**
 * Listens for `audit.record` events emitted by every other bounded context.
 * Decoupling this way means a context never has to import the audit module,
 * and a failure to write an audit row cannot break the citizen's submission.
 */
@Injectable()
export class RecordActionListener {
  private readonly logger = new Logger(RecordActionListener.name);

  constructor(@Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository) {}

  @OnEvent('audit.record', { async: true })
  async handle(entry: AuditEntry): Promise<void> {
    try {
      await this.audit.append({
        ...entry,
        actorType: entry.actorType ?? 'SYSTEM',
        before: redact(entry.before),
        after: redact(entry.after),
      });
    } catch (error) {
      // Never rethrow: an audit write must not fail a citizen's submission.
      // It is logged loudly instead so the gap is visible in monitoring.
      this.logger.error(
        `Failed to append audit entry '${entry.action}' for tenant ${entry.tenantId}`,
        error as Error,
      );
    }
  }
}
