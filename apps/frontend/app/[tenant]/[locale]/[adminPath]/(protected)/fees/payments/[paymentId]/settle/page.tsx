'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Banknote,
  CreditCard,
  Loader2,
  UserCheck,
} from 'lucide-react';
import {
  ApiRequestError,
  getCitizenProfile,
  getMunicipalitySettings,
  getPaymentById,
  getStaff,
  getTenantConfig,
  logApiError,
  settlePayment,
} from '@/lib/api-client';
import type {
  AdminPaymentItem,
  CitizenProfile,
  CitizenProfilePayment,
  MunicipalitySettings,
  StaffSummary,
} from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { formatLbp } from '@/lib/currency';
import { formatDate } from '@/lib/dates';
import { PaymentReceipt } from '@/components/admin/payment-receipt';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChoiceCard, Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorState } from '@/components/ui/states';
import { Textarea } from '@/components/ui/textarea';

/**
 * The two ways money reaches the municipality, plus the collector's round.
 *
 * All three go straight to PAID — the distinction is what is being recorded,
 * not whether it needs verifying. A clerk choosing Whish is stating they have
 * already seen the transfer land, which is precisely the check PENDING_REVIEW
 * performs for a citizen's own unverified claim.
 */
const METHODS = [
  { value: 'CASH', title: 'نقداً', description: 'مبلغ استُلم في البلدية', icon: Banknote },
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

type Method = (typeof METHODS)[number]['value'];

/**
 * تسجيل دفعة — its own page rather than a dialog opened from the ledger row.
 *
 * A dialog over a table works until the table is a phone screen: `sm:max-w-md`
 * on a 375px viewport left barely a hand's width of margin on every side, the
 * payment method cards stacked into a scroll before the amount field was even
 * visible, and the submit button — the one control that matters — sat behind
 * whatever the keyboard was covering the moment someone tapped the amount.
 * None of that is a spacing fix; it is the wrong container for the content.
 *
 * A full page fixes the container and, as a consequence, fixes reachability
 * too: this loads by `paymentId` alone (`getPaymentById`), so a link, a
 * bookmark, or a receipt's own "عدّل الدفعة" can point straight at it — a
 * dialog driven by a row already in a loaded table could only ever be opened
 * from that table.
 *
 * The amount defaults to the outstanding balance and caps at it, exactly as
 * the dialog did: the balance, not the invoice's face value, is what a partial
 * payment is measured against, or a part-settled invoice could be charged
 * twice. Recording still ends the same way — straight into the printed
 * receipt, with no PENDING_REVIEW detour, because a clerk selecting a method
 * here is asserting they have already seen the money.
 */
export default function SettlePaymentPage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string; paymentId: string }>;
}) {
  const { tenant, locale, adminPath, paymentId } = use(params);
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;

  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payment, setPayment] = useState<AdminPaymentItem | null>(null);
  const [collectors, setCollectors] = useState<StaffSummary[]>([]);

  const [municipalityName, setMunicipalityName] = useState('');
  const [settings, setSettings] = useState<MunicipalitySettings | null>(null);

  const [method, setMethod] = useState<Method>('CASH');
  const [reference, setReference] = useState('');
  const [collectedById, setCollectedById] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /** The receipt for what was just recorded, opened the moment the write lands. */
  const [receipt, setReceipt] = useState<{
    citizen: CitizenProfile;
    payment: CitizenProfilePayment;
    received: number;
  } | null>(null);

  const load = useCallback(async () => {
    const session = loadSession(tenant);
    if (!session || session.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }
    const accessToken = session.accessToken;
    setToken(accessToken);
    setLoading(true);
    setLoadError(null);

    try {
      const row = await getPaymentById(tenant, accessToken, paymentId);
      setPayment(row);
      // Digits only: the amount field is `inputMode="numeric"` with no
      // separators, so a grouped default would have to be stripped again on
      // the first keystroke.
      setAmount(String(Math.round(row.remaining)));
    } catch (caught) {
      logApiError(caught);
      if (caught instanceof ApiRequestError && caught.status === 401) {
        clearSession(tenant);
        router.replace(`${base}/login`);
        return;
      }
      setLoadError(
        caught instanceof ApiRequestError && caught.status === 404
          ? 'لا توجد مطالبة بهذا المعرّف — قد تكون حُذفت أو أُدخل رابط غير صحيح.'
          : 'تعذّر تحميل بيانات المطالبة.',
      );
      return;
    } finally {
      setLoading(false);
    }

    // Every one of these three only feeds the receipt or the محصّل picker —
    // never the record that is actually written — so a failure here degrades
    // what gets printed rather than blocking the page.
    getStaff(tenant, accessToken)
      .then(({ items }) => setCollectors(items))
      .catch(() => setCollectors([]));
    getTenantConfig(tenant)
      .then((config) => setMunicipalityName(config.nameAr || config.name))
      .catch(() => setMunicipalityName(tenant));
    getMunicipalitySettings(tenant, accessToken)
      .then(setSettings)
      .catch(() => setSettings(null));
  }, [tenant, base, paymentId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          جارٍ التحميل…
        </p>
      </div>
    );
  }

  if (loadError || !payment) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-10 sm:px-6">
        <ErrorState description={loadError ?? undefined} onRetry={() => void load()} />
        <div className="flex justify-center">
          <Link
            href={`${base}/fees`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
            رجوع إلى الرسوم والمدفوعات
          </Link>
        </div>
      </div>
    );
  }

  const received = Number(amount.replace(/\D/g, '')) || 0;
  const isWhish = method === 'WHISH_MONEY';
  const isCollector = method === 'COLLECTOR';
  const missingReference = isWhish && reference.trim() === '';
  const missingCollector = isCollector && collectedById === '';
  const tooMuch = received > payment.remaining;
  const valid = received > 0 && !tooMuch && !missingReference && !missingCollector;
  const isPartial = received > 0 && received < payment.remaining;

  const submit = async () => {
    if (!token || !valid || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await settlePayment(tenant, token, payment.id, {
        method,
        amount: received,
        whishTransactionRef: isWhish ? reference.trim() : undefined,
        collectedById: isCollector ? collectedById : undefined,
        note: note.trim() || undefined,
      });

      // Straight into the receipt: a clerk who has just taken money needs the
      // paper in the citizen's hand before they walk away. The full profile is
      // fetched fresh rather than assembled from what this page already has,
      // because the printed receipt carries the property and household detail
      // that `AdminPaymentItem` was never meant to hold.
      const profile = await getCitizenProfile(tenant, token, payment.citizenId);
      const settled = profile.payments.find((row) => row.id === payment.id);
      if (settled) {
        setReceipt({ citizen: profile, payment: settled, received });
      } else {
        // The write succeeded even though the receipt could not be assembled —
        // going back to the ledger is correct here, not staying on a page
        // whose own numbers are now stale.
        router.push(`${base}/fees`);
      }
    } catch (caught) {
      logApiError(caught);
      setSubmitError(
        caught instanceof ApiRequestError ? caught.message : 'تعذّر تسجيل الدفعة.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:pb-10">
      <Link
        href={`${base}/fees`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
        رجوع إلى الرسوم والمدفوعات
      </Link>

      <PageHeader
        icon={Banknote}
        title="تسجيل دفعة"
        subtitle={`${payment.title} — ${payment.citizenName}`}
      />

      {submitError ? (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {submitError}
        </p>
      ) : null}

      {/*
        Two columns from lg, one below it. The summary is what a dialog buried
        in a scrolling `<dl>` above the fold — here it gets its own sticky rail,
        visible the whole time the form is being filled rather than scrolled
        past the moment the method cards appear.
      */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="space-y-6">
          <Field label="طريقة الدفع" htmlFor="settle-method" required>
            <div className="grid gap-3 sm:grid-cols-3">
              {METHODS.map((option) => (
                <ChoiceCard
                  key={option.value}
                  name="settle-method"
                  value={option.value}
                  checked={method === option.value}
                  onChange={(next) => {
                    setMethod(next as Method);
                    // Each method carries exactly one extra fact; switching
                    // away drops the other's so the form never shows a value it
                    // will not send.
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
                    {collectors
                      .filter((collector) => collector.isActive)
                      .map((collector) => (
                        <SelectItem key={collector.id} value={collector.id}>
                          {collector.fullName}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          ) : null}

          {/*
            The amount, given a whole card of its own rather than one more
            field in a stack — it is the number every other control on this
            page exists to qualify, and on a page (unlike a squeezed dialog)
            there is room to say so.
          */}
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
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
                className="text-start text-2xl font-bold tabular-nums"
                invalid={tooMuch}
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))}
              />
            </Field>

            {/* Quick splits: "half" is the commonest partial by a mile, and
                typing 2,750,000 by hand invites a slipped digit. */}
            {payment.remaining > 1 ? (
              <div className="mt-3 flex flex-wrap gap-2">
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
              <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                دفعة جزئية — سيبقى{' '}
                <span className="font-semibold">
                  {formatLbp(payment.remaining - received)}
                </span>{' '}
                مستحقاً على هذه المطالبة.
              </p>
            ) : null}
          </div>

          <Field label="ملاحظة" htmlFor="settle-note" hint="اختياري — تظهر في سجل الدفعة">
            <Textarea
              id="settle-note"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>

          {/*
            The primary action, kept in normal flow here and repeated in the
            sticky bar below. From `lg` the sticky bar is hidden (there is
            always room to see this one), so the two never show at once.
          */}
          <div className="hidden lg:block">
            <SubmitRow
              method={method}
              amount={received}
              valid={valid}
              submitting={submitting}
              onSubmit={() => void submit()}
            />
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <div className="space-y-3 rounded-2xl border bg-muted/30 p-5">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                المطالبة
              </p>
              <p className="font-semibold leading-snug">{payment.title}</p>
              {payment.frequency ? (
                <Badge variant="soft-muted" className="mt-1">
                  {payment.frequency}
                </Badge>
              ) : null}
            </div>

            <dl className="space-y-1.5 border-t pt-3 text-sm">
              <Row label="المواطن" value={payment.citizenName} />
              {payment.citizenReference ? (
                <Row label="الرقم المرجعي" value={payment.citizenReference} mono />
              ) : null}
              <Row label="تاريخ الاستحقاق" value={formatDate(payment.dueDate)} />
            </dl>

            <dl className="space-y-1.5 border-t pt-3 text-sm">
              <Row label="قيمة المطالبة" value={formatLbp(payment.amount)} />
              {payment.paidAmount > 0 ? (
                <Row label="المسدَّد سابقاً" value={formatLbp(payment.paidAmount)} />
              ) : null}
              <Row label="الرصيد المستحق" value={formatLbp(payment.remaining)} strong />
            </dl>
          </div>

          {/*
            What is about to be written, named plainly rather than left for the
            clerk to compute from the form above. On the dialog this same
            information was implicit in the button's own label; here, with the
            button itself living in a sticky bar a scroll away on a phone, it
            gets a line of its own.
          */}
          {received > 0 ? (
            <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4 text-sm">
              <p className="text-muted-foreground">سيُسجَّل الآن</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{formatLbp(received)}</p>
              <p className="mt-0.5 text-muted-foreground">
                {isWhish ? 'تحويلاً عبر Whish' : isCollector ? 'عبر المحصّل' : 'نقداً'}
              </p>
            </div>
          ) : null}
        </aside>
      </div>

      {/*
        Sticky bottom bar, `lg:hidden`. This is the direct fix for the dialog's
        worst failure on a phone: the one button that matters sitting behind
        whatever the on-screen keyboard was covering the moment the amount
        field was focused. Pinned to the viewport instead of to the end of a
        scrolling form, it is reachable regardless of scroll position or
        keyboard state.
      */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur supports-[backdrop-filter]:bg-card/85 lg:hidden">
        <div className="mx-auto max-w-4xl">
          <SubmitRow
            method={method}
            amount={received}
            valid={valid}
            submitting={submitting}
            onSubmit={() => void submit()}
            fullWidth
          />
        </div>
      </div>

      <PaymentReceipt
        open={receipt !== null}
        onOpenChange={(next) => {
          if (!next) {
            setReceipt(null);
            router.push(`${base}/fees`);
          }
        }}
        citizen={receipt?.citizen ?? ({} as CitizenProfile)}
        payment={receipt?.payment ?? null}
        municipalityName={municipalityName}
        contactPhone={settings?.contactPhone}
        officeWhatsapp={settings?.whatsappNumber}
        receivedAmount={receipt?.received}
      />
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  mono,
}: {
  label: string;
  value: string;
  strong?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={
          strong
            ? 'font-semibold tabular-nums'
            : mono
              ? 'font-mono text-xs'
              : 'tabular-nums'
        }
        dir={mono ? 'ltr' : undefined}
      >
        {value}
      </dd>
    </div>
  );
}

/** The submit button, identical wherever it appears — in flow on desktop,
 *  pinned to the viewport on a phone. */
function SubmitRow({
  method,
  amount,
  valid,
  submitting,
  onSubmit,
  fullWidth,
}: {
  method: Method;
  amount: number;
  valid: boolean;
  submitting: boolean;
  onSubmit: () => void;
  fullWidth?: boolean;
}) {
  const how = method === 'WHISH_MONEY' ? 'تحويلاً' : method === 'COLLECTOR' ? 'عبر المحصّل' : 'نقداً';
  return (
    <Button
      size="lg"
      className={fullWidth ? 'w-full' : undefined}
      disabled={!valid || submitting}
      onClick={onSubmit}
    >
      {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      تسجيل {formatLbp(valid ? amount : 0)} {how}
    </Button>
  );
}
