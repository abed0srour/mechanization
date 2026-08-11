'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Banknote,
  BarChart3,
  Building,
  Building2,
  ChevronLeft,
  Download,
  Home,
  Layers,
  Map as MapIcon,
  Receipt,
  RefreshCw,
  Store,
  Stethoscope,
  Tent,
  Trees,
  TrendingUp,
  TriangleAlert,
  Users,
  UsersRound,
  Wallet,
} from 'lucide-react';
import {
  ApiRequestError,
  getDashboardAnalytics,
  logApiError,
} from '@/lib/api-client';
import type { DashboardAnalytics } from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { formatLbp } from '@/lib/currency';
import { formatMonth } from '@/lib/dates';
import { useSectionNav } from '@/lib/use-section-nav';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Money } from '@/components/ui/money';
import {
  ChartCard,
  ColumnChart,
  GroupedColumnChart,
  type SeriesKey,
} from '@/components/admin/charts';
import { cn } from '@/lib/utils';

/**
 * Household sizes are bucketed at 8: past that the bars are single households
 * and the distribution's shape is lost in a long tail of ones.
 */
const FAMILY_BUCKET_CAP = 8;

/** Sections the jump bar scrolls between. */
const SECTIONS = [
  { id: 'overview', label: 'المؤشرات', icon: TrendingUp },
  { id: 'units', label: 'الوحدات والعقارات', icon: Building2 },
  { id: 'analytics', label: 'التحليلات', icon: BarChart3 },
] as const;

const SECTION_IDS = SECTIONS.map((section) => section.id);

/**
 * The unit cards, in display order.
 *
 * `unitsByType` is keyed by `UnitType` (شقة / عيادة / محل) and
 * `propertiesByType` by `PropertyType` (مبنى / منزل / أرض / خيمة) — two
 * different enums, so each card names which of the two it reads. Labels are
 * spelled out here rather than taken from `ar.unitType` because these are
 * municipal-register categories ("مستوصف / عيادة"), which read differently
 * from the single word a citizen picks in a form.
 */
