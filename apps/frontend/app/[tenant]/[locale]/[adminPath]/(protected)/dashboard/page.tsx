'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  Banknote,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Download,
  Eye,
  FileText,
  Layers,
  Map as MapIcon,
  Receipt,
  RefreshCw,
  TrendingUp,
  TriangleAlert,
  Users,
  UsersRound,
  Wallet,
  XCircle,
} from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import {
  ApiRequestError,
  getDashboardAnalytics,
  logApiError,
} from '@/lib/api-client';
import type { DashboardAnalytics } from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { formatLbp } from '@/lib/currency';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Money } from '@/components/ui/money';
import {
  ChartCard,
  ColumnChart,
  GroupedColumnChart,
  StackedTrack,
  type SeriesKey,
} from '@/components/admin/charts';
import { cn } from '@/lib/utils';

/**
 * Household sizes are bucketed at 8: past that the bars are single households
 * and the distribution's shape is lost in a long tail of ones.
 */
const FAMILY_BUCKET_CAP = 8;

/** The review pipeline, in order. مرفوض is deliberately not in it. */
const PIPELINE = ['PENDING', 'UNDER_REVIEW', 'VERIFIED', 'APPROVED'] as const;

const STATUS_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  PENDING: Clock,
  UNDER_REVIEW: Eye,
  VERIFIED: BadgeCheck,
  APPROVED: CheckCircle2,
  REJECTED: XCircle,
};

/**
 * Picks one unit for a whole money axis.
 *
 * A y-axis reading `20,000,000 / 40,000,000` spends half the plot width on
 * zeros that are identical on every tick. Scaling the axis once and naming the
 * unit in the card's subtitle says the same thing in two characters — and it
 * is the only way an LBP axis fits on a tablet at all.
 */
function moneyAxis(max: number): { divisor: number; unit: string } {
  if (max >= 1_000_000_000) return { divisor: 1_000_000_000, unit: 'مليار ل.ل' };
  if (max >= 1_000_000) return { divisor: 1_000_000, unit: 'مليون ل.ل' };
  if (max >= 1_000) return { divisor: 1_000, unit: 'ألف ل.ل' };
  return { divisor: 1, unit: 'ل.ل' };
}

