import { PropertyEntry } from '../entities/property-entry.entity';
import { Registration } from '../entities/registration.entity';
import { CitizenIdentityInput } from './user-repository.interface';

export interface SubmitRegistrationInput {
  citizen: CitizenIdentityInput;
  citizenReference: string;
  registrationReference: string;
  properties: PropertyEntry[];
}

export interface SubmitRegistrationResult {
  registrationId: string;
  citizenId: string;
  referenceNumber: string;
  propertyIds: string[];
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
