import { z } from 'zod';
import { staffRoleSchema } from './enums';

export const staffLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
export type StaffLogin = z.infer<typeof staffLoginSchema>;

export const staffSessionSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    role: staffRoleSchema,
    tenantId: z.string().uuid(),
    tenantSlug: z.string(),
  }),
});
export type StaffSession = z.infer<typeof staffSessionSchema>;

export const createStaffUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10, 'Use at least 10 characters for staff accounts'),
  role: staffRoleSchema,
});
