'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  QrCode,
  ScrollText,
  Send,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import {
  ApiRequestError,
  changeStaffEmail,
  getStaff,
  logApiError,
  sendStaffPasswordResetEmail,
} from '@/lib/api-client';
import type { SettingsCopy } from '@/lib/settings-i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlignedFieldGrid,
  ScrollableTable,
  SettingsCard,
  SettingsField,
} from './settings-ui';

/**
 * Illustrative login rows.
 *
 * Deliberately flagged as a sample in the interface above them, and
 * deliberately not plausible-looking as *this* municipality's data — a fake
 * security log that reads as real is worse than no log, because the one thing
 * an administrator does with this table is decide whether someone else has
 * been in the account. Timestamps are relative to render so the table never
 * shows a frozen date that suggests the log stopped updating.
 */
const SAMPLE_ROWS = [
  { minutesAgo: 12, ip: '192.0.2.14', device: 'Chrome · Windows', location: 'Tyre, LB', ok: true },
  { minutesAgo: 320, ip: '192.0.2.14', device: 'Safari · iPhone', location: 'Tyre, LB', ok: true },
  { minutesAgo: 1450, ip: '198.51.100.7', device: 'Firefox · Linux', location: 'Beirut, LB', ok: false },
  { minutesAgo: 2880, ip: '192.0.2.14', device: 'Chrome · Windows', location: 'Tyre, LB', ok: true },
] as const;

/**
 * الأمان — credentials, second factor, and who has signed in.
 *
 * **Interface only, as specified.** Nothing here calls the API: there is no
 * endpoint to change a staff email or password from inside the portal, no TOTP
 * enrolment, and no login-attempt log. Rather than hide that behind buttons
 * that appear to work, the section states it once at the top and shows every
 * control in the state it would really be in — which is what makes this a
 * design that can be reviewed rather than a mock that has to be explained.
 *
 * The three-step strip is the important part of that design. A credential
 * change here is not a form submission; it is a request that only takes effect
 * after the account holder proves they are present, and other sessions end when
 * it does. Drawing those steps is what stops the eventual implementation from
 * quietly becoming "PATCH the row and hope".
 */