const UNIT_CARDS = [
  { source: 'unit', key: 'APARTMENT', label: 'شقق سكنية', icon: Building2 },
  { source: 'property', key: 'HOUSE', label: 'منازل مستقلة', icon: Home },
  { source: 'unit', key: 'SHOP', label: 'أقسام ووحدات تجارية', icon: Store },
  { source: 'unit', key: 'CLINIC', label: 'مستوصفات وعيادات', icon: Stethoscope },
  { source: 'property', key: 'BUILDING', label: 'مبانٍ مسجّلة', icon: Building },
  { source: 'property', key: 'LAND', label: 'أراضٍ', icon: Trees },
  { source: 'property', key: 'TENT', label: 'خيام', icon: Tent },
] as const;

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
    // `formatMonth`, not `formatDate`: a chart axis wants the Arabic month
    // name, and the only thing that changes here is that the year beside it is
    // now Latin like every other figure on the dashboard.
    short: formatMonth(date, { month: 'short', timeZone: 'UTC' }),
    long: formatMonth(date, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
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

  /** Resolves each unit card against whichever of the two maps it reads. */
  const unitCards = useMemo(
    () =>
      UNIT_CARDS.map((card) => ({
        ...card,
        value:
          (card.source === 'unit' ? data?.unitsByType : data?.propertiesByType)?.[card.key] ?? 0,
      })),
    [data],
  );

  const collectionRate =
    data && data.billedTotal > 0 ? data.collectedTotal / data.billedTotal : 0;

  const trendSeries: SeriesKey[] = [
    { label: 'محصّل', color: 'var(--viz-series-1)' },
    { label: 'متأخر', color: 'var(--viz-series-2)' },
  ];

  // Re-observed once data lands: the sections keep their ids, but the page
  // grows by several hundred pixels when the cards fill in, and a stale
  // observer would highlight against the empty layout.
  const { active, jumpTo } = useSectionNav(SECTION_IDS, [data !== null]);

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

      {/*
        Jump links. The page is four screens tall on a laptop, and the section
        an admin wants is rarely the one at the top — so the bar both says
        where they are and gets them there. The last entry leaves the page
        entirely: «المواطنون» is where every number here is actually acted on,
        and putting it in the same row is what makes this a control panel
        rather than a report.
      */}
      <nav
        aria-label="أقسام اللوحة"
        className="sticky top-0 z-20 -mx-4 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6"
      >
        <ul className="flex flex-wrap items-center gap-2">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const isActive = active === section.id;
            return (
              <li key={section.id}>
                <button
                  type="button"
                  onClick={() => jumpTo(section.id)}
                  aria-current={isActive ? 'true' : undefined}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-transparent bg-muted/60 text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="whitespace-nowrap">{section.label}</span>
                </button>
              </li>
            );
          })}

          <li className="ms-auto">
            <Link
              href={`${base}/citizens`}
              className="inline-flex items-center gap-2 rounded-lg border border-primary/40 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/5"
            >
              <Users className="size-4 shrink-0" aria-hidden />
              <span className="whitespace-nowrap">إدارة المواطنين</span>
              <ChevronLeft className="size-4 shrink-0 rtl:rotate-180" aria-hidden />
            </Link>
          </li>
        </ul>
      </nav>

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
        <section id="overview" className="grid scroll-mt-24 gap-4 lg:grid-cols-3">
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
              // Was "N طلب مسجّل". A طلب is no longer a thing a citizen files
              // and tracks — records are entered by staff — so the supporting
              // line now counts what the fee is actually levied against.
              note={`على ${data?.propertyTotal.toLocaleString('en-US') ?? '—'} عقار مسجّل`}
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

        {/* ── Municipal units ───────────────────────────────────────── */}
        <section id="units" className="scroll-mt-24 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Building2 className="size-5 text-primary" aria-hidden />
              عدد الوحدات السكنية والتجارية
            </h2>
            <p className="text-sm text-muted-foreground">
              {loading
                ? '—'
                : `${data!.propertyTotal.toLocaleString('en-US')} عقار · ${data!.unitTotal.toLocaleString('en-US')} وحدة`}
            </p>
          </div>

          {/*
            Counts, not a chart. Seven categories on one bar axis would put a
            municipality's whole building stock on a scale set by its largest
            category — with 5 buildings against 1 tent the four small ones
            become invisible slivers. Each number is the point here, and the
            form for "the number is the point" is a tile.
          */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {unitCards.map((card) => (
              <UnitTile
                key={`${card.source}:${card.key}`}
                label={card.label}
                value={card.value}
                icon={card.icon}
                loading={loading}
              />
            ))}
          </div>

          {/*
            Said plainly rather than left for someone to discover: a شقة inside
            a registered building and a property registered as a single unit
            are counted the same way here, so the two figures above do not add
            up to each other and are not meant to.
          */}
          <p className="text-xs text-muted-foreground">
            تُحتسب الوحدات داخل المباني المسجّلة والوحدات المسجّلة بذاتها معاً. «مبانٍ
            مسجّلة» تعدّ العقار الواحد مرة واحدة مهما بلغ عدد وحداته.
          </p>
        </section>

        {/* ── Charts ────────────────────────────────────────────────── */}
        <section id="analytics" className="grid scroll-mt-24 gap-4 lg:grid-cols-2">
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

/**
 * One municipal-unit count.
 *
 * Deliberately quieter than the financial tiles above: these are register
 * counts, read in a group of seven, and giving each the same weight as
 * إجمالي الرسوم would flatten the page into one long row of equally loud
 * numbers. A zero is muted rather than hidden — "no clinics registered" is
 * itself a fact about the municipality, and dropping the card would make the
 * grid's shape depend on the data.
 */
function UnitTile({
  label,
  value,
  icon: Icon,
  loading,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  loading: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <span
        aria-hidden
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-lg',
          value > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-5" />
      </span>
      {/* `min-w-0` so a four-digit count widens the text block rather than
          pushing the icon chip out of the card. */}
      <div className="min-w-0">
        <p
          className={cn(
            'text-2xl font-bold leading-tight',
            value === 0 && 'text-muted-foreground',
          )}
        >
          {loading ? '—' : value.toLocaleString('en-US')}
        </p>
        <p className="truncate text-xs text-muted-foreground">{label}</p>
      </div>
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
