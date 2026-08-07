'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  Receipt,
  Wallet,
  XCircle,
} from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import {
  ApiRequestError,
  declarePayment,
  getMunicipalitySettings,
  getMyPayments,
  logApiError,
} from '@/lib/api-client';
import type { CitizenPaymentItem, MunicipalitySettings } from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { Badge } from '@/components/ui/badge';
import { PaymentStatusBadge } from '@/components/payment-status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PayDialog } from '@/components/citizen/pay-dialog';
import { cn } from '@/lib/utils';

function lbp(amount: number): string {
  return `${amount.toLocaleString('en-US')} ل.ل`;
}

/*
 * `STATUS_TONE` and `STATUS_ICON` were here — this screen's own copy of the
 * payment-status vocabulary, on hardcoded palette colours that never responded
 * to the theme, and the one copy that never received the dark-mode correction
 * its admin-side twin had. Both now come from `PaymentStatusBadge`, so the
 * resident and the clerk are looking at the same four colours.
 */

/** A resident's own bills, and how to settle them. */
export default function CitizenPayments({
  params,
}: {
  params: Promise<{ tenant: string; locale: string }>;
}) {
  const { tenant, locale } = use(params);
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [items, setItems] = useState<CitizenPaymentItem[]>([]);
  const [settings, setSettings] = useState<MunicipalitySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [paying, setPaying] = useState<CitizenPaymentItem | null>(null);
  const [declaring, setDeclaring] = useState(false);
  const [declareError, setDeclareError] = useState<string | null>(null);

  useEffect(() => {
    const session = loadSession(tenant);
    if (!session || session.user.kind !== 'CITIZEN') {
      router.replace(`/${tenant}/${locale}/payments/login`);
      return;
    }
    setToken(session.accessToken);
    setName(session.user.name);
  }, [tenant, locale, router]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [paymentsResult, settingsResult] = await Promise.all([
        getMyPayments(tenant, token),
        getMunicipalitySettings(tenant, token),
      ]);
      setItems(paymentsResult.items);
      setSettings(settingsResult);
      setError(null);
    } catch (caught) {
      logApiError(caught);
      if (caught instanceof ApiRequestError && caught.status === 401) {
        clearSession(tenant);
        router.replace(`/${tenant}/${locale}/payments/login`);
        return;
      }
      setError('تعذّر تحميل مستحقاتك.');
    } finally {
      setLoading(false);
    }
  }, [tenant, token, locale, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitDeclaration = useCallback(
    async (input: { method: string; whishTransactionRef?: string }) => {
      if (!token || !paying) return;
      setDeclaring(true);
      setDeclareError(null);
      try {
        await declarePayment(tenant, token, paying.id, input);
        setPaying(null);
        await load();
      } catch (caught) {
        logApiError(caught);
        setDeclareError(
          caught instanceof ApiRequestError ? caught.message : 'تعذّر تسجيل الدفعة.',
        );
      } finally {
        setDeclaring(false);
      }
    },
    [tenant, token, paying, load],
  );

  if (!token) return null;

  const outstanding = items.filter(
    (item) => item.paymentStatus === 'UNPAID' || item.paymentStatus === 'OVERDUE',
  );
  const unpaidTotal = outstanding.reduce((total, item) => total + item.amount, 0);
  const paidTotal = items
    .filter((item) => item.paymentStatus === 'PAID')
    .reduce((total, item) => total + item.amount, 0);
  const nextDue = outstanding
    .map((item) => item.dueDate)
    .sort()
    .at(0);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Receipt className="size-7 text-primary" aria-hidden />
            الرسوم والمدفوعات
          </h1>
          {name ? <p className="text-muted-foreground">أهلاً {name}</p> : null}
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            clearSession(tenant);
            router.push(`/${tenant}/${locale}`);
          }}
        >
          خروج
        </Button>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="إجمالي المستحقات"
          value={lbp(unpaidTotal)}
          icon={<Wallet className="size-6" aria-hidden />}
          tone={unpaidTotal > 0 ? 'text-destructive' : 'text-muted-foreground'}
          loading={loading}
        />
        <SummaryCard
          label="أقرب موعد استحقاق"
          value={nextDue ? new Date(nextDue).toLocaleDateString('ar-LB') : '—'}
          icon={<CalendarClock className="size-6" aria-hidden />}
          loading={loading}
        />
        <SummaryCard
          label="إجمالي المسدّد"
          value={lbp(paidTotal)}
          icon={<BadgeCheck className="size-6" aria-hidden />}
          tone="text-success"
          loading={loading}
        />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">مطالباتي</h2>

        {loading ? <p className="text-muted-foreground">جارٍ التحميل…</p> : null}

        {!loading && items.length === 0 ? (
          <Card>
            <CardContent className="space-y-2 p-8 text-center">
              <CheckCircle2 className="mx-auto size-8 text-success" aria-hidden />
              <p className="text-lg font-medium">لا توجد رسوم مستحقة عليك.</p>
              <p className="text-sm text-muted-foreground">
                ستظهر هنا أي رسوم تصدرها البلدية لاحقاً.
              </p>
            </CardContent>
          </Card>
        ) : null}

        <div className="space-y-3">
          {items.map((item) => {
            const payable =
              item.paymentStatus === 'UNPAID' || item.paymentStatus === 'OVERDUE';

            return (
              <Card key={item.id}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="font-semibold">{item.title}</p>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarClock className="size-3.5" aria-hidden />
                          استحقاق {new Date(item.dueDate).toLocaleDateString('ar-LB')}
                        </span>
                        {item.frequency ? (
                          <Badge variant="outline">
                            {ar.feeFrequency[item.frequency as never] ?? item.frequency}
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <p className="text-xl font-bold">{lbp(item.amount)}</p>
                      <PaymentStatusBadge status={item.paymentStatus} className="py-1" />
                    </div>
                  </div>

                  {/* A refused claim has to say why, or the citizen is left with
                      a bill they believed was settled and no explanation. */}
                  {item.reviewNote && item.paymentStatus !== 'PAID' ? (
                    <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                      <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                      {item.reviewNote}
                    </p>
                  ) : null}

                  {item.paymentStatus === 'PENDING_REVIEW' ? (
                    <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                      تم استلام إبلاغك بالدفع. سيؤكّده موظف البلدية بعد التحقق من وصول المبلغ.
                    </p>
                  ) : null}

                  {payable ? (
                    <div className="flex justify-end">
                      <Button size="sm" onClick={() => setPaying(item)}>
                        <Wallet className="size-4" aria-hidden />
                        ادفع الآن
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <PayDialog
        payment={paying}
        settings={settings}
        submitting={declaring}
        error={declareError}
        onOpenChange={(open) => {
          if (!open) {
            setPaying(null);
            setDeclareError(null);
          }
        }}
        onDeclare={(input) => void submitDeclaration(input)}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  tone = 'text-foreground',
  loading,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: string;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-5">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className={cn('truncate text-xl font-bold', tone)}>{loading ? '—' : value}</p>
        </div>
        <span className="rounded-lg bg-accent p-3 text-muted-foreground">{icon}</span>
      </CardContent>
    </Card>
  );
}
