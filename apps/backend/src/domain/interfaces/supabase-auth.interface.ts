export interface SupabaseAuthUser {
  id: string;
  email?: string;
  userMetadata?: Record<string, unknown>;
  appMetadata?: Record<string, unknown>;
}

export interface SupabaseAuthResult {
  user: SupabaseAuthUser;
  accessToken: string;
  expiresIn?: string;
}

export interface SupabaseAuthService {
  authenticateStaff(email: string, password: string): Promise<SupabaseAuthResult>;
  createStaffUser(input: {
    email: string;
    password: string;
    tenantSlug: string;
    role: string;
    firstName: string;
    lastName: string;
  }): Promise<{ id: string }>;
  updateStaffUser(input: {
    email: string;
    newEmail?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    role?: string;
    isActive?: boolean;
  }): Promise<void>;
  deleteStaffUser(email: string): Promise<void>;
  verifyToken(token: string): Promise<SupabaseAuthUser | null>;
  sendPasswordResetEmail(email: string, redirectTo?: string): Promise<void>;
}
