'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { ApiRequestError, loginStaff, logApiError } from '@/lib/api-client';
import { saveSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Staff sign-in.
 *
 * The obscure path segment is scan-deterrence, not security — the guards on
 * every admin endpoint are what actually protect this, and they hold once the
 * URL becomes known, which it eventually will. The page shows no municipal
 * branding and no hints: anyone who reaches it without credentials should learn
 * nothing from it, including whether the municipality exists. The icon badge
 * below is generic (a shield, not a logo) for the same reason.
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
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
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
        remember: rememberMe,
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

      saveSession(tenant, result, rememberMe);
      router.push(`/${tenant}/${locale}/${adminPath}/dashboard`);
    } catch (caught) {
      logApiError(caught);
      setError(
        caught instanceof ApiRequestError ? caught.message : 'تعذّر تسجيل الدخول.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-muted/50 to-muted/10 p-4">
      <Card className="w-full max-w-sm shadow-lg">
        <CardContent className="space-y-6 p-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ShieldCheck className="size-7" aria-hidden />
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">دخول الموظفين</h1>
              <p className="text-sm text-muted-foreground">
                أدخل بياناتك للوصول إلى لوحة الإدارة
              </p>
            </div>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive"
            >
              {error}
            </p>
          ) : null}

          <div className="space-y-5">
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
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="pe-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={needsTotp}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  disabled={needsTotp}
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {showPassword ? (
                    <EyeOff className="size-5" aria-hidden />
                  ) : (
                    <Eye className="size-5" aria-hidden />
                  )}
                </button>
              </div>
            </Field>

            {!needsTotp ? (
              <label className="flex cursor-pointer items-center gap-2.5">
                <Checkbox
                  checked={rememberMe}
                  onCheckedChange={(checked) => setRememberMe(checked === true)}
                />
                <Label className="cursor-pointer font-normal text-muted-foreground">
                  تذكّرني على هذا الجهاز
                </Label>
              </label>
            ) : null}

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
          </div>

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
