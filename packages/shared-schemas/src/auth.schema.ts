import { z } from 'zod';
import { staffRoleSchema } from './enums';
import { lebanesePhone } from './primitives';

/**
 * One auth vocabulary for both citizens and staff.
 *
 * v1 had `staff.schema.ts` (NestJS JWT) and `citizen-auth.schema.ts` (Supabase
 * Auth) describing two different token shapes. Unifying them here is what lets
 * the frontend keep one session store and the backend one guard.
 */

// ─────────────────────────────  Staff  ─────────────────────────────

export const staffLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('البريد الإلكتروني غير صالح'),
  password: z.string().min(8, 'كلمة المرور قصيرة جداً'),
  /**
   * Absent on the first request. A SUPER_ADMIN gets `TOTP_REQUIRED` back and
   * resubmits with the code — 2FA is mandatory for that role, not opt-in.
   */
  totpToken: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'رمز التحقق مكوّن من 6 أرقام')
    .optional(),
});
export type StaffLogin = z.infer<typeof staffLoginSchema>;

export const totpEnrolmentSchema = z.object({
  token: z.string().trim().regex(/^\d{6}$/, 'رمز التحقق مكوّن من 6 أرقام'),
});

// ────────────────────────────  Citizens  ────────────────────────────

export const requestOtpSchema = z.object({
  phone: lebanesePhone,
  /**
   * Resend counter. From the second attempt the server switches SMS route, so a
   * provider that is silently dropping messages is not simply retried.
   */
  attempt: z.coerce.number().int().min(1).max(6).default(1),
});

export const verifyOtpSchema = z.object({
  phone: lebanesePhone,
  code: z.string().trim().regex(/^\d{6}$/, 'الرمز مكوّن من 6 أرقام'),
  /** Set on the second call when a shared phone matched several people. */
  citizenId: z.string().uuid().optional(),
});

/** Returned when one phone belongs to several household members. */
export const citizenChoiceSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  identityDocLastDigits: z.string(),
});

export const disambiguationSchema = z.object({
  status: z.literal('CHOOSE_PROFILE'),
  phone: z.string(),
  choices: z.array(citizenChoiceSchema),
});

// ────────────────────────────  Shared  ────────────────────────────

/** The single session shape, whichever way the user signed in. */
export const sessionSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.string(),
  user: z.object({
    id: z.string().uuid(),
    name: z.string(),
    kind: z.enum(['STAFF', 'CITIZEN']),
    role: staffRoleSchema.optional(),
  }),
});
export type Session = z.infer<typeof sessionSchema>;

export const totpRequiredSchema = z.object({ status: z.literal('TOTP_REQUIRED') });

export const staffLoginResponseSchema = z.union([sessionSchema, totpRequiredSchema]);
export const verifyOtpResponseSchema = z.union([sessionSchema, disambiguationSchema]);

export const createStaffUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10, 'استخدم 10 أحرف على الأقل لحسابات الموظفين'),
  firstName: z.string().trim().min(2),
  lastName: z.string().trim().min(2),
  role: staffRoleSchema,
});
