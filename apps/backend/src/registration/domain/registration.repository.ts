import { PropertyEntry } from './property-entry.entity';
import { Registration, ReportStatus } from './registration.entity';

export const REGISTRATION_REPOSITORY = Symbol('REGISTRATION_REPOSITORY');

export interface CitizenIdentityInput {
  phone: string;
  whatsapp: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  gender: 'MALE' | 'FEMALE';
  nationality: string;
  isLebanese: boolean;
  residencyNumber?: string;
  residentStatus: 'REFUGEE' | 'DISPLACED' | 'VILLAGE_RESIDENT';
  identityDocType: 'NATIONAL_ID' | 'FAMILY_RECORD' | 'DRIVER_LICENSE' | 'PASSPORT';
  identityDocNumber: string;
  civilRecordNumber: string;
  familySize: number;
}

export interface PersistedRegistration {
  registrationId: string;
  citizenId: string;
  referenceNumber: string;
  propertyIds: string[];
}

export interface RegistrationRepository {
  /**
   * Persists citizen + registration + all property cards in ONE transaction so
   * a property-number clash rolls the whole submission back rather than leaving
   * a half-registered citizen behind.
   */
  submit(input: {
    tenantId: string;
    citizen: CitizenIdentityInput;
    citizenReference: string;
    registrationReference: string;
    properties: PropertyEntry[];
  }): Promise<PersistedRegistration>;

  isPropertyNumberAvailable(tenantId: string, propertyNumber: string): Promise<boolean>;

  findById(tenantId: string, id: string): Promise<Registration | null>;

  updateStatus(input: {
    tenantId: string;
    registrationId: string;
    status: ReportStatus;
    reason?: string;
    reviewedById: string;
  }): Promise<void>;

  listByCitizen(tenantId: string, citizenId: string): Promise<unknown[]>;
}
