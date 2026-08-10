'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  Building2,
  CalendarDays,
  Clock,
  CreditCard,
  IdCard,
  Loader2,
  LogOut,
  MessageSquareWarning,
  Wallet,
} from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import {
  ApiRequestError,
  getMyPayments,
  getMySummary,
  logApiError,
  startWhishCheckout,
} from '@/lib/api-client';
import type { CitizenPaymentItem, MyCitizenSummary } from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { formatLbp } from '@/lib/currency';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** A bill is settled, or it is not — everything else is a shade of "not". */
function isSettled(payment: CitizenPaymentItem): boolean {
  return payment.paymentStatus === 'PAID';
}

/**
 * ملفّي — a citizen's whole record on one page.
 *
 * Everything a citizen needs from the municipality, in the order they ask for
 * it: who they are, what they owe, anything the office wrote back to them, the
 * bills still open, the ones settled, and the properties in their name.
 *
 * Purely a *view*. It carries no way in — the landing page owns that, and a
 * visitor arriving here without a session is sent back to it. Holding a second
 * sign-in form here would mean two sets of rules for one act, and the citizen
 * who typed the URL directly would meet the stricter one, which is backwards.
 *
 * Declaring a payment stays on `/payments`, next to the Whish instructions it
 * needs. This page reports; that one acts.
 */