/** `2026-08` → `أغسطس` (+ the year, for the tooltip and the table). */
function monthLabels(month: string): { short: string; long: string } {
  const [year, index] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, (index ?? 1) - 1, 1));
  return {
    short: date.toLocaleDateString('ar-LB', { month: 'short', timeZone: 'UTC' }),
    long: date.toLocaleDateString('ar-LB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

/**
 * لوحة التحكم — the municipality's analytics overview.
 *
 * This screen used to be the review queue: one table row per طلب, with the
 * status transitions inline. It is now what a دفتر البلدية opens on — how many
 * people the municipality actually serves, what it is owed, what it has
 * collected, and where the review pipeline is congested. The per-record work
 * moved to the pages that own those records (the citizens registry, each
 * citizen's profile, the fees screen), and the shortcuts at the foot of this
 * page are the way into them.
 *
 * Everything on it comes from a single `/dashboard/analytics` call, so the
 * headline tiles and the charts underneath cannot contradict each other.
 */
export default function StaffDashboard({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;

  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | undefined>();
  const [data, setData] = useState<DashboardAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const session = loadSession(tenant);
    if (!session || session.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }
    setToken(session.accessToken);
    setRole(session.user.role);
  }, [tenant, base, router]);

  const load = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      setData(await getDashboardAnalytics(tenant, token));
      setError(null);
    } catch (caught) {
      logApiError(caught);
      if (caught instanceof ApiRequestError && caught.status === 401) {
        clearSession(tenant);
        router.replace(`${base}/login`);
        return;
      }
      setError('تعذّر تحميل بيانات اللوحة.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tenant, token, base, router]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Household sizes, bucketed, ordered, and zero-filled so gaps show as gaps. */
  const familyBuckets = useMemo(() => {
    if (!data) return [];
    const counts = new Map<number, number>();
    for (const entry of data.familySizes) {
      const bucket = Math.min(Math.max(entry.size, 1), FAMILY_BUCKET_CAP);
      counts.set(bucket, (counts.get(bucket) ?? 0) + entry.households);
    }
    return Array.from({ length: FAMILY_BUCKET_CAP }, (_, index) => {
      const size = index + 1;
      const capped = size === FAMILY_BUCKET_CAP;
      return {
        label: capped ? `${size}+` : String(size),
        title: capped ? `${size} أفراد فأكثر` : `${size} من الأفراد`,
        value: counts.get(size) ?? 0,
      };
    });
  }, [data]);

  const monthly = useMemo(() => {
    if (!data) return [];
    return data.monthly.map((entry) => {
      const { short, long } = monthLabels(entry.month);
      return {
        label: short,
        title: long,
        // Collected first, so it sits on the reader's starting (right) side.
        values: [entry.collected, entry.overdue],
      };
    });
  }, [data]);

  const moneyScale = useMemo(
    () => moneyAxis(Math.max(...monthly.flatMap((m) => m.values), 0)),
    [monthly],
  );

  const statusSegments = useMemo(() => {
    if (!data) return [];
    // The ordinal ramp, light → dark, in pipeline order: the stage reads out
    // of the colour itself, which a set of unrelated hues could not do.
    const ramp = ['--viz-step-1', '--viz-step-2', '--viz-step-3', '--viz-step-4'];
    return [
      ...PIPELINE.map((status, index) => ({
        label: ar.reportStatus[status] ?? status,
        value: data.byStatus[status] ?? 0,
        color: `var(${ramp[index]})`,
        icon: STATUS_ICON[status],
      })),
      {
        label: ar.reportStatus.REJECTED ?? 'REJECTED',
        value: data.byStatus.REJECTED ?? 0,
        color: 'var(--viz-critical)',
        icon: STATUS_ICON.REJECTED,
      },
    ];
  }, [data]);

  const collectionRate =
    data && data.billedTotal > 0 ? data.collectedTotal / data.billedTotal : 0;

  const trendSeries: SeriesKey[] = [
    { label: 'محصّل', color: 'var(--viz-series-1)' },
    { label: 'متأخر', color: 'var(--viz-series-2)' },
  ];

  if (!token) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col items-start justify-between gap-4 border-b pb-6 md:flex-row md:items-center">
        <div className="space-y-2">
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
            لوحة التحكم
            {role ? <Badge variant="secondary">{role}</Badge> : null}
          </h1>
          <p className="text-sm text-muted-foreground">
            مؤشرات البلدية: السكان، الرسوم والتحصيل، وحالة الطلبات
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {role === 'SUPER_ADMIN' || role === 'AUDITOR' ? (
            <a
              href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'}/t/${tenant}/dashboard/export.csv`}
              className={buttonVariants({ variant: 'outline' })}
            >
              <Download className="size-4" aria-hidden />
              تصدير CSV
            </a>
          ) : null}
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={refreshing}
            title="تحديث البيانات"
          >
            <RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
            تحديث
          </Button>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive"
        >
          {error}
        </p>
      ) : null}

      {/*
        The refresh holds the previous render at reduced opacity instead of
        dropping back to skeletons — a dashboard that flashes empty on every
        poll reads as broken, and the layout jump loses the reader's place.
      */}
      <div className={cn('space-y-8 transition-opacity', refreshing && 'opacity-60')}>
        {/* ── Headline ──────────────────────────────────────────────── */}
        <section className="grid gap-4 lg:grid-cols-3">
          {/*
            The hero figure, and the only one on this page. عدد السكان rather
            than the record count, because one registration speaks for a whole
            household — the record count understates the people served roughly
            fourfold, and it is the population a municipality budgets against.
          */}
          <div className="rounded-xl border bg-card p-6 shadow-sm lg:col-span-1">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="size-4 text-primary" aria-hidden />
              عدد السكان المسجّلين
            </p>
            {/* Proportional figures, not tabular: at 48px `tabular-nums` gives
                every digit a `0`'s width and the number reads loose. */}
            <p className="mt-2 text-5xl font-bold leading-none">
              {loading ? '—' : data!.populationTotal.toLocaleString('en-US')}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              مجموع أفراد الأسر في {data?.citizenRecords.toLocaleString('en-US') ?? '—'} أسرة
              مسجّلة
            </p>
            {/*
              Stated, not hidden. Households with no عدد أفراد الأسرة on file
              contribute zero to the figure above, so it is understated by at
              least this many people — a dashboard that rounded them away
              would be lying by omission.
            */}
            {data && data.householdsWithoutSize > 0 ? (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {data.householdsWithoutSize} أسرة بلا عدد أفراد مسجّل — الرقم أعلاه أقل من
                الواقع
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
            <StatTile
              label="إجمالي الرسوم"
              icon={<Receipt className="size-5 text-primary" aria-hidden />}
              value={data ? <Money amount={data.billedTotal} /> : '—'}
              note={`${data?.registrationTotal.toLocaleString('en-US') ?? '—'} طلب مسجّل`}
              loading={loading}
            />
            <StatTile
              label="المتأخرات"
              icon={<Banknote className="size-5 text-destructive" aria-hidden />}
              accent="bg-destructive/10"
              value={data ? <Money amount={data.overdueTotal} /> : '—'}
              note={
                data && data.overdueCount > 0
                  ? `${data.overdueCount} فاتورة تجاوزت تاريخ الاستحقاق`
                  : 'لا فواتير متأخرة'
              }
              loading={loading}
            />
            <StatTile
              label="المحصَّل"
              icon={<Wallet className="size-5 text-success" aria-hidden />}
              accent="bg-success/10"
              value={data ? <Money amount={data.collectedTotal} /> : '—'}
              note={
                data && data.pendingReviewCount > 0
                  ? `${data.pendingReviewCount} دفعة بانتظار التحقق`
                  : 'لا دفعات معلّقة'
              }
              loading={loading}
            />

            {/*
              A meter, not a fifth number: a rate against a limit is the one
              thing a bar reads better than a figure. The unfilled track is a
              lighter step of the fill's own ramp, so the state reads across
              the whole bar rather than only where it stops.
            */}
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <TrendingUp className="size-4 text-primary" aria-hidden />
                نسبة التحصيل
              </p>
              <p className="mt-2 text-2xl font-bold">
                {loading ? '—' : `${Math.round(collectionRate * 100)}%`}
              </p>
              <div
                role="meter"
                aria-valuenow={Math.round(collectionRate * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="نسبة التحصيل"
                className="mt-3 h-2.5 w-full overflow-hidden rounded-full"
                style={{ background: 'var(--viz-step-1)' }}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${Math.max(collectionRate * 100, 0)}%`,
                    background: 'var(--viz-step-4)',
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                غير مسدّد {data ? formatLbp(data.outstandingTotal) : '—'}
              </p>
            </div>
          </div>
        </section>

        {/* ── Charts ────────────────────────────────────────────────── */}
        <section className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="توزيع أحجام الأسر"
            description="عدد الأسر المسجّلة حسب عدد أفرادها"
            icon={UsersRound}
            table={{
              columns: ['عدد الأفراد', 'عدد الأسر'],
              rows: familyBuckets.map((bucket) => [
                bucket.title,
                bucket.value.toLocaleString('en-US'),
              ]),
            }}
          >
            <ColumnChart
              data={familyBuckets}
              color="var(--viz-series-1)"
              yLabel="عدد الأسر"
              formatValue={(value) => value.toLocaleString('en-US')}
            />
          </ChartCard>

          <ChartCard
            title="التحصيل والمتأخرات شهرياً"
            description={`آخر ٦ أشهر حسب تاريخ الاستحقاق — بـ${moneyScale.unit}`}
            icon={TrendingUp}
            series={trendSeries}
            table={{
              columns: ['الشهر', 'محصّل', 'متأخر'],
              rows: (data?.monthly ?? []).map((entry) => [
                monthLabels(entry.month).long,
                formatLbp(entry.collected),
                formatLbp(entry.overdue),
              ]),
            }}
          >
            <GroupedColumnChart
              data={monthly}
              series={trendSeries}
              yLabel={`المبالغ بـ${moneyScale.unit}`}
              formatValue={(value) => formatLbp(value)}
              formatTick={(value) =>
                (value / moneyScale.divisor).toLocaleString('en-US', {
                  maximumFractionDigits: 1,
                })
              }
            />
          </ChartCard>

          <ChartCard
            className="lg:col-span-2"
            title="حالات الطلبات"
            description="مسار المراجعة من قيد الانتظار حتى القبول، والمرفوض خارجه"
            icon={FileText}
            table={{
              columns: ['الحالة', 'عدد الطلبات'],
              rows: statusSegments.map((segment) => [
                segment.label,
                segment.value.toLocaleString('en-US'),
              ]),
            }}
          >
            <StackedTrack
              segments={statusSegments}
              total={data?.registrationTotal ?? 0}
              formatValue={(value) => value.toLocaleString('en-US')}
            />
          </ChartCard>
        </section>

        {/* ── Shortcuts ─────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">الانتقال السريع</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Shortcut
              href={`${base}/citizens`}
              icon={Users}
              title="المواطنون"
              description="السجل الكامل، الإضافة والتعديل"
            />
            <Shortcut
              href={`${base}/fees`}
              icon={Receipt}
              title="الرسوم والمدفوعات"
              description="إصدار الرسوم وتأكيد الدفعات"
            />
            <Shortcut
              href={`${base}/map`}
              icon={MapIcon}
              title="الخريطة"
              description="العقارات المسجّلة على السجل العقاري"
            />
            <Shortcut
              href={`${base}/zones`}
              icon={Layers}
              title="القطاعات"
              description="تقسيم البلدية إلى مناطق"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

/** One KPI tile: label, value, an accent icon chip, and a supporting line. */
function StatTile({
  label,
  value,
  note,
  icon,
  accent = 'bg-accent',
  loading,
}: {
  label: string;
  /** A node, so a money tile can hand it a compacting `<Money>`. */
  value: React.ReactNode;
  note: string;
  icon: React.ReactNode;
  accent?: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        {/* `min-w-0` on the text and `shrink-0` on the chip: an eight-figure
            total widens its own block rather than pushing the icon out. */}
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <div className="text-2xl font-bold">{loading ? '—' : value}</div>
        </div>
        <div className={`shrink-0 rounded-lg p-2.5 ${accent}`}>{icon}</div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

/** A card-sized link into the page that owns the records behind a number. */
function Shortcut({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-accent"
    >
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronLeft
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5 rtl:rotate-180 rtl:group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}
