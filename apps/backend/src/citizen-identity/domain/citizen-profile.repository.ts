export const CITIZEN_PROFILE_REPOSITORY = Symbol('CITIZEN_PROFILE_REPOSITORY');

export interface CitizenProfileSummary {
  id: string;
  displayName: string;
  /** Masked hint so a household member can recognise their own row. */
  identityHint: string;
  referenceNumber: string;
}

export interface CitizenProfileRepository {
  findByPhone(tenantId: string, phone: string): Promise<CitizenProfileSummary[]>;
  findById(tenantId: string, citizenId: string): Promise<CitizenProfileSummary | null>;
  linkSupabaseUser(tenantId: string, citizenId: string, supabaseUserId: string): Promise<void>;
}
