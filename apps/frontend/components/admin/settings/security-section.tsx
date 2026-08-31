'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  KeyRound,
  Loader2,
  Mail,
  MonitorSmartphone,
  PencilLine,
  ScrollText,
  ShieldCheck,
} from 'lucide-react';
import {
  ApiRequestError,
  changeStaffEmail,
  changeStaffPassword,
  getStaff,
  logApiError,
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
import { cn } from '@/lib/utils';

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

/** Length and variety only — never a claim that a password is safe. */
function passwordStrength(value: string): 0 | 1 | 2 | 3 {
  if (!value) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  if (value.length >= 14 && classes >= 3) return 3;
  if (value.length >= 10 && classes >= 2) return 2;
  return 1;
}

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
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

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

  const strength = passwordStrength(newPassword);
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const isPasswordTooShort = newPassword.length > 0 && newPassword.length < 10;

  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'ar-LB-u-nu-latn', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [locale],
  );

  const strengthLabel = [
    '—',
    copy.security.strengthWeak,
    copy.security.strengthFair,
    copy.security.strengthStrong,
  ][strength];

  const handleEmailChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !emailPassword || savingEmail) return;
    setEmailError(null);
    setSavingEmail(true);

    try {
      const result = await changeStaffEmail(tenant, token, {
        newEmail,
        currentPassword: emailPassword,
      });
      setEmail(result.email);
      setNewEmail('');
      setEmailPassword('');
      toast.success(
        locale === 'en' ? 'Email updated successfully' : 'تم تحديث البريد الإلكتروني بنجاح',
        {
          description:
            locale === 'en'
              ? 'Your sign-in email address has been updated.'
              : 'تم تحديث عنوان البريد الإلكتروني لحسابك.',
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
      setSavingEmail(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword || mismatch || savingPassword) {
      return;
    }
    if (newPassword.length < 10) {
      setPasswordError(
        locale === 'en'
          ? 'New password must be at least 10 characters.'
          : 'كلمة المرور يجب أن تكون 10 أحرف على الأقل.',
      );
      return;
    }

    setPasswordError(null);
    setSavingPassword(true);

    try {
      await changeStaffPassword(tenant, token, {
        currentPassword,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success(
        locale === 'en' ? 'Password changed successfully' : 'تم تغيير كلمة المرور بنجاح',
        {
          description:
            locale === 'en'
              ? 'Your account password has been updated.'
              : 'تم تحديث كلمة مرور حسابك بنجاح.',
        },
      );
    } catch (caught) {
      logApiError(caught);
      if (caught instanceof ApiRequestError) {
        setPasswordError(caught.message);
      } else {
        setPasswordError(
          locale === 'en'
            ? 'Failed to update password.'
            : 'تعذّر تغيير كلمة المرور.',
        );
      }
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsCard
        icon={ShieldCheck}
        title={copy.security.verifyHeading}
        hint={copy.security.verifyHint}
      >
        <ol className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: PencilLine, title: copy.security.stepEdit, hint: copy.security.stepEditHint, active: true },
            { icon: Mail, title: copy.security.stepConfirm, hint: copy.security.stepConfirmHint, active: true },
            { icon: CheckCircle2, title: copy.security.stepApply, hint: copy.security.stepApplyHint, active: true },
          ].map((step, index) => {
            const Icon = step.icon;
            return (
              <li
                key={step.title}
                className={cn(
                  'rounded-xl border p-4 transition-colors',
                  step.active
                    ? 'border-primary/20 bg-primary/[0.03]'
                    : 'border-border/70 bg-muted/20',
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                      step.active
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {index + 1}
                  </span>
                  <Icon
                    className={cn(
                      'size-4 shrink-0',
                      step.active ? 'text-primary' : 'text-muted-foreground',
                    )}
                    aria-hidden
                  />
                  <p className="min-w-0 truncate text-sm font-semibold">{step.title}</p>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {step.hint}
                </p>
                <Badge
                  variant={step.active ? 'soft-success' : 'soft-muted'}
                  className="mt-3"
                >
                  {locale === 'en' ? 'Active' : 'مفعّل'}
                </Badge>
              </li>
            );
          })}
        </ol>
      </SettingsCard>

      {/* Change Email */}
      <SettingsCard
        icon={Mail}
        title={copy.security.credentialsHeading}
        hint={copy.security.credentialsHint}
      >
        <form onSubmit={handleEmailChange} className="space-y-4">
          <AlignedFieldGrid columns={3}>
            <SettingsField label={copy.security.currentEmail} htmlFor="current-email">
              <Input
                id="current-email"
                dir="ltr"
                className="text-start font-mono"
                value={loadingEmail ? '…' : email || '—'}
                readOnly
                disabled
              />
            </SettingsField>

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

          <div className="flex items-center gap-3 pt-2">
            <Button
              type="submit"
              disabled={!newEmail || !emailPassword || savingEmail || newEmail.toLowerCase() === email.toLowerCase()}
            >
              {savingEmail ? (
                <>
                  <Loader2 className="me-2 size-4 animate-spin" />
                  {locale === 'en' ? 'Updating…' : 'جارٍ التحديث…'}
                </>
              ) : (
                copy.security.changeEmail
              )}
            </Button>
          </div>
        </form>
      </SettingsCard>

      {/* Change Password */}
      <SettingsCard
        icon={KeyRound}
        title={copy.security.passwordHeading}
        hint={copy.security.passwordHint}
      >
        <form onSubmit={handlePasswordChange} className="space-y-4">
          <AlignedFieldGrid columns={3}>
            <SettingsField
              label={copy.security.currentPassword}
              htmlFor="current-password"
              error={passwordError ?? undefined}
            >
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  setPasswordError(null);
                }}
                required
              />
            </SettingsField>

            <SettingsField
              label={copy.security.newPassword}
              htmlFor="new-password"
              hint={isPasswordTooShort ? (locale === 'en' ? 'Minimum 10 characters' : '10 أحرف على الأقل') : undefined}
            >
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setPasswordError(null);
                }}
                required
              />
            </SettingsField>

            <SettingsField
              label={copy.security.confirmPassword}
              htmlFor="confirm-password"
              error={mismatch ? copy.security.passwordMismatch : undefined}
            >
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                invalid={mismatch}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setPasswordError(null);
                }}
                required
              />
            </SettingsField>
          </AlignedFieldGrid>

          {newPassword ? (
            <div className="max-w-sm space-y-1.5 pt-1">
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-muted-foreground">{copy.security.strength}</span>
                <span className="font-medium">{strengthLabel}</span>
              </div>
              <div className="flex gap-1.5" aria-hidden>
                {[1, 2, 3].map((step) => (
                  <span
                    key={step}
                    className={cn(
                      'h-1.5 flex-1 rounded-full transition-colors',
                      strength >= step
                        ? strength === 1
                          ? 'bg-destructive'
                          : strength === 2
                            ? 'bg-warning'
                            : 'bg-success'
                        : 'bg-muted',
                    )}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-3 pt-2">
            <Button
              type="submit"
              disabled={
                !currentPassword ||
                !newPassword ||
                !confirmPassword ||
                mismatch ||
                newPassword.length < 10 ||
                savingPassword
              }
            >
              {savingPassword ? (
                <>
                  <Loader2 className="me-2 size-4 animate-spin" />
                  {locale === 'en' ? 'Updating…' : 'جارٍ التحديث…'}
                </>
              ) : (
                copy.security.changePassword
              )}
            </Button>
          </div>
        </form>
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
