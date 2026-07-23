'use client';

import { use, useState } from 'react';
import { apiFetch, ApiRequestError } from '@/lib/api-client';
import { Field, inputClass } from '@/components/ui/field';

/**
 * Staff sign-in. Lives on a per-municipality unguessable path segment, and the
 * page deliberately gives no municipal branding or hints before authentication:
 * anyone who reaches it without credentials should learn nothing from it.
 *
 * Staff get a password (unlike citizens) because they are trained repeat users
 * and the data they can read warrants the extra factor.
 */
export default function StaffLogin({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant } = use(params);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const session = await apiFetch<{ accessToken: string }>(tenant, '/staff/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      sessionStorage.setItem('staff_token', session.accessToken);
      window.location.href = './dashboard';
    } catch (err) {
      // One message for every failure mode, so the form cannot be used to
      // discover which staff emails exist.
      setError(
        err instanceof ApiRequestError && err.status === 429
          ? 'Too many attempts. Wait a minute and try again.'
          : 'Email or password is incorrect.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm space-y-6" dir="ltr">
      <h1 className="font-display text-2xl font-bold">Staff sign in</h1>

      <Field label="Email" htmlFor="email" required>
        <input
          id="email"
          type="email"
          autoComplete="username"
          className={inputClass(Boolean(error))}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <Field label="Password" htmlFor="password" required error={error}>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          className={inputClass(Boolean(error))}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && signIn()}
        />
      </Field>

      <button
        type="button"
        onClick={signIn}
        disabled={busy || !email || !password}
        className="min-h-touch w-full rounded-card border-2 border-cedar bg-cedar font-medium text-card disabled:opacity-40"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </div>
  );
}
