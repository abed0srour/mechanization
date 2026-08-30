'use client';

import { use, useState } from 'react';
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
import { saveSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

/** Generic and tenant-free — see the note above on why the panel can say these. */
const ASSURANCES = [
  {
    icon: Lock,
    title: 'اتصال مشفّر',
    body: 'بيانات الدخول والجلسة تمرّ عبر قناة مشفّرة بالكامل.',
  },
  {
    icon: ShieldCheck,
    title: 'صلاحيات محدّدة',
    body: 'لكل حساب صلاحياته، ولا يظهر للموظف إلا ما يخصّ عمله.',
  },
  {
    icon: History,
    title: 'سجل كامل',
    body: 'كل محاولة دخول وكل إجراء يُسجَّل مع وقته وصاحبه.',
  },
] as const;

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
      router.push(`/${tenant}/${locale}/${adminPath}/dashboard`);
    } catch (caught) {
      logApiError(caught);
      setError(
        caught instanceof ApiRequestError ? caught.message : 'تعذّر تسجيل الدخول.',
      );
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

        <div className="relative flex size-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
          <ShieldCheck className="size-6" aria-hidden />
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
              لوحة إدارة الطلبات
            </h2>
            <p className="max-w-sm text-base leading-relaxed text-primary-foreground/90">
              مساحة عمل الموظفين لمتابعة المعاملات ومراجعتها والبتّ فيها.
            </p>
          </div>

          <ul className="space-y-6">
            {ASSURANCES.map(({ icon: Icon, title, body }) => (
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
          الدخول مقتصر على الحسابات المصرّح لها.
        </p>
      </aside>

      {/* Form column */}
      <main className="flex flex-1 items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-9 space-y-2.5">
            <div
              aria-hidden
              className="mb-7 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15 lg:hidden"
            >
              <ShieldCheck className="size-6" />
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              {totpStage ? 'التحقق بخطوتين' : 'دخول الموظفين'}
            </h1>
            <p className="text-muted-foreground">
              {totpStage
                ? 'أدخل الرمز المكوّن من ستة أرقام من تطبيق المصادقة.'
                : 'أدخل بيانات حسابك للمتابعة إلى لوحة الإدارة.'}
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
                  <Label htmlFor="totp">رمز التحقق</Label>
                  <div className="relative">
                    <KeyRound
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-4 text-muted-foreground"
                    />
                    <Input
                      id="totp"
                      dir="ltr"
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
                      className="ps-10 text-center font-mono text-lg tracking-[0.4em]"
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
                      جارٍ التحقق…
                    </>
                  ) : (
                    'تأكيد'
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
                  <ArrowRight className="size-4" aria-hidden />
                  الرجوع إلى تسجيل الدخول
                </button>
              </>
            ) : (
              <>
            <div className="space-y-2">
              <Label htmlFor="email">البريد الإلكتروني</Label>
              <div className="relative">
                <Mail
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-4 text-muted-foreground"
                />
                <Input
                  id="email"
                  type="email"
                  dir="ltr"
                  autoComplete="username"
                  autoFocus
                  required
                  className="ps-10 text-start"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">كلمة المرور</Label>
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
                  className="ps-10 pe-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
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
              <Label className="cursor-pointer font-normal text-muted-foreground">
                تذكّرني على هذا الجهاز
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
                  جارٍ الدخول…
                </>
              ) : (
                'دخول'
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
            نسيت كلمة المرور أو تعذّر الدخول؟ تواصل مع مسؤول النظام لاستعادة الوصول إلى حسابك.
          </p>
        </div>
      </main>
    </div>
  );
}