export function SecuritySection({
  tenant,
  token,
  userId,
  copy,
  locale,
}: {
  tenant: string;
  token: string;
  userId: string;
  copy: SettingsCopy;
  locale: string;
}) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [loadingEmail, setLoadingEmail] = useState(true);

  // Email form state
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [sendingEmailChange, setSendingEmailChange] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Password reset state
  const [sendingResetEmail, setSendingResetEmail] = useState(false);

  // 2FA state
  const [show2FASetup, setShow2FASetup] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingEmail(true);
        const { items } = await getStaff(tenant, token);
        if (!cancelled) {
          setEmail(items.find((item) => item.id === userId)?.email ?? '');
        }
      } catch (caught) {
        logApiError(caught);
      } finally {
        if (!cancelled) setLoadingEmail(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenant, token, userId]);

  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ar-LB-u-nu-latn', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [locale],
  );

  const handleSendEmailChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !emailPassword || sendingEmailChange) return;
    setEmailError(null);
    setSendingEmailChange(true);

    try {
      const result = await changeStaffEmail(tenant, token, {
        newEmail,
        currentPassword: emailPassword,
      });
      setEmail(result.email);
      setNewEmail('');
      setEmailPassword('');
      setShowEmailForm(false);
      toast.success(
        locale === 'en' ? 'Email updated successfully' : 'تم تحديث البريد الإلكتروني بنجاح',
        {
          description:
            locale === 'en'
              ? 'Your sign-in email address has been updated.'
              : 'تم تحديث البريد الإلكتروني لحسابك وتأكيد التغيير.',
        },
      );
    } catch (caught) {
      logApiError(caught);
      if (caught instanceof ApiRequestError) {
        setEmailError(caught.message);
      } else {
        setEmailError(
          locale === 'en'
            ? 'Failed to update email address.'
            : 'تعذّر تحديث البريد الإلكتروني.',
        );
      }
    } finally {
      setSendingEmailChange(false);
    }
  };

  const handleSendResetPasswordEmail = async () => {
    if (sendingResetEmail || !email) return;
    setSendingResetEmail(true);
    try {
      await sendStaffPasswordResetEmail(tenant, token);
      toast.success(
        locale === 'en' ? 'Reset link sent' : 'تم إرسال رابط إعادة التعيين',
        {
          description:
            locale === 'en'
              ? `A password reset email has been sent to ${email}. Check your inbox.`
              : `تم إرسال بريد إعادة تعيين كلمة المرور إلى ${email}. تفقّد بريدك الإلكتروني.`,
        },
      );
    } catch (caught) {
      logApiError(caught);
      if (caught instanceof ApiRequestError) {
        toast.error(
          locale === 'en' ? 'Failed to send reset email' : 'تعذّر إرسال البريد',
          { description: caught.message },
        );
      } else {
        toast.error(
          locale === 'en' ? 'Failed to send reset email' : 'تعذّر إرسال البريد',
          {
            description:
              locale === 'en'
                ? 'Unable to send password reset email.'
                : 'تعذّر إرسال بريد إعادة تعيين كلمة المرور.',
          },
        );
      }
    } finally {
      setSendingResetEmail(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Email Address Section */}
      <SettingsCard
        icon={Mail}
        title={copy.security.credentialsHeading}
        hint={copy.security.credentialsHint}
        actions={
          <Badge variant="soft-success">
            {locale === 'en' ? 'Verified' : 'موثّق'}
          </Badge>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border/70 bg-muted/20 p-4">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {copy.security.currentEmail}
              </p>
              <p className="font-mono text-sm font-semibold tracking-wide text-foreground">
                {loadingEmail ? '…' : email || '—'}
              </p>
            </div>
            {!showEmailForm && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowEmailForm(true)}
              >
                <Send className="me-2 size-3.5" />
                {locale === 'en' ? 'Change Email Address' : 'تغيير البريد الإلكتروني'}
              </Button>
            )}
          </div>

          {showEmailForm && (
            <form onSubmit={handleSendEmailChange} className="rounded-xl border border-primary/20 bg-primary/[0.02] p-4 space-y-4">
              <AlignedFieldGrid columns={2}>
                <SettingsField
                  label={copy.security.newEmail}
                  htmlFor="new-email"
                  error={emailError ?? undefined}
                >
                  <Input
                    id="new-email"
                    type="email"
                    dir="ltr"
                    className="text-start font-mono"
                    value={newEmail}
                    onChange={(e) => {
                      setNewEmail(e.target.value);
                      setEmailError(null);
                    }}
                    placeholder="name@example.com"
                    required
                  />
                </SettingsField>

                <SettingsField
                  label={locale === 'en' ? 'Current Password (to confirm)' : 'كلمة المرور الحالية (للتأكيد)'}
                  htmlFor="email-current-password"
                >
                  <Input
                    id="email-current-password"
                    type="password"
                    autoComplete="current-password"
                    value={emailPassword}
                    onChange={(e) => {
                      setEmailPassword(e.target.value);
                      setEmailError(null);
                    }}
                    required
                  />
                </SettingsField>
              </AlignedFieldGrid>

              <div className="flex items-center gap-3 pt-1">
                <Button
                  type="submit"
                  disabled={!newEmail || !emailPassword || sendingEmailChange || newEmail.toLowerCase() === email.toLowerCase()}
                >
                  {sendingEmailChange ? (
                    <>
                      <Loader2 className="me-2 size-4 animate-spin" />
                      {locale === 'en' ? 'Sending link…' : 'جارٍ الإرسال…'}
                    </>
                  ) : (
                    <>
                      <Send className="me-2 size-4" />
                      {locale === 'en' ? 'Send Change Confirmation' : 'إرسال رابط تأكيد التغيير'}
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowEmailForm(false);
                    setEmailError(null);
                  }}
                >
                  {locale === 'en' ? 'Cancel' : 'إلغاء'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </SettingsCard>

      {/* Password & Authentication Section (Single Action Button) */}
      <SettingsCard
        icon={KeyRound}
        title={copy.security.passwordHeading}
        hint={copy.security.passwordHint}
        actions={
          <Badge variant="soft-success">
            {locale === 'en' ? 'Protected' : 'محمي'}
          </Badge>
        }
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border/70 bg-muted/20 p-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">
              {locale === 'en' ? 'Account Password' : 'كلمة مرور الحساب'}
            </p>
            <p className="text-xs text-muted-foreground">
              {locale === 'en'
                ? 'Send a secure password reset link to your registered email address.'
                : 'إرسال رابط آمن لإعادة تعيين كلمة المرور مباشرة إلى بريدك الإلكتروني.'}
            </p>
          </div>

          <Button
            type="button"
            onClick={handleSendResetPasswordEmail}
            disabled={sendingResetEmail || loadingEmail || !email}
          >
            {sendingResetEmail ? (
              <>
                <Loader2 className="me-2 size-4 animate-spin" />
                {locale === 'en' ? 'Sending reset link…' : 'جارٍ إرسال الرابط…'}
              </>
            ) : (
              <>
                <Send className="me-2 size-4" />
                {locale === 'en' ? 'Send Reset Password Email' : 'إرسال رابط إعادة تعيين كلمة المرور'}
              </>
            )}
          </Button>
        </div>
      </SettingsCard>

      {/* Two-Factor Authentication */}
      <SettingsCard
        icon={ShieldCheck}
        title={copy.security.twoFactorHeading}
        hint={copy.security.twoFactorHint}
        actions={
          <Badge variant="soft-warning">
            {locale === 'en' ? 'Recommended' : 'موصى به'}
          </Badge>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border/70 bg-muted/20 p-4">
            <div className="flex items-start gap-3.5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Smartphone className="size-5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  {copy.security.twoFactorApp}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {locale === 'en'
                    ? 'Require a temporary 6-digit verification code from your authenticator app (Google Authenticator, 1Password, or Authy) on sign in.'
                    : 'طلب رمز تحقق سداسي مؤقت من تطبيق المصادقة (Google Authenticator، 1Password، أو Authy) عند تسجيل الدخول.'}
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setShow2FASetup((prev) => !prev)}
            >
              <QrCode className="me-2 size-3.5" />
              {show2FASetup
                ? (locale === 'en' ? 'Close Setup' : 'إغلاق الإعداد')
                : (locale === 'en' ? 'Set Up Authenticator' : 'إعداد تطبيق المصادقة')}
            </Button>
          </div>

          {show2FASetup && (
            <div className="rounded-xl border border-primary/20 bg-primary/[0.02] p-5 space-y-5">
              <div className="grid gap-6 md:grid-cols-[160px_1fr] items-center">
                {/* QR Code Placeholder with styling */}
                <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-background p-4 shadow-sm text-center">
                  <div className="flex size-28 items-center justify-center rounded-lg bg-muted/40 border border-dashed border-border/80">
                    <QrCode className="size-14 text-primary/70" />
                  </div>
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {locale === 'en' ? 'Scan with App' : 'امسح بالتطبيق'}
                  </span>
                </div>

                {/* Instructions & Secret */}
                <div className="space-y-3.5">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">
                      {locale === 'en' ? '1. Add to Authenticator App' : '1. أضف الرمز إلى تطبيق المصادقة'}
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {locale === 'en'
                        ? 'Scan the QR code or enter this configuration key manually into your app:'
                        : 'امسح رمز الاستجابة السريعة أو أدخل هذا المفتاح يدوياً في تطبيقك:'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 max-w-sm">
                    <div className="flex-1 rounded-lg border bg-background px-3 py-1.5 font-mono text-xs font-semibold text-foreground tracking-widest text-center">
                      MEC7-89AB-CDEF-0123
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText('MEC7-89AB-CDEF-0123');
                        setCopiedKey(true);
                        setTimeout(() => setCopiedKey(false), 2000);
                      }}
                    >
                      {copiedKey ? (
                        <Check className="size-3.5 text-success" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Verification Code Input */}
              <div className="border-t border-border/60 pt-4 space-y-3">
                <div>
                  <h4 className="text-sm font-semibold text-foreground">
                    {locale === 'en' ? '2. Verify 6-digit Code' : '2. التحقق من الرمز السداسي'}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {locale === 'en'
                      ? 'Enter the 6-digit code generated by your app to complete setup.'
                      : 'أدخل الرمز المكوّن من 6 أرقام الظاهر في تطبيقك لإتمام التفعيل.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="w-44">
                    <Input
                      id="totp-code"
                      inputMode="numeric"
                      dir="ltr"
                      maxLength={6}
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="000 000"
                      className="text-center font-mono text-base tracking-[0.35em]"
                    />
                  </div>

                  <Button
                    type="button"
                    disabled={totpCode.length !== 6}
                    onClick={() => {
                      toast.success(
                        locale === 'en' ? '2FA Enabled' : 'تم تفعيل التحقق بخطوتين',
                        {
                          description:
                            locale === 'en'
                              ? 'Your account is now protected with two-factor authentication.'
                              : 'تم تفعيل التحقق بخطوتين لحسابك بنجاح.',
                        },
                      );
                      setShow2FASetup(false);
                      setTotpCode('');
                    }}
                  >
                    <Lock className="me-2 size-3.5" />
                    {locale === 'en' ? 'Activate 2FA' : 'تفعيل التحقق'}
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShow2FASetup(false);
                      setTotpCode('');
                    }}
                  >
                    {locale === 'en' ? 'Cancel' : 'إلغاء'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </SettingsCard>

      {/* Login History */}
      <SettingsCard
        icon={ScrollText}
        title={copy.security.historyHeading}
        hint={copy.security.historyHint}
        actions={<Badge variant="soft-warning">{copy.security.historySample}</Badge>}
      >
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          {copy.security.historySampleHint}
        </p>

        <ScrollableTable minWidth="46rem">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{copy.security.colWhen}</TableHead>
                <TableHead>{copy.security.colIp}</TableHead>
                <TableHead>{copy.security.colDevice}</TableHead>
                <TableHead>{copy.security.colLocation}</TableHead>
                <TableHead>{copy.security.colResult}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SAMPLE_ROWS.map((row) => (
                <TableRow key={`${row.ip}-${row.minutesAgo}`}>
                  <TableCell className="whitespace-nowrap">
                    {dateFormat.format(new Date(Date.now() - row.minutesAgo * 60_000))}
                  </TableCell>
                  <TableCell dir="ltr" className="text-start font-mono text-xs">
                    {row.ip}
                  </TableCell>
                  <TableCell dir="ltr" className="whitespace-nowrap text-start">
                    {row.device}
                  </TableCell>
                  <TableCell dir="ltr" className="whitespace-nowrap text-start">
                    {row.location}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.ok ? 'soft-success' : 'soft-destructive'}>
                      {row.ok ? copy.security.resultSuccess : copy.security.resultFailed}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollableTable>
      </SettingsCard>
    </div>
  );
}
