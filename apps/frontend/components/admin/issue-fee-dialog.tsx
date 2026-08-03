'use client';

import { useEffect, useState } from 'react';
import { Loader2, Receipt } from 'lucide-react';
import {
  ar,
  FEE_FREQUENCY,
  FEE_TARGET_CATEGORY,
  FEE_TARGET_TYPE,
} from '@mechanization/shared-schemas';
import type { CitizenListItem } from '@/lib/api-client';
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
import { Textarea } from '@/components/ui/textarea';

export interface IssueFeeValues {
  title: string;
  amount: string;
  frequency: string;
  targetType: string;
  targetCategory: string;
  targetCitizenId: string;
  dueDate: string;
  instructions: string;
}

const EMPTY: IssueFeeValues = {
  title: '',
  amount: '',
  frequency: 'MONTHLY',
  targetType: 'ALL_CITIZENS',
  targetCategory: 'SHOP',
  targetCitizenId: '',
  dueDate: '',
  instructions: '',
};

/** Groups thousands so a seven-digit LBP figure is readable while typing. */
function formatLbp(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits).toLocaleString('en-US') : '';
}

/**
 * "إصدار رسم جديد" — writes one rule and bills everyone it applies to.
 *
 * The count of who will be charged is the number that matters on this form:
 * submitting it creates a debt for potentially every resident of the
 * municipality, so the confirm button says how many rather than just "issue".
 */
export function IssueFeeDialog({
  open,
  onOpenChange,
  citizens,
  submitting,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Registry rows, used only to pick a single citizen by name or reference. */
  citizens: CitizenListItem[];
  submitting: boolean;
  error: string | null;
  onSubmit: (values: IssueFeeValues) => void;
}) {
  const [values, setValues] = useState<IssueFeeValues>(EMPTY);
  const [citizenQuery, setCitizenQuery] = useState('');

  useEffect(() => {
    if (open) {
      setValues(EMPTY);
      setCitizenQuery('');
    }
  }, [open]);

  const set = (patch: Partial<IssueFeeValues>) =>
    setValues((previous) => ({ ...previous, ...patch }));

  // Name or رقم مرجعي, because staff are handed one or the other depending on
  // whether the citizen is standing at the counter or on the phone.
  const matches = citizenQuery.trim()
    ? citizens
        .filter(
          (row) =>
            row.fullName.includes(citizenQuery.trim()) ||
            (row.referenceNumber ?? '').toUpperCase().includes(citizenQuery.trim().toUpperCase()),
        )
        .slice(0, 6)
    : [];

  const chosen = citizens.find((row) => row.id === values.targetCitizenId);

  const complete =
    values.title.trim().length >= 3 &&
    Number(values.amount.replace(/\D/g, '')) > 0 &&
    values.dueDate !== '' &&
    (values.targetType !== 'INDIVIDUAL_CITIZEN' || values.targetCitizenId !== '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel="إغلاق" className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 space-y-1 border-b p-6 text-start">
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="size-5 text-primary" aria-hidden />
            إصدار رسم جديد
          </DialogTitle>
          <DialogDescription>
            يُنشئ إشعاراً واحداً ويصدر مطالبة لكل مواطن مشمول به.
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

          <Field label="اسم الرسم" htmlFor="fee-title" required>
            <Input
              id="fee-title"
              placeholder="مثال: رسم النفايات الشهري"
              value={values.title}
              onChange={(event) => set({ title: event.target.value })}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="المبلغ بالليرة اللبنانية" htmlFor="fee-amount" required>
              <Input
                id="fee-amount"
                inputMode="numeric"
                dir="ltr"
                className="text-start"
                placeholder="500,000"
                value={values.amount}
                onChange={(event) => set({ amount: formatLbp(event.target.value) })}
              />
            </Field>

            <Field label="تاريخ الاستحقاق" htmlFor="fee-due" required>
              <Input
                id="fee-due"
                type="date"
                dir="ltr"
                className="text-start"
                value={values.dueDate}
                onChange={(event) => set({ dueDate: event.target.value })}
              />
            </Field>
          </div>

          <Field label="الدورية" htmlFor="fee-frequency" required>
            <Select value={values.frequency} onValueChange={(next) => set({ frequency: next })}>
              <SelectTrigger id="fee-frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FEE_FREQUENCY.map((option) => (
                  <SelectItem key={option} value={option}>
                    {ar.feeFrequency[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="الفئة المستهدفة" htmlFor="fee-target" required>
            <Select
              value={values.targetType}
              onValueChange={(next) => set({ targetType: next, targetCitizenId: '' })}
            >
              <SelectTrigger id="fee-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FEE_TARGET_TYPE.map((option) => (
                  <SelectItem key={option} value={option}>
                    {ar.feeTargetType[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {values.targetType === 'BUILDING_CATEGORY' ? (
            <Field
              label="نوع العقارات"
              htmlFor="fee-category"
              required
              hint="يشمل المواطنين الذين سجّلوا عقاراً من هذا النوع."
            >
              <Select
                value={values.targetCategory}
                onValueChange={(next) => set({ targetCategory: next })}
              >
                <SelectTrigger id="fee-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FEE_TARGET_CATEGORY.map((option) => (
                    <SelectItem key={option} value={option}>
                      {ar.feeTargetCategory[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {values.targetType === 'INDIVIDUAL_CITIZEN' ? (
            <Field
              label="المواطن"
              htmlFor="fee-citizen"
              required
              hint="ابحث بالاسم أو بالرقم المرجعي."
            >
              <div className="space-y-2">
                <Input
                  id="fee-citizen"
                  placeholder="اسم المواطن أو الرقم المرجعي"
                  value={chosen ? `${chosen.fullName} — ${chosen.referenceNumber}` : citizenQuery}
                  onChange={(event) => {
                    setCitizenQuery(event.target.value);
                    if (values.targetCitizenId) set({ targetCitizenId: '' });
                  }}
                />
                {!chosen && matches.length > 0 ? (
                  <ul className="overflow-hidden rounded-lg border">
                    {matches.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => {
                            set({ targetCitizenId: row.id });
                            setCitizenQuery('');
                          }}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm transition-colors hover:bg-accent"
                        >
                          <span className="font-medium">{row.fullName}</span>
                          <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                            {row.referenceNumber}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </Field>
          ) : null}

          <Field
            label="تعليمات الدفع / ملاحظات"
            htmlFor="fee-instructions"
            hint="تظهر للمواطن أعلى خيارات الدفع."
          >
            <Textarea
              id="fee-instructions"
              rows={3}
              value={values.instructions}
              onChange={(event) => set({ instructions: event.target.value })}
            />
          </Field>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t p-6">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            إلغاء
          </Button>
          <Button disabled={!complete || submitting} onClick={() => onSubmit(values)}>
            {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            إصدار المطالبات
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
