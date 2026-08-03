import { AggregateRoot } from './aggregate-root.base';
import { ConflictError, ValidationError } from '../errors/domain-error';
import { PropertyEntry } from './property-entry.entity';

export type ReportStatus = 'PENDING' | 'UNDER_REVIEW' | 'VERIFIED' | 'APPROVED' | 'REJECTED';

/**
 * Server-enforced lifecycle. A report cannot jump PENDING → APPROVED without a
 * human having looked at it; REJECTED is reachable from any non-terminal state
 * because a reviewer may disqualify a report at any point.
 */
const ALLOWED_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  PENDING: ['UNDER_REVIEW', 'REJECTED'],
  UNDER_REVIEW: ['VERIFIED', 'REJECTED'],
  VERIFIED: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
};

export class Registration extends AggregateRoot {
  private constructor(
    readonly id: string,
    readonly citizenId: string,
    readonly referenceNumber: string,
    private _status: ReportStatus,
    readonly properties: PropertyEntry[],
  ) {
    super();
  }

  static create(props: {
    id: string;
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

    const registration = new Registration(
      props.id,
      props.citizenId,
      props.referenceNumber,
      'PENDING',
      props.properties,
    );

    registration.record('registration.submitted', {
      registrationId: props.id,
      citizenId: props.citizenId,
      referenceNumber: props.referenceNumber,
      propertyCount: props.properties.length,
    });

    return registration;
  }

  static rehydrate(props: {
    id: string;
    citizenId: string;
    referenceNumber: string;
    status: ReportStatus;
    properties?: PropertyEntry[];
  }): Registration {
    return new Registration(
      props.id,
      props.citizenId,
      props.referenceNumber,
      props.status,
      props.properties ?? [],
    );
  }

  get status(): ReportStatus {
    return this._status;
  }

  changeStatus(
    next: ReportStatus,
    actor: { id: string; role: string },
    reason?: string,
  ): { from: ReportStatus; to: ReportStatus } {
    const from = this._status;

    if (!ALLOWED_TRANSITIONS[from].includes(next)) {
      throw new ConflictError(`Cannot move a report from ${from} to ${next}`);
    }
    if (next === 'REJECTED' && !reason?.trim()) {
      throw new ValidationError('A rejection must include a reason');
    }

    this._status = next;

    this.record('registration.status-changed', {
      registrationId: this.id,
      referenceNumber: this.referenceNumber,
      from,
      to: next,
      reason: reason?.trim(),
      actorId: actor.id,
      actorRole: actor.role,
    });

    return { from, to: next };
  }

  /**
   * The citizen's answer to a rejection: corrected values, back into the queue.
   *
   * Deliberately not routed through `changeStatus`. REJECTED is terminal in
   * ALLOWED_TRANSITIONS and stays that way — that table describes what a
   * *reviewer* may do, and no reviewer should be able to un-reject a claim
   * they or a colleague refused. This is a different actor exercising a
   * different right, so it is a different method, and it is the only way back
   * from REJECTED.
   */
  resubmit(correctedFields: string[]): { from: ReportStatus; to: ReportStatus } {
    const from = this._status;

    if (from !== 'REJECTED') {
      throw new ConflictError('Only a rejected registration can be resubmitted');
    }

    this._status = 'PENDING';

    this.record('registration.resubmitted', {
      registrationId: this.id,
      citizenId: this.citizenId,
      referenceNumber: this.referenceNumber,
      correctedFields,
    });

    return { from, to: 'PENDING' };
  }

  /** What a reviewer may legally do next — drives the dashboard's buttons. */
  get allowedNextStatuses(): ReportStatus[] {
    return ALLOWED_TRANSITIONS[this._status];
  }
}
