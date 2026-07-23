import { z } from 'zod';
import { lebanesePhone } from './primitives';

/**
 * Citizens never set a password. Supabase Auth delivers the OTP; the backend
 * only verifies the resulting token and links it to a tenant-scoped profile.
 */
export const requestOtpSchema = z.object({ phone: lebanesePhone });

/**
 * A household often shares one phone, so a verified number can resolve to
 * several citizen profiles. The client picks one before a session is issued.
 */
export const citizenProfileChoiceSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  identityHint: z.string(),
  referenceNumber: z.string(),
});

export const resolveCitizenSessionSchema = z.object({
  profiles: z.array(citizenProfileChoiceSchema),
  requiresSelection: z.boolean(),
});

export const selectCitizenProfileSchema = z.object({ citizenId: z.string().uuid() });
