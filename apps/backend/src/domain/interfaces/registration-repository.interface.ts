import { PropertyEntry } from '../entities/property-entry.entity';
import { Registration, ReportStatus } from '../entities/registration.entity';
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

export interface RegistrationListItem {
  id: string;
  referenceNumber: string;
  status: ReportStatus;
  submittedAt: Date;
  citizenName: string;
  propertyCount: number;
}

export interface RegistrationRepository {
  /**
   * Citizen upsert + registration + property rows in one transaction. A partial
   * submission is worse than a failed one: the citizen sees an error, retries,
   * and hits a uniqueness conflict on a property they never successfully filed.
   */
  submit(input: SubmitRegistrationInput): Promise<SubmitRegistrationResult>;

  findById(id: string): Promise<Registration | null>;
  findByReferenceNumber(reference: string): Promise<Registration | null>;
  listByCitizen(citizenId: string): Promise<RegistrationListItem[]>;
  listForReview(filter: {
    status?: ReportStatus;
    limit: number;
    offset: number;
  }): Promise<{ items: RegistrationListItem[]; total: number }>;

  persistStatusChange(input: {
    registrationId: string;
    status: ReportStatus;
    reason?: string;
    reviewedById: string;
  }): Promise<void>;

  isPropertyNumberAvailable(propertyNumber: string): Promise<boolean>;
}
