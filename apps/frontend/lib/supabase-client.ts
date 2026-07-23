import { createClient } from '@supabase/supabase-js';

/**
 * Browser client, anon key only. Used for one thing: citizen phone OTP.
 * Supabase handles SMS delivery and OTP verification, so no OTP or SMS logic
 * lives in our codebase.
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true } },
);

export async function sendOtp(phone: string) {
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) throw new Error(error.message);
}

export async function verifyOtp(phone: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
  if (error) throw new Error(error.message);
  return data.session?.access_token ?? null;
}
