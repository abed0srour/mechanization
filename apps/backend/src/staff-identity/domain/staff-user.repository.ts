import { StaffUser } from './staff-user.entity';

export const STAFF_USER_REPOSITORY = Symbol('STAFF_USER_REPOSITORY');

export interface StaffUserRepository {
  findByEmail(tenantId: string, email: string): Promise<StaffUser | null>;
  findById(tenantId: string, id: string): Promise<StaffUser | null>;
  recordLogin(id: string, at: Date): Promise<void>;
  create(input: {
    tenantId: string;
    email: string;
    fullName: string;
    passwordHash: string;
    role: string;
  }): Promise<StaffUser>;
}
