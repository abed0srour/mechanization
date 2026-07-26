'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiRequestError, loginStaff } from '@/lib/api-client';
import { saveSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/**
 * Staff sign-in.
 *
 * The obscure path segment is scan-deterrence, not security — the guards on
 * every admin endpoint are what actually protect this, and they hold once the
 * URL becomes known, which it eventually will. The page shows no municipal
 * branding and no hints: anyone who reaches it without credentials should learn
 * nothing from it, including whether the municipality exists.
 */
export default function StaffLogin({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpToken, setTotpToken] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);

    try {
      const result = await loginStaff(tenant, {
        email,
        password,
        ...(needsTotp ? { totpToken } : {}),
      });

      // A SUPER_ADMIN's password is correct but insufficient — 2FA is mandatory
      // for that role, so the server asks for the second factor rather than
      // issuing a session. `status` is the discriminant: a real session never
      // carries one.
      if ('status' in result) {
        setNeedsTotp(true);
        return;
      }

      saveSession(tenant, result);
      router.push(`/${tenant}/${locale}/${adminPath}/dashboard`);
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError ? caught.message : 'تعذّر تسجيل الدخول.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-6 p-6">
          <h1 className="text-2xl font-bold tracking-tight">دخول الموظفين</h1>

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive"
            >
              {error}
            </p>
          ) : null}

          <Field label="البريد الإلكتروني" htmlFor="email" required>
            <Input
              id="email"
              type="email"
              dir="ltr"
              autoComplete="username"
              className="text-start"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={needsTotp}
            />
          </Field>

          <Field label="كلمة المرور" htmlFor="password" required>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={needsTotp}
            />
          </Field>

          {needsTotp ? (
            <Field
              label="رمز التحقق الثنائي"
              htmlFor="totp"
              required
              hint="ستة أرقام من تطبيق المصادقة"
            >
              <Input
                id="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                maxLength={6}
                autoFocus
                className="text-center text-2xl tracking-[0.5em]"
                value={totpToken}
                onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
          ) : null}

          <Button
            size="lg"
            className="w-full"
            disabled={busy || !email || !password || (needsTotp && totpToken.length !== 6)}
            onClick={submit}
          >
            {busy ? 'جارٍ الدخول…' : needsTotp ? 'تحقّق وادخل' : 'دخول'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
