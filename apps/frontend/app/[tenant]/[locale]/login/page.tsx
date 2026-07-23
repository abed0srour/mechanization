'use client';

import { use, useState } from 'react';
import { sendOtp, verifyOtp } from '@/lib/supabase-client';
import { apiFetch } from '@/lib/api-client';
import { Field, inputClass } from '@/components/ui/field';

interface Profile {
  id: string;
  displayName: string;
  identityHint: string;
  referenceNumber: string;
}

/**
 * Citizen sign-in: phone plus a texted code. No password is ever created,
 * because the account is a by-product of submitting the form — there is no
 * separate registration for a citizen to remember.
 */
export default function CitizenLogin({
  params,
}: {
  params: Promise<{ tenant: string; locale: string }>;
}) {
  const { tenant } = use(params);
  const [stage, setStage] = useState<'phone' | 'code' | 'choose'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const requestCode = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await sendOtp(phone);
      setStage('code');
    } catch {
      setError('تعذّر إرسال الرمز. تأكد من رقم الهاتف وحاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const token = await verifyOtp(phone, code);
      if (!token) throw new Error('no session');

      const session = await apiFetch<{ profiles: Profile[]; requiresSelection: boolean }>(
        tenant,
        '/citizen/auth/session',
        { token },
      );

      // One phone often serves a whole household, so ask which person this is
      // rather than guessing or merging the records.
      if (session.requiresSelection) {
        setProfiles(session.profiles);
        setStage('choose');
      } else {
        window.location.href = `./my-account`;
      }
    } catch {
      setError('الرمز غير صحيح أو انتهت صلاحيته.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="font-display text-2xl font-bold">الدخول لمتابعة طلبك</h1>

      {stage === 'phone' ? (
        <>
          <Field
            label="رقم الهاتف"
            htmlFor="phone"
            required
            hint="سنرسل لك رمزاً مؤلفاً من ٦ أرقام برسالة نصية"
            error={error}
          >
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              dir="ltr"
              autoComplete="tel"
              className={inputClass(Boolean(error))}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <button
            type="button"
            onClick={requestCode}
            disabled={busy || phone.length < 7}
            className="min-h-touch w-full rounded-card border-2 border-cedar bg-cedar font-medium text-card disabled:opacity-40"
          >
            {busy ? 'جارٍ الإرسال…' : 'أرسل الرمز'}
          </button>
        </>
      ) : null}

      {stage === 'code' ? (
        <>
          <Field label="الرمز المرسل" htmlFor="code" required error={error}>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={6}
              className={`${inputClass(Boolean(error))} text-center tracking-[0.5em]`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <button
            type="button"
            onClick={submitCode}
            disabled={busy || code.length < 4}
            className="min-h-touch w-full rounded-card border-2 border-cedar bg-cedar font-medium text-card disabled:opacity-40"
          >
            {busy ? 'جارٍ التحقق…' : 'تأكيد'}
          </button>
          <button
            type="button"
            onClick={() => setStage('phone')}
            className="min-h-touch w-full text-cedar underline"
          >
            تغيير رقم الهاتف
          </button>
        </>
      ) : null}

      {stage === 'choose' ? (
        <div className="space-y-3">
          <p className="text-muted">هذا الرقم مرتبط بعدة أشخاص. اختر اسمك:</p>
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              onClick={async () => {
                await apiFetch(tenant, '/citizen/auth/select-profile', {
                  method: 'POST',
                  body: JSON.stringify({ citizenId: profile.id }),
                });
                window.location.href = './my-account';
              }}
              className="flex min-h-touch w-full items-center justify-between rounded-card border-2 border-rule bg-card px-5 py-4 text-start hover:border-cedar"
            >
              <span className="font-medium">{profile.displayName}</span>
              <span dir="ltr" className="text-sm text-muted">{profile.identityHint}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
