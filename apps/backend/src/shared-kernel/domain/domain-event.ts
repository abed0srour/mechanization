/** Base for anything the audit trail listens to. Pure data, no framework. */
export abstract class DomainEvent {
  readonly occurredAt: Date = new Date();
  abstract readonly eventName: string;

  protected constructor(readonly tenantId: string) {}
}

export interface AuditableEvent {
  tenantId: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  actorId?: string;
  actorEmail?: string;
  actorRole?: string;
  actorType?: 'STAFF' | 'CITIZEN' | 'SYSTEM';
}
