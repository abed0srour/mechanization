'use client';

import { useEffect, useState } from 'react';
import { Banknote, CreditCard, Loader2, UserCheck } from 'lucide-react';
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
import { ChoiceCard, Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

/**
 * The two ways money reaches the municipality.
 *
 * Both go straight to PAID here — the distinction is what is being recorded,
 * not whether it needs verifying. A clerk choosing Whish is stating they have
 * already seen the transfer land, which is precisely the check PENDING_REVIEW
 * performs for a citizen's unverified claim.
 */
const METHODS = [
  {
    value: 'CASH',
    title: 'نقداً',
    description: 'مبلغ استُلم في البلدية',
    icon: Banknote,
  },
  {
    value: 'WHISH_MONEY',
    title: 'تحويل Whish',
    description: 'تحويل مؤكَّد في حساب البلدية',
    icon: CreditCard,
  },
  {
    value: 'COLLECTOR',
    title: 'عبر المحصّل',
    description: 'مبلغ حصّله موظّف في جولته',
    icon: UserCheck,
  },
] as const;

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
  method: 'CASH' | 'WHISH_MONEY' | 'COLLECTOR';
  amount: number;
  /** Only ever sent for a Whish payment; the server rejects it as missing. */
  whishTransactionRef?: string;
  /** Only ever sent for a collector payment; the server rejects it as missing. */
  collectedById?: string;
  note?: string;
}

/** The subset of a staff record this dialog needs to offer a collector. */
export interface CollectorOption {
  id: string;
  fullName: string;
  role: string;
  isActive: boolean;
}

/**
 * تسجيل دفعة — records what was actually received.
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
 *
 * The method used to be assumed. It was hard-wired to cash — reasonably, since
 * this is the counter — but a clerk who has just watched a transfer land in the
 * municipality's account has no way to bank it here except by calling it cash,
 * which loses both the method and the transfer's reference. Choosing Whish now
 * asks for that reference, exactly as the citizen-facing declaration does, so
 * the two routes to the same fact record the same evidence.
 *
 * Either way this still skips PENDING_REVIEW: that queue exists to verify a
 * transfer *nobody in the building witnessed*, and a clerk selecting Whish here
 * is asserting they have already seen it in the account.
 */
export function SettlePaymentDialog({
  open,
  onOpenChange,
  payment,
  submitting,
  error,
  collectors = [],
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: SettleTarget | null;
  submitting: boolean;
  error: string | null;
  /** Active staff, offered as the محصّل when that method is chosen. */
  collectors?: CollectorOption[];
  onSubmit: (values: SettleValues) => void;
}) {
  const [method, setMethod] = useState<SettleValues['method']>('CASH');
  const [reference, setReference] = useState('');
  const [collectedById, setCollectedById] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open || !payment) return;
    // Digits only: the input is `inputMode="numeric"` and LBP has no minor
    // unit, so a grouped default like "5,000,000" would have to be stripped
    // again on every keystroke.
    setAmount(String(Math.round(payment.remaining)));
    // Cash is the default because this dialog is opened at a counter; Whish is
    // the deliberate choice, not the one you land on by not reading.
    setMethod('CASH');
    setReference('');
    setCollectedById('');
    setNote('');
  }, [open, payment]);

  if (!payment) return null;

  const received = Number(amount.replace(/\D/g, ''));
  const isWhish = method === 'WHISH_MONEY';
  const isCollector = method === 'COLLECTOR';
  const missingReference = isWhish && reference.trim() === '';
  const missingCollector = isCollector && collectedById === '';
  const valid =
    Number.isFinite(received) &&
    received > 0 &&
    received <= payment.remaining &&
    !missingReference &&
    !missingCollector;
  const isPartial = received > 0 && received < payment.remaining;

  const tooMuch = received > payment.remaining;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel="إغلاق" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>تسجيل دفعة</DialogTitle>
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

          <Field label="طريقة الدفع" htmlFor="settle-method" required>
            <div className="grid gap-3 sm:grid-cols-2">
              {METHODS.map((option) => (
                <ChoiceCard
                  key={option.value}
                  name="settle-method"
                  value={option.value}
                  checked={method === option.value}
                  onChange={(next) => {
                    setMethod(next as SettleValues['method']);
                    // Each method carries exactly one extra fact, so switching
                    // away drops the other's. The server nulls them anyway; the
                    // two agreeing is what keeps this form from showing a value
                    // it will not send.
                    if (next !== 'WHISH_MONEY') setReference('');
                    if (next !== 'COLLECTOR') setCollectedById('');
                  }}
                  title={option.title}
                  description={option.description}
                  icon={option.icon}
                />
              ))}
            </div>
          </Field>

          {isWhish ? (
            <Field
              label="رقم عملية التحويل"
              htmlFor="settle-reference"
              required
              hint="كما يظهر في حساب البلدية — هو الإثبات الوحيد للتحويل."
            >
              <Input
                id="settle-reference"
                dir="ltr"
                className="text-start font-mono"
                placeholder="TRX-000000"
                invalid={missingReference && reference !== ''}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            </Field>
          ) : null}

          {isCollector ? (
            <Field
              label="المحصّل"
              htmlFor="settle-collector"
              required
              hint="من استلم المبلغ في جولته — يبقى المبلغ في عهدته حتى تسليمه."
            >
              {collectors.length === 0 ? (
                <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                  لا توجد حسابات موظفين فعّالة لاختيار محصّل منها.
                </p>
              ) : (
                <Select value={collectedById} onValueChange={setCollectedById}>
                  <SelectTrigger id="settle-collector">
                    <SelectValue placeholder="اختر المحصّل…" />
                  </SelectTrigger>
                  <SelectContent>
                    {collectors.map((collector) => (
                      <SelectItem key={collector.id} value={collector.id}>
                        {collector.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          ) : null}

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
            onClick={() =>
              onSubmit({
                method,
                amount: received,
                whishTransactionRef: isWhish ? reference.trim() : undefined,
                collectedById: isCollector ? collectedById : undefined,
                note: note.trim() || undefined,
              })
            }
          >
            {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            تسجيل {formatLbp(valid ? received : 0)}{' '}
            {isWhish ? 'تحويلاً' : method === 'COLLECTOR' ? 'عبر المحصّل' : 'نقداً'}
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
