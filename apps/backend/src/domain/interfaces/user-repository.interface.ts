import { StaffRole, User } from '../entities/user.entity';

export interface CitizenIdentityInput {
  phone: string;
  whatsapp?: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  gender: string;
  nationality: string;
  isLebanese: boolean;
  residencyNumber?: string;
  residentStatus: string;
  identityDocType: string;
  identityDocNumber: string;
  /** رقم السجل — meaningless outside the Lebanese civil registry. */
  civilRecordNumber?: string;
  familySize: number;
  maritalStatus: string;
}

/**
 * A phone shared by a household resolves to several people. The citizen picks
 * which one they are *after* proving they hold the phone, so this returns the
 * minimum needed to render that choice and nothing more.
 */
export interface CitizenChoice {
  id: string;
  displayName: string;
  identityDocLastDigits: string;
}

export interface UserRepository {
  findStaffByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  findCitizensByPhone(phone: string): Promise<CitizenChoice[]>;

  /** Upserts on (identityDocType, identityDocNumber) — the household-safe key. */
  upsertCitizen(input: CitizenIdentityInput, referenceNumber: string): Promise<string>;

  markLoggedIn(userId: string): Promise<void>;
  saveTotpSecret(userId: string, secret: string): Promise<void>;
  confirmTotp(userId: string): Promise<void>;

  listStaff(): Promise<
    Array<{ id: string; email: string; fullName: string; role: StaffRole; isActive: boolean }>
  >;
}
