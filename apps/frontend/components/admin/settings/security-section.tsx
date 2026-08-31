'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Circle,
  KeyRound,
  Loader2,
  Mail,
  MonitorSmartphone,
  ScrollText,
  Send,
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
        icon={MonitorSmartphone}
        title={copy.security.twoFactorHeading}
        hint={copy.security.twoFactorHint}
        actions={<Badge variant="soft-muted">{copy.security.twoFactorOff}</Badge>}
      >
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex size-28 shrink-0 items-center justify-center rounded-xl border border-dashed border-border bg-muted/30">
            <Circle className="size-6 text-muted-foreground" aria-hidden />
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <div>
              <p className="text-sm font-medium">{copy.security.twoFactorApp}</p>
              <p className="text-xs text-muted-foreground">{copy.security.twoFactorAppHint}</p>
            </div>
            <div className="max-w-[220px]">
              <SettingsField label={copy.security.twoFactorCode} htmlFor="totp">
                <Input
                  id="totp"
                  inputMode="numeric"
                  dir="ltr"
                  maxLength={6}
                  disabled
                  className="text-center font-mono tracking-[0.4em]"
                />
              </SettingsField>
            </div>
            <div className="flex items-center gap-3">
              <Button disabled>{copy.security.twoFactorEnable}</Button>
              <p className="text-xs text-muted-foreground">{copy.security.statePending}</p>
            </div>
          </div>
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
