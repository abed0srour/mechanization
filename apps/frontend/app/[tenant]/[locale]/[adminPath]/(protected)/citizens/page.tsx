'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Ban,
  Banknote,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageCircle,
  Pencil,
  Phone,
  RotateCcw,
  Trash2,
  TriangleAlert,
  UserPlus,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import {
  ApiRequestError,
  deleteCitizen,
  listCitizens,
  logApiError,
  setCitizenActive,
} from '@/lib/api-client';
import type { CitizenListItem } from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableLabels } from '@/components/ui/data-table';
import { Money } from '@/components/ui/money';
import { ActionTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** Roles allowed to write. Mirrors the server; the server is the enforcement. */
const CAN_WRITE = ['SUPER_ADMIN', 'FIELD_INSPECTOR'];

const TABLE_LABELS: DataTableLabels = {
  searchAriaLabel: 'بحث في المواطنين',
  searchPlaceholder: 'ابحث بالاسم أو الهاتف أو الرقم المرجعي…',
  clearSearch: 'مسح البحث',
  empty: 'لا يوجد مواطنون مسجّلون بعد.',
  emptySearch: 'لا نتائج مطابقة لبحثك.',
  loadError: 'تعذّر تحميل سجل المواطنين.',
  retry: 'إعادة المحاولة',
  previous: 'السابق',
  next: 'التالي',
  pageOf: 'صفحة {current} من {total}',
  rowsPerPage: 'عدد الصفوف',
  totalRows: '{count} مواطن',
  sortAscending: 'ترتيب تصاعدي',
  sortDescending: 'ترتيب تنازلي',
  sortNone: 'إلغاء الترتيب',
};

/**
 * The citizen registry — the municipality's own record of who is registered,
 * what they registered, and what they owe.
 *
 * This screen exists because the public wizard no longer does. A claim is now
 * entered here by a clerk from the papers a citizen brings in, which makes
 * this the place the registry is created and corrected rather than a read-only
 * view of what arrived overnight. The dashboard remains the *review* queue —
 * one row per طلب, ordered by what needs deciding; this is one row per person,
 * ordered by who they are, and it is the only screen that shows a citizen's
 * claims and their money side by side.
 */
export default function CitizensPage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;

  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | undefined>();
  const [items, setItems] = useState<CitizenListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canWrite = role ? CAN_WRITE.includes(role) : false;
  const canDelete = role === 'SUPER_ADMIN';

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
    try {
      const result = await listCitizens(tenant, token);
      setItems(result.items);
      setError(null);
    } catch (caught) {
      logApiError(caught);
      if (caught instanceof ApiRequestError && caught.status === 401) {
        clearSession(tenant);
        router.replace(`${base}/login`);
        return;
      }
      setError('تعذّر تحميل سجل المواطنين.');
    } finally {
      setLoading(false);
    }
  }, [tenant, token, base, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = useCallback(
    async (citizen: CitizenListItem) => {
      if (!token) return;
      setBusyId(citizen.id);
      try {
        await setCitizenActive(tenant, token, citizen.id, !citizen.isActive);
        await load();
      } catch (caught) {
        logApiError(caught);
        setError(caught instanceof ApiRequestError ? caught.message : 'تعذّر تحديث الحساب.');
      } finally {
        setBusyId(null);
      }
    },
    [tenant, token, load],
  );

  const removeCitizen = useCallback(
    async (citizen: CitizenListItem) => {
      if (!token) return;
      if (
        !confirm(
          `حذف ملف ${citizen.fullName} نهائياً؟\n\n` +
            'سيتم حذف جميع طلباته وعقاراته ومستنداته وفواتيره. لا يمكن التراجع عن هذا الإجراء.',
        )
      ) {
        return;
      }
      setBusyId(citizen.id);
      try {
        await deleteCitizen(tenant, token, citizen.id);
        await load();
      } catch (caught) {
        logApiError(caught);
        setError(caught instanceof ApiRequestError ? caught.message : 'تعذّر حذف الملف.');
      } finally {
        setBusyId(null);
      }
    },
    [tenant, token, load],
  );

  const columns = useMemo<ColumnDef<CitizenListItem>[]>(
    () => [
      {
        accessorKey: 'fullName',
        header: 'المواطن',
        cell: ({ row }) => {
          const citizen = row.original;
          return (
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
              >
                <UserRound className="size-4" />
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="flex items-center gap-2 font-medium">
                  <span className="truncate">{citizen.fullName}</span>
                  {!citizen.isActive ? (
                    <Badge variant="outline" className="shrink-0 gap-1 py-0">
                      <Ban className="size-3" aria-hidden />
                      معطّل
                    </Badge>
                  ) : null}
                </p>
                {citizen.referenceNumber ? (
                  <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                    {citizen.referenceNumber}
                  </p>
                ) : null}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'phone',
        header: 'التواصل',
        enableSorting: false,
        cell: ({ row }) => {
          const { phone, whatsapp } = row.original;
          if (!phone) return <span className="text-muted-foreground">—</span>;
          return (
            <div className="space-y-1">
              {/* Click-to-call: the first move on a questionable record is to
                  phone whoever is on it. */}
              <a
                href={`tel:${phone}`}
                dir="ltr"
                className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
              >
                <Phone className="size-3.5 shrink-0" aria-hidden />
                {phone}
              </a>
              {whatsapp && whatsapp !== phone ? (
                <p
                  dir="ltr"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <MessageCircle className="size-3.5 shrink-0" aria-hidden />
                  {whatsapp}
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: 'latestStatus',
        header: 'الطلبات',
        cell: ({ row }) => {
          const citizen = row.original;
          if (!citizen.latestStatus) {
            return <span className="text-sm text-muted-foreground">لا توجد طلبات</span>;
          }
          return (
            <div className="space-y-1.5">
              <StatusBadge
                status={citizen.latestStatus}
                label={ar.reportStatus[citizen.latestStatus as never] ?? citizen.latestStatus}
              />
              <p className="text-xs text-muted-foreground">
                {citizen.registrationCount} طلب · {citizen.propertyCount} عقار
              </p>
            </div>
          );
        },
      },
      {
        accessorKey: 'feesTotal',
        header: 'الرسوم',
        // No width on the column and `whitespace-nowrap` on the cell: an
        // eight-figure total widens its own block rather than wrapping to a
        // second line, which would leave that one row twice the height of its
        // neighbours. The table's own `overflow-x` absorbs the extra width.
        meta: { cellClassName: 'whitespace-nowrap' },
        cell: ({ row }) => {
          const citizen = row.original;
          if (citizen.feesTotal === 0) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <div className="space-y-0.5">
              <Money amount={citizen.feesTotal} className="block font-medium" />
              <p className="text-xs text-muted-foreground">
                مسدّد <Money amount={citizen.paidTotal} />
              </p>
            </div>
          );
        },
      },
      {
        accessorKey: 'overdueTotal',
        header: 'المتأخرات',
        meta: { cellClassName: 'whitespace-nowrap' },
        cell: ({ row }) => {
          const citizen = row.original;

          // Nothing owed and nothing late is the good state, and it gets the
          // quiet treatment — a column of green ticks reads as loudly as a
          // column of red warnings, and only one of the two needs acting on.
          if (citizen.outstandingTotal === 0) {
            return (
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
                لا متأخرات
              </span>
            );
          }

          return (
            <div className="space-y-1">
              <p
                className={cn(
                  'inline-flex items-center gap-1.5 font-semibold',
                  citizen.overdueTotal > 0 ? 'text-destructive' : 'text-foreground',
                )}
              >
                {citizen.overdueTotal > 0 ? (
                  <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                ) : null}
                <Money
                  amount={
                    citizen.overdueTotal > 0 ? citizen.overdueTotal : citizen.outstandingTotal
                  }
                />
              </p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {citizen.overdueTotal > 0 ? (
                  <span>{citizen.overdueCount} فاتورة متأخرة</span>
                ) : (
                  <span>غير مستحقة بعد</span>
                )}
                {citizen.pendingReviewCount > 0 ? (
                  <Badge variant="outline" className="gap-1 py-0 text-[0.7rem]">
                    <Clock3 className="size-3" aria-hidden />
                    {citizen.pendingReviewCount} قيد التحقق
                  </Badge>
                ) : null}
              </p>
            </div>
          );
        },
      },
      {
        id: 'actions',
        header: 'إجراء',
        enableSorting: false,
        cell: ({ row }) => {
          const citizen = row.original;
          const busy = busyId === citizen.id;

          return (
            // Deliberately not `flex-wrap`: wrapping four buttons makes one row
            // twice the height of its neighbours. The table's own `overflow-x`
            // absorbs the width instead.
            <div className="flex items-center gap-1.5">
              <ActionTooltip label="عرض التفاصيل والفواتير">
                <Link
                  href={`${base}/citizens/${citizen.id}`}
                  aria-label="عرض التفاصيل"
                  className={buttonVariants({ variant: 'secondary', size: 'icon-sm' })}
                >
                  <UserRound className="size-4" aria-hidden />
                </Link>
              </ActionTooltip>

              {canWrite ? (
                <ActionTooltip label="تعديل البيانات">
                  <Link
                    href={`${base}/citizens/${citizen.id}/edit`}
                    aria-label="تعديل"
                    className={buttonVariants({ variant: 'outline', size: 'icon-sm' })}
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Link>
                </ActionTooltip>
              ) : null}

              {canWrite ? (
                <ActionTooltip
                  label={citizen.isActive ? 'تعطيل — يوقف إصدار الرسوم' : 'إعادة التفعيل'}
                >
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={citizen.isActive ? 'تعطيل' : 'إعادة التفعيل'}
                    disabled={busy}
                    onClick={() => void toggleActive(citizen)}
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : citizen.isActive ? (
                      <Ban className="size-4" aria-hidden />
                    ) : (
                      <RotateCcw className="size-4" aria-hidden />
                    )}
                  </Button>
                </ActionTooltip>
              ) : null}

              {canDelete ? (
                <ActionTooltip label="حذف نهائي — يحذف الطلبات والمستندات والفواتير">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="حذف نهائي"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={busy}
                    onClick={() => void removeCitizen(citizen)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </ActionTooltip>
              ) : null}
            </div>
          );
        },
      },
    ],
    [base, busyId, canWrite, canDelete, toggleActive, removeCitizen],
  );

  /**
   * Headline totals computed from the loaded page rather than fetched.
   *
   * The list endpoint already carries every number these need, so a second
   * round trip would only introduce a moment where the cards and the table
   * below them disagree.
   */
  const totals = useMemo(
    () => ({
      citizens: items.length,
      inArrears: items.filter((citizen) => citizen.overdueTotal > 0).length,
      outstanding: items.reduce((sum, citizen) => sum + citizen.outstandingTotal, 0),
      overdue: items.reduce((sum, citizen) => sum + citizen.overdueTotal, 0),
    }),
    [items],
  );

  if (!token) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col items-start justify-between gap-4 border-b pb-6 md:flex-row md:items-center">
        <div className="space-y-2">
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
            <Users className="size-7 text-primary" aria-hidden />
            المواطنون
          </h1>
          <p className="text-sm text-muted-foreground">
            سجل المواطنين المسجّلين لدى البلدية — البيانات والعقارات والرسوم المستحقة
          </p>
        </div>
        {canWrite ? (
          <Link href={`${base}/citizens/new`} className={buttonVariants()}>
            <UserPlus className="size-4" aria-hidden />
            تسجيل مواطن جديد
          </Link>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="إجمالي المواطنين"
          value={totals.citizens.toLocaleString('en-US')}
          loading={loading}
          icon={<Users className="size-6 text-primary" aria-hidden />}
        />
        <MetricCard
          label="رسوم غير مسدّدة"
          value={<Money amount={totals.outstanding} />}
          loading={loading}
          icon={<Wallet className="size-6 text-primary" aria-hidden />}
        />
        <MetricCard
          label="متأخرات مستحقة"
          value={<Money amount={totals.overdue} />}
          loading={loading}
          icon={<Banknote className="size-6 text-destructive" aria-hidden />}
          accent="bg-destructive/10"
        />
        <MetricCard
          label="مواطنون متأخرون"
          value={totals.inArrears.toLocaleString('en-US')}
          loading={loading}
          icon={<TriangleAlert className="size-6 text-warning" aria-hidden />}
          accent="bg-warning/10"
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="size-5" aria-hidden />
            سجل المواطنين
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            «المتأخرات» هي الرسوم غير المسدّدة التي تجاوزت تاريخ استحقاقها. التعطيل يوقف
            إصدار رسوم جديدة ويُبقي السجل كما هو؛ الحذف النهائي يزيل كل شيء.
          </p>
        </CardHeader>
        <CardContent className="p-6">
          <DataTable
            columns={columns}
            data={items}
            labels={TABLE_LABELS}
            getRowId={(row) => row.id}
            loading={loading}
            onRetry={() => void load()}
            emptyIcon={<Users className="h-10 w-10 text-muted-foreground/60" />}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * A single KPI widget: label, value, and an accent icon chip.
 *
 * The value block takes `value` as a node rather than a string so a money
 * tile can hand it a `<Money>` — compacted, with the exact figure on hover.
 * It also carries no `truncate`: clipping "1,250,000,000 ل.ل" to
 * "1,250,000,0…" is strictly worse than the shorthand, and with `Money`
 * doing the shortening there is nothing left to clip. The icon chip is the
 * part that yields (`shrink-0` on the chip, `min-w-0` on the text) so a long
 * figure never pushes it out of the card.
 */
function MetricCard({
  label,
  value,
  loading,
  icon,
  accent = 'bg-accent',
}: {
  label: string;
  value: React.ReactNode;
  loading: boolean;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex items-center justify-between gap-3 p-5">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <div className="text-2xl font-bold tabular-nums">{loading ? '—' : value}</div>
        </div>
        <div className={`shrink-0 rounded-lg p-3 ${accent}`}>{icon}</div>
      </CardContent>
    </Card>
  );
}