export default function MyFilePage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string }>;
}) {
  const { tenant, locale } = use(params);
  const router = useRouter();
  const base = `/${tenant}/${locale}`;

  const [token, setToken] = useState<string | null>(null);
  const [summary, setSummary] = useState<MyCitizenSummary | null>(null);
  const [payments, setPayments] = useState<CitizenPaymentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);

  /**
   * The way in is the landing page, not this one.
   *
   * This page used to carry its own رقم مرجعي + phone form. Now that the front
   * door asks for the reference and nothing else, a second form here would be a
   * second set of rules for the same act — and the one a citizen reached by
   * typing the URL directly would be the stricter of the two, which is exactly
   * backwards.
   */
  useEffect(() => {
    const session = loadSession(tenant);
    if (session?.user.kind === 'CITIZEN') setToken(session.accessToken);
    else router.replace(base);
  }, [tenant, base, router]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [summaryResult, paymentsResult] = await Promise.all([
        getMySummary(tenant, token),
        getMyPayments(tenant, token),
      ]);
      setSummary(summaryResult);
      setPayments(paymentsResult.items);
      setError(null);
    } catch (caught) {
      logApiError(caught);
      if (caught instanceof ApiRequestError && caught.status === 401) {
        clearSession(tenant);
        router.replace(base);
        return;
      }
      setError('تعذّر تحميل ملفّك. يرجى المحاولة لاحقاً.');
    } finally {
      setLoading(false);
    }
  }, [tenant, token, base, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = useCallback(() => {
    clearSession(tenant);
    router.replace(base);
  }, [tenant, base, router]);

  /**
   * Starts an online Whish payment for one bill.
   *
   * Navigates with `window.location` rather than the router because the
   * destination is the provider's own domain once credentials are configured —
   * Next's router cannot leave the app. In sandbox the server hands back a URL
   * inside the portal, so the same line simply reloads this page with the
   * invoice now awaiting confirmation.
   */
  const payWithWhish = useCallback(
    async (paymentId: string) => {
      if (!token) return;
      setPayingId(paymentId);
      setError(null);
      try {
        const { redirectUrl } = await startWhishCheckout(tenant, token, paymentId);
        window.location.href = redirectUrl;
      } catch (caught) {
        logApiError(caught);
        setError(
          caught instanceof ApiRequestError ? caught.message : 'تعذّر بدء الدفع عبر Whish.',
        );
        setPayingId(null);
      }
    },
    [tenant, token],
  );

  // Nothing to show until the redirect above resolves, or while the first
  // load is in flight — both are a blank frame, not a state worth drawing.
  if (!token) return null;

  // ── The record ──
  if (loading && !summary) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-hidden />
        جارٍ تحميل ملفّك…
      </div>
    );
  }

  const outstanding = payments.filter((payment) => !isSettled(payment));
  const settled = payments.filter(isSettled);
  const notes = payments.filter((payment) => payment.reviewNote);

  return (
    <div className="space-y-6">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive"
        >
          {error}
        </p>
      ) : null}

      {/* ── Who this is ── */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-6">
          <span
            aria-hidden
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <IdCard className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold tracking-tight">
              {summary?.fullName ?? '—'}
            </h1>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {summary?.referenceNumber ? (
                <span className="font-mono" dir="ltr">
                  {summary.referenceNumber}
                </span>
              ) : null}
              {summary?.registeredAt ? (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="size-3.5" aria-hidden />
                  مسجّل منذ {new Date(summary.registeredAt).toLocaleDateString('ar-LB')}
                </span>
              ) : null}
            </p>
          </div>
          <Button variant="outline" onClick={signOut}>
            <LogOut className="size-4" aria-hidden />
            خروج
          </Button>
        </CardContent>
      </Card>

      {/* ── What is owed, at a glance ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="المستحق عليك"
          value={formatLbp(summary?.fees.outstandingTotal ?? 0)}
          icon={<Wallet className="size-5" aria-hidden />}
          tone={
            (summary?.fees.outstandingTotal ?? 0) > 0 ? 'destructive' : 'success'
          }
        />
        <StatCard
          label="المسدَّد"
          value={formatLbp(summary?.fees.paidTotal ?? 0)}
          icon={<BadgeCheck className="size-5" aria-hidden />}
          tone="success"
        />
        <StatCard
          label="متأخّرات"
          value={formatLbp(summary?.fees.overdueTotal ?? 0)}
          hint={
            (summary?.fees.overdueCount ?? 0) > 0
              ? `${summary?.fees.overdueCount} مطالبة تجاوزت موعدها`
              : 'لا متأخّرات'
          }
          icon={<Clock className="size-5" aria-hidden />}
          tone={(summary?.fees.overdueTotal ?? 0) > 0 ? 'destructive' : undefined}
        />
      </div>

      {/* ── Notes from the municipality ── */}
      {notes.length > 0 ? (
        <Card className="border-warning/50 ring-1 ring-warning/20">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <MessageSquareWarning className="size-5 text-warning" aria-hidden />
              ملاحظات من البلدية
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {notes.map((payment) => (
                <li key={payment.id} className="space-y-1 p-4">
                  <p className="text-sm font-medium">{payment.title}</p>
                  <p className="text-sm text-muted-foreground">{payment.reviewNote}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Bills still open ── */}
      <PaymentList
        title="رسوم مستحقة عليك"
        icon={Wallet}
        items={outstanding}
        empty="لا توجد رسوم مستحقة — ملفّك مسدَّد بالكامل."
        onPay={payWithWhish}
        payingId={payingId}
      />

      {/* ── Bills settled ── */}
      <PaymentList
        title="رسوم سدّدتها"
        icon={BadgeCheck}
        items={settled}
        empty="لم تُسجَّل أي دفعة بعد."
      />

      {/* ── What is registered in their name ── */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="size-5" aria-hidden />
            عقاراتك المسجّلة {summary ? `(${summary.properties.length})` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!summary || summary.properties.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">لا توجد عقارات مسجّلة.</p>
          ) : (
            <ul className="divide-y">
              {summary.properties.map((property) => (
                <li
                  key={property.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">
                      {ar.propertyType[property.propertyType as never] ??
                        property.propertyType}
                      {property.buildingName ? ` — ${property.buildingName}` : ''}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {property.neighborhood} · رقم العقار{' '}
                      <span className="font-mono" dir="ltr">
                        {property.propertyNumber}
                      </span>
                    </p>
                  </div>
                  <Badge variant="secondary">
                    {ar.occupancyType[property.occupancyType as never] ??
                      property.occupancyType}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="pb-4 text-center text-sm text-muted-foreground">
        للاستفسار أو الاعتراض على أي مبلغ، يرجى مراجعة البلدية.
      </p>
    </div>
  );
}

/** One headline figure. */
function StatCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone?: 'destructive' | 'success';
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p
            className={cn(
              'truncate text-xl font-bold tabular-nums',
              tone === 'destructive' && 'text-destructive',
              tone === 'success' && 'text-success',
            )}
          >
            {value}
          </p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <span
          aria-hidden
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg',
            tone === 'destructive'
              ? 'bg-destructive/10 text-destructive'
              : tone === 'success'
                ? 'bg-success/10 text-success'
                : 'bg-accent text-muted-foreground',
          )}
        >
          {icon}
        </span>
      </CardContent>
    </Card>
  );
}

/**
 * One list of bills.
 *
 * Shared by the owed and the settled sections so a citizen reads the same row
 * shape twice rather than learning two layouts for the same fact.
 */
function PaymentList({
  title,
  icon: Icon,
  items,
  empty,
  onPay,
  payingId,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: CitizenPaymentItem[];
  empty: string;
  /** Omitted on the settled list — there is nothing left to pay there. */
  onPay?: (paymentId: string) => void;
  payingId?: string | null;
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Icon className="size-5" aria-hidden />
          {title} {items.length > 0 ? `(${items.length})` : ''}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y">
            {items.map((payment) => {
              const settled = isSettled(payment);
              const partly = !settled && payment.paidAmount > 0;
              return (
                <li
                  key={payment.id}
                  // Stacks on a phone and only becomes a row from `sm` up: the
                  // amount and its badge were wrapping under the title at 360px
                  // and reading as a second bill.
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">{payment.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {settled && payment.paidAt ? (
                        <>سُدّد في {new Date(payment.paidAt).toLocaleDateString('ar-LB')}</>
                      ) : (
                        <>
                          استحقاق {new Date(payment.dueDate).toLocaleDateString('ar-LB')}
                          {partly
                            ? ` · سدّدت ${formatLbp(payment.paidAmount)} من ${formatLbp(payment.amount)}`
                            : ''}
                        </>
                      )}
                      {settled && payment.paymentMethod
                        ? ` · ${ar.paymentMethod[payment.paymentMethod as never] ?? ''}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums">
                      {formatLbp(settled ? payment.amount : payment.remaining)}
                    </span>
                    <Badge
                      variant="outline"
                      className={
                        payment.paymentStatus === 'PAID'
                          ? 'border-success/40 bg-success/10 text-success'
                          : payment.paymentStatus === 'OVERDUE'
                            ? 'border-destructive/40 bg-destructive/10 text-destructive'
                            : payment.paymentStatus === 'PENDING_REVIEW'
                              ? 'border-warning/40 bg-warning/10 text-warning'
                              : 'text-muted-foreground'
                      }
                    >
                      {ar.paymentStatus[payment.paymentStatus as never] ??
                        payment.paymentStatus}
                    </Badge>

                    {/* Offered only where it can do something: a bill already
                        awaiting confirmation would start a second checkout
                        against money that may have already moved. */}
                    {onPay && payment.paymentStatus !== 'PENDING_REVIEW' ? (
                      <Button
                        size="sm"
                        className="w-full sm:w-auto"
                        disabled={payingId === payment.id}
                        onClick={() => onPay(payment.id)}
                      >
                        {payingId === payment.id ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <CreditCard className="size-4" aria-hidden />
                        )}
                        ادفع عبر Whish
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
