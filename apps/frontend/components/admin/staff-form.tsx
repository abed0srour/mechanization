'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { ar, staffPasswordPairSchema } from '@mechanization/shared-schemas';
import type { StaffSummary } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ROLES = [
  'SUPER_ADMIN',
  'AUDITOR',
  'FIELD_INSPECTOR',
  'COLLECTOR',
  'ACCOUNTANT',
  'ADMINISTRATIVE_OFFICER',
] as const;

/** What each role may actually do, so the choice is not made from its name. */
const ROLE_HINT: Record<string, string> = {
  SUPER_ADMIN: 'صلاحية كاملة: الموافقة النهائية وإدارة حسابات الموظفين.',
  AUDITOR: 'الاطلاع والمراجعة وتصدير البيانات، دون الموافقة النهائية.',
  FIELD_INSPECTOR: 'مراجعة الطلبات ميدانياً، دون الاطلاع على سجل النشاطات.',
  COLLECTOR: 'جباية الرسوم وتسجيل المقبوضات، دون تعديل سجل المواطنين.',
  ACCOUNTANT: 'إدارة الرسوم والمقبوضات والتقارير المالية ومتابعة التحصيل.',
  ADMINISTRATIVE_OFFICER: 'إدارة السجل المدني والقطاعات، دون البتّ المالي.',
};

export interface StaffFormValues {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: string;
}

const EMPTY: StaffFormValues = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  confirmPassword: '',
  role: 'FIELD_INSPECTOR',
};

/**
 * Create / edit one staff account.
 *
 * The password pair is validated here rather than on the wire: a confirmation
 * field is a typo guard for whoever is typing it, and sending it to the server
 * would only ask the server to trust the same value twice.
 *
 * On edit the password starts empty and means "leave it alone" — an admin
 * fixing a misspelled surname should not have to know, or reset, a colleague's
 * credential to do it.
 */
export function StaffForm({
  open,
  editing,
  submitting,
  error,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  /** null = creating. */
  editing: StaffSummary | null;
  submitting: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: StaffFormValues) => void;
}) {
  const [values, setValues] = useState<StaffFormValues>(EMPTY);
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setShowPassword(false);
    setValues(
      editing
        ? {
            firstName: editing.firstName,
            lastName: editing.lastName,
            email: editing.email,
            password: '',
            confirmPassword: '',
            role: editing.role,
          }
        : EMPTY,
    );
  }, [open, editing]);

  const set = (patch: Partial<StaffFormValues>) =>
    setValues((previous) => ({ ...previous, ...patch }));

  const wantsPassword = values.password.length > 0 || values.confirmPassword.length > 0;
  const passwordCheck =
    !editing || wantsPassword
      ? staffPasswordPairSchema.safeParse({
          password: values.password,
          confirmPassword: values.confirmPassword,
        })
      : null;

  const passwordError =
    touched && passwordCheck && !passwordCheck.success
      ? (passwordCheck.error.issues.find((issue) => issue.path[0] === 'password')?.message ??
        null)
      : null;
  const confirmError =
    touched && passwordCheck && !passwordCheck.success
      ? (passwordCheck.error.issues.find((issue) => issue.path[0] === 'confirmPassword')
          ?.message ?? null)
      : null;

  const complete =
    values.firstName.trim().length >= 2 &&
    values.lastName.trim().length >= 2 &&
    values.email.trim().length > 3 &&
    (passwordCheck ? passwordCheck.success : true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel="إغلاق" className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 space-y-1 border-b p-6 text-start">
          <DialogTitle>{editing ? 'تعديل حساب موظف' : 'إضافة موظف'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'اترك حقلي كلمة المرور فارغين للإبقاء على كلمة المرور الحالية.'
              : 'يستخدم الموظف بريده الإلكتروني وكلمة المرور للدخول إلى لوحة البلدية.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="الاسم الأول" htmlFor="firstName" required>
              <Input
                id="firstName"
                value={values.firstName}
                onChange={(event) => set({ firstName: event.target.value })}
              />
            </Field>
            <Field label="الشهرة" htmlFor="lastName" required>
              <Input
                id="lastName"
                value={values.lastName}
                onChange={(event) => set({ lastName: event.target.value })}
              />
            </Field>
          </div>

          <Field label="البريد الإلكتروني" htmlFor="email" required>
            <Input
              id="email"
              type="email"
              dir="ltr"
              autoComplete="off"
              className="text-start"
              value={values.email}
              onChange={(event) => set({ email: event.target.value })}
            />
          </Field>

          <Field
            label="كلمة المرور"
            htmlFor="password"
            required={!editing}
            hint="10 أحرف على الأقل"
            error={passwordError ?? undefined}
          >
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                className="pe-11"
                invalid={Boolean(passwordError)}
                value={values.password}
                onChange={(event) => {
                  setTouched(true);
                  set({ password: event.target.value });
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                aria-pressed={showPassword}
                className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="size-5" aria-hidden />
                ) : (
                  <Eye className="size-5" aria-hidden />
                )}
              </button>
            </div>
          </Field>

          <Field
            label="تأكيد كلمة المرور"
            htmlFor="confirmPassword"
            required={!editing}
            error={confirmError ?? undefined}
          >
            <Input
              id="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              invalid={Boolean(confirmError)}
              value={values.confirmPassword}
              onChange={(event) => {
                setTouched(true);
                set({ confirmPassword: event.target.value });
              }}
            />
          </Field>

          <Field label="الصلاحية" htmlFor="role" required hint={ROLE_HINT[values.role]}>
            <Select value={values.role} onValueChange={(next) => set({ role: next })}>
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {ar.staffRole?.[role as never] ?? role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t p-6">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            إلغاء
          </Button>
          <Button
            disabled={!complete || submitting}
            onClick={() => {
              setTouched(true);
              onSubmit(values);
            }}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {editing ? 'حفظ التعديلات' : 'إنشاء الحساب'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
