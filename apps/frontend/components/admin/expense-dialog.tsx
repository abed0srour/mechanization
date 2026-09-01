'use client';

import { useEffect, useState } from 'react';
import { Loader2, Receipt } from 'lucide-react';
import {
  EXPENSE_CATEGORY,
  EXPENSE_PAYMENT_METHOD,
  EXPENSE_CURRENCY,
  getLabels,
} from '@mechanization/shared-schemas';
import type { AdminExpenseItem } from '@/lib/api-client';
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
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface ExpenseValues {
  category: string;
  description: string;
  amount: string;
  currency: string;
  expenseDate: string;
  payee: string;
  paymentMethod: string;
  reference: string;
  notes: string;
}

const today = () => new Date().toISOString().slice(0, 10);

const emptyValues = (): ExpenseValues => ({
  category: 'OTHER',
  description: '',
  amount: '',
  currency: 'LBP',
  expenseDate: today(),
  payee: '',
  paymentMethod: 'CASH',
  reference: '',
  notes: '',
});

function fromExpense(expense: AdminExpenseItem): ExpenseValues {
  return {
    category: expense.category,
    description: expense.description,
    amount: String(expense.amount),
    currency: expense.currency,
    expenseDate: expense.expenseDate.slice(0, 10),
    payee: expense.payee ?? '',
    paymentMethod: expense.paymentMethod,
    reference: expense.reference ?? '',
    notes: expense.notes ?? '',
  };
}

/**
 * Create and edit share one form — an expense has no lifecycle beyond "what
 * was spent" and "was it corrected afterwards", unlike a fee notice, which is
 * a rule fanning out into invoices. `expense` present means editing.
 */
export function ExpenseDialog({
  open,
  onOpenChange,
  expense,
  submitting,
  error,
  onSubmit,
  locale = 'ar',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense?: AdminExpenseItem | null;
  submitting: boolean;
  error: string | null;
  onSubmit: (values: ExpenseValues) => void;
  locale?: string;
}) {
  const [values, setValues] = useState<ExpenseValues>(emptyValues());
  const labels = getLabels(locale);

  useEffect(() => {
    if (open) setValues(expense ? fromExpense(expense) : emptyValues());
  }, [open, expense]);

  const set = (patch: Partial<ExpenseValues>) =>
    setValues((previous) => ({ ...previous, ...patch }));

  const complete = values.description.trim().length >= 3 && Number(values.amount) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={locale === 'en' ? 'Close' : 'إغلاق'}
        className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg"
      >
        <DialogHeader className="shrink-0 space-y-1 border-b p-6 text-start">
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="size-5 text-primary" aria-hidden />
            {expense
              ? locale === 'en'
                ? 'Edit Expense'
                : 'تعديل المصروف'
              : locale === 'en'
                ? 'New Expense'
                : 'مصروف جديد'}
          </DialogTitle>
          <DialogDescription>
            {locale === 'en'
              ? 'Money the municipality spent — salaries, maintenance, fuel, and the like.'
              : 'مبلغ أنفقته البلدية — رواتب، صيانة، محروقات وما شابه.'}
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

          <Field
            label={locale === 'en' ? 'Category' : 'الفئة'}
            htmlFor="expense-category"
            required
          >
            <Select value={values.category} onValueChange={(next) => set({ category: next })}>
              <SelectTrigger id="expense-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORY.map((option) => (
                  <SelectItem key={option} value={option}>
                    {labels.expenseCategory[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label={locale === 'en' ? 'Description' : 'الوصف'}
            htmlFor="expense-description"
            required
          >
            <Input
              id="expense-description"
              placeholder={
                locale === 'en' ? 'e.g. Diesel for the generator, March' : 'مثال: مازوت المولّد لشهر آذار'
              }
              value={values.description}
              onChange={(event) => set({ description: event.target.value })}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={locale === 'en' ? 'Amount' : 'المبلغ'}
              htmlFor="expense-amount"
              required
            >
              <div className="flex gap-2">
                <Input
                  id="expense-amount"
                  inputMode="decimal"
                  dir="ltr"
                  className="text-start"
                  placeholder="0.00"
                  value={values.amount}
                  onChange={(event) => set({ amount: event.target.value.replace(/[^\d.]/g, '') })}
                />
                <Select value={values.currency} onValueChange={(next) => set({ currency: next })}>
                  <SelectTrigger className="w-24 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CURRENCY.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Field>
            <Field
              label={locale === 'en' ? 'Date' : 'التاريخ'}
              htmlFor="expense-date"
              required
            >
              <Input
                id="expense-date"
                type="date"
                dir="ltr"
                className="text-start"
                value={values.expenseDate}
                onChange={(event) => set({ expenseDate: event.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={locale === 'en' ? 'Paid To' : 'المستفيد'} htmlFor="expense-payee">
              <Input
                id="expense-payee"
                placeholder={
                  locale === 'en' ? 'e.g. Electricity Company' : 'مثال: شركة الكهرباء'
                }
                value={values.payee}
                onChange={(event) => set({ payee: event.target.value })}
              />
            </Field>
            <Field
              label={locale === 'en' ? 'Payment Method' : 'طريقة الدفع'}
              htmlFor="expense-method"
            >
              <Select
                value={values.paymentMethod}
                onValueChange={(next) => set({ paymentMethod: next })}
              >
                <SelectTrigger id="expense-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_PAYMENT_METHOD.map((option) => (
                    <SelectItem key={option} value={option}>
                      {labels.expensePaymentMethod[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field
            label={locale === 'en' ? 'Reference' : 'المرجع'}
            htmlFor="expense-reference"
            hint={
              locale === 'en'
                ? 'A cheque number, transfer reference, or receipt number.'
                : 'رقم شيك، رقم تحويل، أو رقم إيصال.'
            }
          >
            <Input
              id="expense-reference"
              value={values.reference}
              onChange={(event) => set({ reference: event.target.value })}
            />
          </Field>

          <Field label={locale === 'en' ? 'Notes' : 'ملاحظات'} htmlFor="expense-notes">
            <Textarea
              id="expense-notes"
              rows={2}
              value={values.notes}
              onChange={(event) => set({ notes: event.target.value })}
            />
          </Field>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t p-6">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {locale === 'en' ? 'Cancel' : 'إلغاء'}
          </Button>
          <Button disabled={!complete || submitting} onClick={() => onSubmit(values)}>
            {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {expense
              ? locale === 'en'
                ? 'Save Changes'
                : 'حفظ التعديلات'
              : locale === 'en'
                ? 'Add Expense'
                : 'إضافة المصروف'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
