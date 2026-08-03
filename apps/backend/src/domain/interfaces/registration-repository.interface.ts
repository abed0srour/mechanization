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

/** A rejected claim plus the values the citizen is being asked to fix. */
export interface CorrectionContext {
  registrationId: string;
  referenceNumber: string;
  status: string;
  rejectionReason: string | null;
  rejectedFields: string[];
  citizenCanCorrect: boolean;
  revisitAt: string | null;
  personal: Record<string, unknown>;
  contact: Record<string, unknown>;
  properties: Array<Record<string, unknown>>;
}

export interface RegistrationListItem {
  id: string;
  referenceNumber: string;
  status: ReportStatus;
  submittedAt: Date;
  /** Carried so the staff table can link a row straight to the citizen's page. */
  citizenId: string;
  citizenName: string;
  propertyCount: number;
  /**
   * The citizen's contact number. Carried on the row because the staff table's
   * first move on a questionable claim is to phone the person who filed it —
   * previously that meant opening their profile to read one field.
   */
  citizenPhone: string | null;
  /** Reviewer's note on a refused claim — what the applicant must fix. */
  rejectionReason: string | null;
  /** Dot-paths from `REJECTABLE_FIELDS`; empty unless refused field-by-field. */
  rejectedFields: string[];
  /** False when the citizen must come in person instead of correcting online. */
  citizenCanCorrect: boolean;
  /** Optional appointment for that visit, ISO-8601. */
  revisitAt: string | null;
}

export interface RegistrationRepository {
  /**
   * Citizen upsert + registration + property rows in one transaction. A partial
   * submission is worse than a failed one: the citizen sees an error, retries,
   * and hits a uniqueness conflict on a property they never successfully filed.
   */
  submit(input: SubmitRegistrationInput): Promise<SubmitRegistrationResult>;

  /** Rehydrates the aggregate, properties included. */
  findById(id: string): Promise<Registration | null>;
  /** The lookup behind a citizen quoting their رقم مرجعي at the counter. */
  findByReferenceNumber(reference: string): Promise<Registration | null>;
  /** Every submission one citizen has filed, newest first. */
  listByCitizen(citizenId: string): Promise<RegistrationListItem[]>;
  listForReview(filter: {
    status?: ReportStatus;
    limit: number;
    offset: number;
  }): Promise<{ items: RegistrationListItem[]; total: number }>;

  /** The rejected claim as its own citizen sees it, for the correction form. */
  findCorrectionContext(input: {
    registrationId: string;
    citizenId: string;
  }): Promise<CorrectionContext | null>;

  /**
   * Applies a citizen's corrections and puts the claim back in the queue, in
   * one transaction: a correction that updated the person but not the status
   * would leave a fixed claim sitting in REJECTED forever.
   */
  applyCorrection(input: {
    registrationId: string;
    citizenId: string;
    personal: Record<string, unknown>;
    contact: Record<string, unknown>;
    properties: Array<{ id: string } & Record<string, unknown>>;
  }): Promise<void>;

  persistStatusChange(input: {
    registrationId: string;
    status: ReportStatus;
    reason?: string;
    /** Dot-paths from `REJECTABLE_FIELDS`; only meaningful on a rejection. */
    rejectedFields?: string[];
    allowCitizenCorrection?: boolean;
    revisitAt?: string;
    reviewedById: string;
  }): Promise<void>;

  /**
   * How many citizens are already registered on this parcel. Context for the
   * form, not a gate — co-registration on one cadastral number is normal.
   */
  countRegistrationsForParcel(propertyNumber: string): Promise<number>;
}
