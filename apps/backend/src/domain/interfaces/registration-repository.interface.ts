import { PropertyEntry } from '../entities/property-entry.entity';
import { Registration } from '../entities/registration.entity';
import { CitizenIdentityInput } from './user-repository.interface';

export interface SubmitRegistrationInput {
  citizen: CitizenIdentityInput;
  citizenReference: string;
  registrationReference: string;
  properties: PropertyEntry[];
  /**
   * `REQUIRES_REVIEW` when anything on the record was left unestablished,
   * `PENDING` otherwise. Passed rather than derived here so the one place that
   * decides it is `statusForFlags`, next to the flags themselves.
   */
  status: 'PENDING' | 'REQUIRES_REVIEW';
  /** The «غير مؤكَّد» fields and their stated reasons, stored verbatim. */
  flaggedFields: ReadonlyArray<{ path: string; reason: string }>;
  /** The browser's own id for this submission, when it was filed offline. */
  clientSubmissionId?: string;
  /**
   * أفراد الأسرة, when the officer enumerated them.
   *
   * Written in the *same transaction* as the citizen and their properties, and
   * that is the whole reason it travels here rather than through
   * `HouseholdsService.createFor`. A household created afterwards, in a second
   * transaction, has two ways to go wrong that this has none of: a citizen with
   * no household when the second call fails, and a household with no citizen
   * when the first one is rolled back by a retry.
   *
   * `createFor` remains the path for a citizen already on file who is only now
   * being grouped. This is the path for a household described at the door.
   */
  household?: ReadonlyArray<{
    fullName: string;
    relationToHead: string;
    birthYear?: number;
    gender?: string;
    residesHere: boolean;
  }>;
  /**
   * Whether the citizen named an already-registered relative.
   *
   * Carried here — rather than only being acted on after the transaction —
   * because it decides whether a household should be created *at all*, and that
   * decision has to be made before the roster is written.
   *
   * Getting this wrong produced the failure it now prevents: an officer who
   * both typed a family and gave a رقم مرجعي had a household built from the
   * roster first, which then made the link impossible — the citizen was already
   * in a household of their own, so joining their father's was refused, and one
   * family ended up described twice under two heads.
   */
  householdReference?: string;
}

export interface SubmitRegistrationResult {
  registrationId: string;
  citizenId: string;
  referenceNumber: string;
  propertyIds: string[];
  /**
   * True when this call found the submission already stored under its
   * `clientSubmissionId` and returned that rather than writing a second one.
   * The sync queue reports it as "already synced" instead of "created".
   */
  deduplicated: boolean;
}

/*
 * `RegistrationListItem` was here — one row of a طلبات list, carrying `status`,
 * `rejectionReason`, `rejectedFields`, `citizenCanCorrect` and `revisitAt`.
 *
 * Both the lists it served are gone: the staff review queue (there is nothing
 * to adjudicate) and the citizen's «طلباتي» page (which now reads their
 * properties and fees through the profile projection instead). Its
 * status-free remnant had no caller left, so it goes rather than sitting here
 * as a shape nothing produces.
 */

export interface RegistrationRepository {
  /**
   * Citizen upsert + registration + property rows in one transaction. A partial
   * write is worse than a failed one: the clerk sees an error, retries, and
   * collides with the property rows their "failed" attempt already committed.
   */
  submit(input: SubmitRegistrationInput): Promise<SubmitRegistrationResult>;

  /** Rehydrates the aggregate, properties included. */
  findById(id: string): Promise<Registration | null>;

  /**
   * How many citizens are already registered on this parcel. Context for the
   * form, not a gate — co-registration on one cadastral number is normal.
   */
  countRegistrationsForParcel(propertyNumber: string): Promise<number>;
}
