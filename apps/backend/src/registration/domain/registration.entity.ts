import { ConflictError, ValidationError } from '../../shared-kernel/domain/errors';
import { PropertyEntry } from './property-entry.entity';

export type ReportStatus = 'PENDING' | 'UNDER_REVIEW' | 'VERIFIED' | 'APPROVED' | 'REJECTED';

/** Server-enforced lifecycle. REJECTED is reachable from any non-terminal state. */
const ALLOWED_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  PENDING: ['UNDER_REVIEW', 'REJECTED'],
  UNDER_REVIEW: ['VERIFIED', 'REJECTED'],
  VERIFIED: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
};

export class Registration {
  private constructor(
    readonly id: string,
    readonly tenantId: string,
    readonly citizenId: string,
    readonly referenceNumber: string,
    private _status: ReportStatus,
    readonly properties: PropertyEntry[],
  ) {}

  static create(props: {
    id: string;
    tenantId: string;
    citizenId: string;
    referenceNumber: string;
    properties: PropertyEntry[];
  }): Registration {
    if (props.properties.length === 0) {
      throw new ValidationError('A registration must include at least one property');
    }

    /** Two cards in one submission cannot claim the same رقم العقار. */
    const numbers = props.properties.map((p) => p.propertyNumber);
    const duplicate = numbers.find((n, i) => numbers.indexOf(n) !== i);
    if (duplicate) {
      throw new ConflictError(`Property number '${duplicate}' appears more than once`);
    }

    return new Registration(
      props.id,
      props.tenantId,
      props.citizenId,
      props.referenceNumber,
      'PENDING',
      props.properties,
    );
  }

  static rehydrate(props: {
    id: string;
    tenantId: string;
    citizenId: string;
    referenceNumber: string;
    status: ReportStatus;
    properties?: PropertyEntry[];
  }): Registration {
    return new Registration(
      props.id,
      props.tenantId,
      props.citizenId,
      props.referenceNumber,
      props.status,
      props.properties ?? [],
    );
  }

  get status(): ReportStatus {
    return this._status;
  }

  changeStatus(next: ReportStatus, reason?: string): { from: ReportStatus; to: ReportStatus } {
    const from = this._status;

    if (!ALLOWED_TRANSITIONS[from].includes(next)) {
      throw new ConflictError(`Cannot move a report from ${from} to ${next}`);
    }
    if (next === 'REJECTED' && !reason?.trim()) {
      throw new ValidationError('A rejection must include a reason');
    }

    this._status = next;
    return { from, to: next };
  }
}
