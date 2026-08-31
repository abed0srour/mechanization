'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Home,
  Layers,
  MapPin,
  Receipt,
  Ruler,
  Tent,
  Trees,
} from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import { ApiRequestError, getMySummary, logApiError } from '@/lib/api-client';
import type { MyCitizenSummary } from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { formatLbp } from '@/lib/currency';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { LoadingState } from '@/components/ui/states';

/** One glyph per property branch, so a card's kind reads before its text. */
const PROPERTY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  BUILDING: Building2,
  HOUSE: Home,
  LAND: Trees,
  TENT: Tent,
};

/**
 * A citizen's own record: their registered properties, and what they owe.
 *
 * This page used to be «طلباتي» — a list of submissions, each with a review
 * status, a rejection notice and a «تصحيح وإعادة التقديم» button. None of that
 * has a subject any more: records are entered by municipality staff from
 * documents handed over a counter, so there is no submission of the citizen's
 * own to be adjudicated, no decision to report back, and no field for them to
 * be asked to fix.
 *
 * What is left is the two things a citizen can actually act on — confirming
 * the municipality has their property recorded correctly, and paying what is
 * due. The رقم مرجعي stays prominent because it is what they quote at the
 * counter, and it is now the way to raise a correction: in person.
 */
export default function MyAccount({
  params,
}: {
  params: Promise<{ tenant: string; locale: string }>;
}) {
  const { tenant, locale } = use(params);
  const router = useRouter();

  const [summary, setSummary] = useState<MyCitizenSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const session = loadSession(tenant);
    if (!session) {
      router.replace(`/${tenant}/${locale}/login`);
      return;
    }

    getMySummary(tenant, session.accessToken)
      .then(setSummary)
      .catch((caught: unknown) => {
        logApiError(caught);
        // An expired token is the common case, not an error worth alarming
        // someone with — send them back to sign in.
        if (caught instanceof ApiRequestError && caught.status === 401) {
          clearSession(tenant);
          router.replace(`/${tenant}/${locale}/login`);
          return;
        }
        setError('تعذّر تحميل بياناتك. حاول مرة أخرى.');
      });
  }, [tenant, locale, router]);

  const unpaid = summary?.payments.filter((payment) => payment.paymentStatus !== 'PAID') ?? [];

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">حسابي</h1>
          {summary ? <p className="text-muted-foreground">أهلاً {summary.fullName}</p> : null}
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

      {summary === null && !error ? (
        <LoadingState />
      ) : null}

      {summary ? (
        <>
          {/* The رقم مرجعي leads: it is the one thing they need in hand at the
              municipality, and the only identifier that survives a lost phone. */}
          {summary.referenceNumber ? (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="space-y-1 p-5">
                <p className="text-sm text-muted-foreground">رقمك المرجعي</p>
                <p className="text-2xl font-bold tracking-widest text-primary" dir="ltr">
                  {summary.referenceNumber}
                </p>
                <p className="pt-1 text-sm text-muted-foreground">
                  اذكر هذا الرقم عند مراجعة البلدية.
                </p>
              </CardContent>
            </Card>
          ) : null}

          {/* ── What they owe ─────────────────────────────────────────── */}
          <section className="space-y-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Receipt className="size-5 text-primary" aria-hidden />
              الرسوم المستحقة
            </h2>

            {summary.payments.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  لا توجد رسوم مسجّلة عليك.
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="space-y-4 p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-sm text-muted-foreground">المجموع غير المسدَّد</span>
                    <Money
                      amount={summary.fees.outstandingTotal}
                      className="text-2xl font-bold"
                    />
                  </div>

                  {summary.fees.overdueTotal > 0 ? (
                    <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                      منها {formatLbp(summary.fees.overdueTotal)} تجاوزت تاريخ الاستحقاق.
                    </p>
                  ) : null}

                  {unpaid.length > 0 ? (
                    <ul className="divide-y rounded-lg border">
                      {unpaid.slice(0, 4).map((payment) => (
                        <li
                          key={payment.id}
                          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3 text-sm"
                        >
                          <span className="min-w-0 truncate">{payment.title}</span>
                          <span className="flex shrink-0 items-center gap-2">
                            {payment.paymentStatus === 'OVERDUE' ? (
                              <Badge variant="destructive">متأخرة</Badge>
                            ) : null}
                            <Money amount={payment.amount} exact className="font-medium" />
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <Link
                    href={`/${tenant}/${locale}/payments`}
                    className={buttonVariants({ size: 'lg', className: 'w-full' })}
                  >
                    عرض الفواتير والدفع
                  </Link>
                </CardContent>
              </Card>
            )}
          </section>

          {/* ── What the municipality has on file ─────────────────────── */}
          <section className="space-y-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Building2 className="size-5 text-primary" aria-hidden />
              عقاراتي ({summary.properties.length})
            </h2>

            {summary.properties.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  لا توجد عقارات مسجّلة باسمك. راجع البلدية لتسجيل عقارك.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {summary.properties.map((property) => {
                  const Icon = PROPERTY_ICON[property.propertyType] ?? Building2;
                  return (
                    <Card key={property.id}>
                      <CardContent className="flex items-start gap-3 p-4">
                        <span
                          aria-hidden
                          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                        >
                          <Icon className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <p className="font-semibold">
                            العقار رقم{' '}
                            <span dir="ltr" className="font-mono">
                              {property.propertyNumber}
                            </span>
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="secondary">
                              {ar.propertyType[property.propertyType as never] ??
                                property.propertyType}
                            </Badge>
                            <Badge
                              variant={
                                property.occupancyType === 'TENANT' ? 'warning' : 'outline'
                              }
                            >
                              {ar.occupancyType[property.occupancyType as never] ??
                                property.occupancyType}
                            </Badge>
                          </div>
                          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              <MapPin className="size-3.5 shrink-0" aria-hidden />
                              {property.neighborhood}
                            </span>
                            {property.unitArea != null ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Ruler className="size-3.5 shrink-0" aria-hidden />
                                {property.unitArea} م²
                              </span>
                            ) : null}
                            {property.unitCount > 0 ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Layers className="size-3.5 shrink-0" aria-hidden />
                                {property.unitCount} وحدة
                              </span>
                            ) : null}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/*
              The correction path, stated plainly. A citizen who spots a wrong
              area or a wrong الحي used to have an online form for it; now the
              only way to change a record is the office that entered it, so
              saying so here beats leaving them to hunt for a button.
            */}
            <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              إذا لاحظت خطأً في بياناتك أو عقاراتك، يرجى مراجعة البلدية مع رقمك المرجعي
              لتصحيحها.
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}
