export type ActorType = 'STAFF' | 'CITIZEN' | 'SYSTEM';

/**
 * An audit entry is a fact about something that already happened, so it has no
 * mutating behaviour. The repository only ever appends.
 */
export interface AuditEntry {
  tenantId: string;
  actorId?: string;
  actorType: ActorType;
  actorRole?: string;
  actorEmail?: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');

export interface AuditRepository {
  append(entry: AuditEntry): Promise<void>;
  list(input: {
    tenantId: string;
    page: number;
    pageSize: number;
    action?: string;
    actorId?: string;
  }): Promise<{ items: unknown[]; total: number }>;
}

/** Fields that must never reach the audit log in clear text. */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'accessToken',
  'otpCode',
  'identityDocNumber',
  'civilRecordNumber',
  'residencyNumber',
]);

/**
 * The audit trail is read by staff, so it records *that* an identity document
 * was involved without reprinting the number itself.
 */
export function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, val]) => [
      key,
      REDACTED_KEYS.has(key) ? '[redacted]' : redact(val),
    ]),
  );
}
