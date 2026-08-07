import { AggregateRoot } from './aggregate-root.base';
import { ConflictError, ValidationError } from '../errors/domain-error';
import { PropertyEntry } from './property-entry.entity';

/**
 * A citizen's property filing: one رقم مرجعي over one or more عقارات.
 *
 * This used to be a *claim* with a lifecycle — PENDING → UNDER_REVIEW →
 * VERIFIED → APPROVED, REJECTED from anywhere, and a citizen's `resubmit` as
 * the one way back. All of it existed because citizens filed their own طلبات
 * and the municipality adjudicated them. Records are now entered by staff from
 * documents handed over a counter, so there is nothing left to adjudicate: the
 * row exists because a clerk entered it, which is what مقبول used to certify.
 *
 * What remains is the aggregate's real job, and the reason it is not just a
 * table: it refuses an empty filing, and it refuses two عقارات claiming the
 * same رقم العقار within one filing. Those rules are about property, not about
 * process, so they outlive the workflow.
 */
export class Registration extends AggregateRoot {
  private constructor(
    readonly id: string,
    readonly citizenId: string,
    readonly referenceNumber: string,
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

    /** Two cards in one filing cannot claim the same رقم العقار. */
    const numbers = props.properties.map((p) => p.propertyNumber);
    const duplicate = numbers.find((n, i) => numbers.indexOf(n) !== i);
    if (duplicate) {
      throw new ConflictError(`Property number '${duplicate}' appears more than once`);
    }

    const registration = new Registration(
      props.id,
      props.citizenId,
      props.referenceNumber,
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
    properties?: PropertyEntry[];
  }): Registration {
    return new Registration(
      props.id,
      props.citizenId,
      props.referenceNumber,
      props.properties ?? [],
    );
  }
}
