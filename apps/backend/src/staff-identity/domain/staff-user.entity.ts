import { ForbiddenError } from '../../shared-kernel/domain/errors';

export type StaffRole = 'SUPER_ADMIN' | 'AUDITOR' | 'FIELD_INSPECTOR';

/**
 * A staff member always belongs to exactly one municipality. Roles carry no
 * meaning outside that tenant, which is why every permission check below is
 * relative to `tenantId`.
 */
export class StaffUser {
  private constructor(
    readonly id: string,
    readonly tenantId: string,
    readonly email: string,
    readonly fullName: string,
    readonly role: StaffRole,
    readonly isActive: boolean,
    readonly passwordHash: string,
  ) {}

  static rehydrate(props: {
    id: string;
    tenantId: string;
    email: string;
    fullName: string;
    role: StaffRole;
    isActive: boolean;
    passwordHash: string;
  }): StaffUser {
    return new StaffUser(
      props.id,
      props.tenantId,
      props.email,
      props.fullName,
      props.role,
      props.isActive,
      props.passwordHash,
    );
  }

  /** Only SUPER_ADMIN may read the audit trail — including their own entries. */
  canReadAuditTrail(): boolean {
    return this.role === 'SUPER_ADMIN';
  }

  canApproveRegistrations(): boolean {
    return this.role === 'SUPER_ADMIN';
  }

  canReviewRegistrations(): boolean {
    return this.role !== 'AUDITOR';
  }

  canExportData(): boolean {
    return this.role === 'SUPER_ADMIN' || this.role === 'AUDITOR';
  }

  assertBelongsTo(tenantId: string): void {
    if (this.tenantId !== tenantId) {
      throw new ForbiddenError('Account does not belong to this municipality');
    }
  }
}
