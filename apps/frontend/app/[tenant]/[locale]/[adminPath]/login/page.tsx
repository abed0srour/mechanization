'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { ApiRequestError, isTotpRequired, loginStaff, logApiError } from '@/lib/api-client';
import { loadSession, saveSession } from '@/lib/session';
import { defaultPathFor } from '@/components/admin/nav';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/states';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useTranslations } from 'next-intl';

/**
 * Staff sign-in.
 *
 * The obscure path segment is scan-deterrence, not security — the guards on
 * every admin endpoint are what actually protect this, and they hold once the
 * URL becomes known, which it eventually will. The page shows no municipal
 * branding and no hints: anyone who reaches it without credentials should learn
 * nothing from it, including whether the municipality exists.
 *
 * That constraint shapes the layout rather than fighting it. The split panel is
 * the ordinary shape of a professional sign-in, so its lack of a logo reads as
 * a deliberately neutral system rather than as a page whose branding failed to
 * load — and everything the panel says (encrypted session, scoped permissions,
 * logged attempts) is true of any such system, so a visitor who is not staff
 * still leaves knowing nothing. The mark is a generic shield, and the only
 * colour is `--primary`, which every accent and every tenant brand already
 * resolves through.
 */

export default function StaffLogin({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const router = useRouter();
  const tAuth = useTranslations('auth');
  const tCommon = useTranslations('common');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The second factor, as a second step rather than a third field.
   *
   * Showing a code box alongside the password would ask every staff member to
   * ignore it, and would leak which accounts have an authenticator to anyone
   * who typed an email. The server decides: it answers a correct password with
   * either a session or `TOTP_REQUIRED`, and only then does this appear.
   */
  const [totpToken, setTotpToken] = useState('');
  const [totpStage, setTotpStage] = useState(false);

  /**
   * Signing in while already signed in.
   *
   * Reaching this page with a live session means a bookmark, a Back press, or
   * the admin link being shared around the office — none of which is a request
   * to sign in again, and showing the form invites someone to re-enter
   * credentials they do not need. Forwarded to the same landing page the admin
   * index resolves, so the two entry points agree.
   *
   * `checking` gates the form so it never flashes before the redirect lands.
   */
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const session = loadSession(tenant);
    if (session && session.user.kind === 'STAFF') {
      router.replace(`/${tenant}/${locale}/${adminPath}${defaultPathFor(session.user.role)}`);
      return;
    }
    setChecking(false);
  }, [tenant, locale, adminPath, router]);

  async function submit() {
    setBusy(true);
    setError(null);

    try {
      const result = await loginStaff(tenant, {
        email,
        password,
        remember: rememberMe,
        // Sent only once the server has asked, so a stale value from an
        // abandoned attempt is never replayed into a fresh one.
        ...(totpStage && totpToken ? { totpToken } : {}),
      });

      if (isTotpRequired(result)) {
        setTotpStage(true);
        setTotpToken('');
        return;
      }

      saveSession(tenant, result, rememberMe);
      /**
       * The role's own landing page rather than `/dashboard`, which is
       * restricted — a COLLECTOR signing in used to be pushed straight to a
       * screen their token is refused on, so a correct sign-in looked like a
       * failure. `replace`, so Back does not return to a login form that
       * would now redirect forward again.
       */
      router.replace(
        `/${tenant}/${locale}/${adminPath}${defaultPathFor(result.user.role)}`,
      );
    } catch (caught) {
      logApiError(caught);
      const isEn = locale === 'en';
      if (caught instanceof ApiRequestError) {
        if (caught.status === 401) {
          if (totpStage) {
            setError(
              isEn
                ? 'Invalid verification code. Please check your authenticator app.'
                : 'رمز التحقق غير صحيح. يرجى مراجعة تطبيق المصادقة.',
            );
          } else {
            setError(isEn ? 'Invalid email or password.' : 'بيانات الدخول غير صحيحة.');
          }
        } else {
          setError(caught.message);
        }
      } else {
        setError(isEn ? 'Unable to sign in.' : 'تعذّر تسجيل الدخول.');
      }
      // A rejected code is retried on its own; a rejected password sends the
      // form back to the start rather than leaving a code box above a
      // credential the server has already refused.
      if (caught instanceof ApiRequestError && caught.status === 401 && !totpStage) {
        setTotpStage(false);
      }
    } finally {
      setBusy(false);
    }
  }

  /* Nothing at all until the session check has run: rendering the form and
     then redirecting shows a sign-in page to someone who is already signed in,
     which is the exact confusion this check removes. */
  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingState />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/**
       * Assurance panel. Hidden below `lg` rather than stacked above the form:
       * on a phone the form is the whole point of the page, and pushing it
       * under a screenful of reassurance is the most common way this layout
       * goes wrong.
       */}
      <aside className="relative hidden w-[44%] max-w-[560px] shrink-0 flex-col justify-between overflow-hidden bg-primary p-12 text-primary-foreground lg:flex">
        {/* Depth, in white/black alpha so it composes over any accent. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-black/25"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -end-24 size-80 rounded-full bg-white/10 blur-3xl"
        />

        <div className="relative flex size-14 items-center justify-center">
          <img src="/logo.png" alt="" className="size-14 object-contain" aria-hidden />
        </div>

        {/**
         * Secondary text on this panel stops at /90 and goes no lower. The
         * usual /70 would be fine on a dark surface with a white foreground,
         * but dark mode here pairs a *near-black* `--primary-foreground` with a
         * 56%-lightness blue — 5.3:1 at full strength, so there is almost no
         * headroom to spend on alpha (/80 lands at 4.2:1, /75 at 3.9:1). The
         * hierarchy is carried by size and weight instead.
         */}
        <div className="relative space-y-10">
          <div className="space-y-4">
            <h2 className="font-display text-3xl font-bold leading-snug tracking-tight">
              {locale === 'en' ? 'Administration Portal' : 'لوحة إدارة الطلبات'}
            </h2>
            <p className="max-w-sm text-base leading-relaxed text-primary-foreground/90">
              {locale === 'en'
                ? 'Staff workspace to review, process, and manage municipal records.'
                : 'مساحة عمل الموظفين لمتابعة المعاملات ومراجعتها والبتّ فيها.'}
            </p>
          </div>

          <ul className="space-y-6">
            {[
              {
                icon: Lock,
                title: tAuth('encryptedConnection'),
                body: tAuth('encryptedDesc'),
              },
              {
                icon: ShieldCheck,
                title: tAuth('scopedPermissions'),
                body: tAuth('scopedDesc'),
              },
              {
                icon: History,
                title: tAuth('auditLogged'),
                body: tAuth('auditLoggedDesc'),
              },
            ].map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex items-start gap-4">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="space-y-1">
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm leading-relaxed text-primary-foreground/90">
                    {body}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-primary-foreground/90">
          {locale === 'en' ? '© 2026 — Access restricted to authorized personnel.' : '© 2026 — الدخول مقتصر على الحسابات المصرّح لها.'}
        </p>
      </aside>

      {/* Form column */}
      <main className="relative flex flex-1 items-center justify-center px-5 py-12 sm:px-10">
        <div className="absolute top-6 end-6">
          <LanguageSwitcher currentLocale={locale} variant="dropdown" />
        </div>
        <div className="w-full max-w-[400px]">
          <div className="mb-9 space-y-2.5">
            <div
              aria-hidden
              className="mb-7 flex size-14 items-center justify-center lg:hidden"
            >
              <img src="/logo.png" alt="" className="size-14 object-contain" />
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              {totpStage ? tAuth('totpPrompt') : tAuth('staffLoginTitle')}
            </h1>
            <p className="text-muted-foreground">
              {totpStage
                ? tAuth('totpHolder')
                : tAuth('staffLoginDesc')}
            </p>
          </div>

          {error ? (
            <p
              role="alert"
              className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm leading-relaxed text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </p>
          ) : null}

          {/**
           * A real <form>: the previous version wired submit to a click handler
           * only, so Enter from the password field — how a staff member who
           * signs in every morning actually submits — did nothing at all.
           */}
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy) return;
              if (totpStage) {
                if (totpToken.length === 6) void submit();
                return;
              }
              if (email && password) void submit();
            }}
          >
            {totpStage ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="totp">{tAuth('totpPrompt')}</Label>
                  <div className="relative">
                    <KeyRound
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-4 text-muted-foreground"
                    />
                    <Input
                      id="totp"
                      inputMode="numeric"
                      /**
                       * `one-time-code` is what lets a password manager or the
                       * OS offer the code it can already see. Without it the
                       * staff member retypes six digits from another device on
                       * every sign-in, which is the step people abandon 2FA
                       * over.
                       */
                      autoComplete="one-time-code"
                      maxLength={6}
                      autoFocus
                      required
                      placeholder="••••••"
                      className="px-10 text-center font-mono text-xl tracking-[0.4em]"
                      value={totpToken}
                      onChange={(e) =>
                        setTotpToken(e.target.value.replace(/\D/g, '').slice(0, 6))
                      }
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="h-12 w-full rounded-lg text-base font-semibold shadow-sm"
                  disabled={busy || totpToken.length !== 6}
                >
                  {busy ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      {tCommon('loading')}
                    </>
                  ) : (
                    tAuth('verifyCode')
                  )}
                </Button>

                <button
                  type="button"
                  onClick={() => {
                    setTotpStage(false);
                    setTotpToken('');
                    setPassword('');
                    setError(null);
                  }}
                  className="flex w-full items-center justify-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowRight className="size-4 rtl:rotate-0 ltr:rotate-180" aria-hidden />
                  {tCommon('back')}
                </button>
              </>
            ) : (
              <>
            <div className="space-y-2">
              <Label htmlFor="email">{tAuth('email')}</Label>
              <div className="relative">
                <Mail
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-4 text-muted-foreground"
                />
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  required
                  placeholder="name@example.com"
                  className="ps-10 pe-4 text-start"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{tAuth('password')}</Label>
              <div className="relative">
                <Lock
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-4 text-muted-foreground"
                />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  className="ps-10 pe-11 text-start"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-md text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="size-5" aria-hidden />
                  ) : (
                    <Eye className="size-5" aria-hidden />
                  )}
                </button>
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 pt-1">
              <Checkbox
                checked={rememberMe}
                onCheckedChange={(checked) => setRememberMe(checked === true)}
              />
              <Label className="cursor-pointer font-normal text-muted-foreground text-sm">
                {tAuth('rememberMe')}
              </Label>
            </label>

            <Button
              type="submit"
              className="h-12 w-full rounded-lg text-base font-semibold shadow-sm"
              disabled={busy || !email || !password}
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  {tAuth('signingIn')}
                </>
              ) : (
                tAuth('signIn')
              )}
            </Button>
              </>
            )}
          </form>

          {/**
           * There is no self-serve reset behind this, so it is a sentence
           * rather than a link: a «نسيت كلمة المرور؟» that goes nowhere is
           * worse than none at all.
           */}
          <p className="mt-8 border-t border-border/70 pt-6 text-sm leading-relaxed text-muted-foreground">
            {locale === 'en'
              ? 'Forgot your password or unable to sign in? Contact your system administrator to recover account access.'
              : 'نسيت كلمة المرور أو تعذّر الدخول؟ تواصل مع مسؤول النظام لاستعادة الوصول إلى حسابك.'}
          </p>
        </div>
      </main>
    </div>
  );
}
