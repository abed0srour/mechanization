'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { formatLbp } from '@/lib/currency';
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

/** Only the fields this dialog needs, so it works with any payment shape. */
export interface SettleTarget {
  id: string;
  title: string;
  amount: number;
  paidAmount: number;
  remaining: number;
  dueDate: string;
}

export interface SettleValues {
  amount: number;
  note?: string;
}

/**
 * تسجيل دفعة نقدية — records what was actually handed over.
 *
 * The amount used to be fixed: the button settled the whole invoice or did
 * nothing, so a citizen arriving with part of the money could not be recorded
 * as having paid at all. It is now an editable figure that **defaults to the
 * outstanding balance**, which keeps the common case a single click while
 * making a partial a matter of typing over it.
 *
 * The balance — not the invoice's face value — is what defaults and what caps:
 * on an invoice already part-settled, offering the full amount again would
 * take the money twice.
 */
export function SettlePaymentDialog({
  open,
  onOpenChange,
  payment,
  submitting,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: SettleTarget | null;
  submitting: boolean;
  error: string | null;
  onSubmit: (values: SettleValues) => void;
}) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open || !payment) return;
    // Digits only: the input is `inputMode="numeric"` and LBP has no minor
    // unit, so a grouped default like "5,000,000" would have to be stripped
    // again on every keystroke.
    setAmount(String(Math.round(payment.remaining)));
    setNote('');
  }, [open, payment]);

  if (!payment) return null;

  const received = Number(amount.replace(/\D/g, ''));
  const valid = Number.isFinite(received) && received > 0 && received <= payment.remaining;
  const isPartial = valid && received < payment.remaining;

  const tooMuch = received > payment.remaining;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel="إغلاق" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>تسجيل دفعة نقدية</DialogTitle>
          <DialogDescription>{payment.title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          <dl className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
            <Row label="قيمة المطالبة" value={formatLbp(payment.amount)} />
            {payment.paidAmount > 0 ? (
              <Row label="المسدَّد سابقاً" value={formatLbp(payment.paidAmount)} />
            ) : null}
            <Row label="الرصيد المستحق" value={formatLbp(payment.remaining)} strong />
          </dl>

          <Field
            label="المبلغ المستلم (ل.ل)"
            htmlFor="settle-amount"
            required
            hint="يمكن تسجيل دفعة جزئية — عدّل المبلغ حسب ما استُلم فعلياً."
            error={
              tooMuch
                ? `المبلغ أكبر من الرصيد المستحق (${formatLbp(payment.remaining)})`
                : undefined
            }
          >
            <Input
              id="settle-amount"
              inputMode="numeric"
              dir="ltr"
              className="text-start text-lg font-semibold tabular-nums"
              invalid={tooMuch}
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))}
            />
          </Field>

          {/* Quick splits, because "half" is the commonest partial by a mile
              and typing 2,750,000 by hand invites a slipped digit. */}
          {payment.remaining > 1 ? (
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'النصف', value: Math.round(payment.remaining / 2) },
                { label: 'الثلث', value: Math.round(payment.remaining / 3) },
                { label: 'كامل الرصيد', value: Math.round(payment.remaining) },
              ].map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAmount(String(preset.value))}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          ) : null}

          {isPartial ? (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              دفعة جزئية — سيبقى{' '}
              <span className="font-semibold">{formatLbp(payment.remaining - received)}</span>{' '}
              مستحقاً على هذه المطالبة.
            </p>
          ) : null}

          <Field label="ملاحظة" htmlFor="settle-note" hint="اختياري — تظهر في سجل الدفعة">
            <Textarea
              id="settle-note"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            إلغاء
          </Button>
          <Button
            disabled={!valid || submitting}
            onClick={() => onSubmit({ amount: received, note: note.trim() || undefined })}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            تسجيل {formatLbp(valid ? received : 0)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? 'font-semibold tabular-nums' : 'tabular-nums'}>{value}</dd>
    </div>
  );
}
