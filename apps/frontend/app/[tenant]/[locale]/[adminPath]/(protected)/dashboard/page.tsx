'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import {
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  Loader2,
  MapPin,
  RefreshCw,
  UserRound,
  Users,
} from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import {
  ApiRequestError,
  changeRegistrationStatus,
  getCitizenProfile,
  getDashboardCounters,
  listForReview,
  logApiError,
} from '@/lib/api-client';
import type { DashboardCounters, RegistrationListItem } from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { findLocatedProperty, mapHref } from '@/lib/map-link';
import { nextStatusesFor } from '@/lib/registration-status';
import { Badge, STATUS_ICON, StatusBadge } from '@/components/ui/badge';
import { ActionTooltip } from '@/components/ui/tooltip';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableLabels } from '@/components/ui/data-table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const STATUSES = ['PENDING', 'UNDER_REVIEW', 'VERIFIED', 'APPROVED', 'REJECTED'] as const;

/**
 * "No filter" needs a value of its own: a Radix SelectItem cannot carry an empty
 * string, which is what the list endpoint wants for "every status".
 */
const ALL_STATUSES = 'ALL';

const TABLE_LABELS: DataTableLabels = {
  searchAriaLabel: 'بحث في الطلبات',
  searchPlaceholder: 'ابحث برقم مرجعي أو اسم…',
  clearSearch: 'مسح البحث',
  empty: 'لا توجد طلبات.',
  emptySearch: 'لا نتائج مطابقة لبحثك.',
  loadError: 'تعذّر تحميل الطلبات.',
  retry: 'إعادة المحاولة',
  previous: 'السابق',
  next: 'التالي',
  pageOf: 'صفحة {current} من {total}',
  rowsPerPage: 'عدد الصفوف',
  totalRows: '{count} طلب',
  sortAscending: 'ترتيب تصاعدي',
  sortDescending: 'ترتيب تنازلي',
  sortNone: 'إلغاء الترتيب',
};

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
  const [counters, setCounters] = useState<DashboardCounters | null>(null);
  const [items, setItems] = useState<RegistrationListItem[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** citizenId currently being located for the "عرض على الخريطة" row action. */
  const [locatingId, setLocatingId] = useState<string | null>(null);

  useEffect(() => {
    const session = loadSession(tenant);
    if (!session || session.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }
    setToken(session.accessToken);
    setRole(session.user.role);
  }, [tenant, base, router]);

  const signOut = useCallback(() => {
    clearSession(tenant);
    router.replace(`${base}/login`);
  }, [tenant, base, router]);

  const load = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      const [countersResult, listResult] = await Promise.all([
        getDashboardCounters(tenant, token),
        listForReview(tenant, token, { status: filter || undefined }),
      ]);
      setCounters(countersResult);
      setItems(listResult.items);
      setError(null);
    } catch (caught) {
      logApiError(caught);
      if (caught instanceof ApiRequestError && caught.status === 401) {
        signOut();
        return;
      }
      setError('تعذّر تحميل البيانات.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tenant, token, filter, signOut]);

  useEffect(() => {
    void load();
  }, [load]);

  const transition = useCallback(
    async (id: string, status: string) => {
      if (!token) return;
      try {
        await changeRegistrationStatus(tenant, token, id, { status });
        await load();
      } catch (caught) {
        logApiError(caught);
        setError(caught instanceof ApiRequestError ? caught.message : 'تعذّر تغيير الحالة.');
      }
    },
    [tenant, token, load],
  );

  /**
   * "عرض على الخريطة" for an accepted row: the list endpoint only carries
   * counters (`propertyCount`), not coordinates, so this fetches the
   * citizen's full profile just long enough to find a located property, then
   * hands off to the same map deep-link the citizen page's button uses.
   */
  const showOnMap = useCallback(
    async (citizenIdToLocate: string) => {
      if (!token) return;
      setLocatingId(citizenIdToLocate);
      try {
        const profile = await getCitizenProfile(tenant, token, citizenIdToLocate);
        const located = findLocatedProperty(
          profile.registrations.flatMap((registration) => registration.properties),
        );
        router.push(located ? mapHref(base, located) : `${base}/map`);
      } catch (caught) {
        logApiError(caught);
        if (caught instanceof ApiRequestError && caught.status === 401) {
          signOut();
          return;
        }
        alert('تعذّر تحديد موقع المواطن.');
      } finally {
        setLocatingId(null);
      }
    },
    [tenant, token, base, router, signOut],
  );

  const columns = useMemo<ColumnDef<RegistrationListItem>[]>(
    () => [
      {
        accessorKey: 'referenceNumber',
        header: 'الرقم المرجعي',
        cell: ({ row }) => (
          // Monospaced: a reference number is compared character-by-character
          // against a printed slip far more often than it is read as a word.
          <span className="font-mono text-xs font-medium" dir="ltr">
            {row.original.referenceNumber}
          </span>
        ),
      },
      {
        accessorKey: 'citizenName',
        header: 'مقدّم الطلب',
        cell: ({ row }) => <span className="font-medium">{row.original.citizenName}</span>,
      },
      {
        accessorKey: 'citizenPhone',
        header: 'رقم الهاتف',
        // Click-to-call: the first move on a questionable claim is to phone
        // whoever filed it, and this is the column that exists to enable that.
        cell: ({ row }) =>
          row.original.citizenPhone ? (
            <a
              href={`tel:${row.original.citizenPhone}`}
              dir="ltr"
              className="font-medium text-primary hover:underline"
            >
              {row.original.citizenPhone}
            </a>
          ) : (
            '—'
          ),
      },
      {
        accessorKey: 'submittedAt',
        header: 'تاريخ التقديم',
        cell: ({ row }) => new Date(row.original.submittedAt).toLocaleDateString('ar-LB'),
      },
      {
        accessorKey: 'propertyCount',
        header: 'العقارات',
        // `tabular-nums` so a column of counts aligns on its digits instead
        // of drifting with the proportional figures the body font ships.
        meta: { headerClassName: 'w-24', cellClassName: 'tabular-nums' },
      },
      {
        accessorKey: 'status',
        header: 'الحالة',
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.status}
            label={ar.reportStatus[row.original.status as never] ?? row.original.status}
          />
        ),
      },
      {
        id: 'actions',
        header: 'إجراء',
        enableSorting: false,
        cell: ({ row }) => (
          // Deliberately not `flex-wrap`: an approved row carries four
          // buttons, and wrapping them makes that one row twice the height of
          // its neighbours. The table's own `overflow-x` absorbs the width
          // instead, keeping every row the same height.
          <div className="flex items-center gap-1.5">
            {/* Always first, and always present: reviewing a claim starts with
                reading who filed it, whatever state the claim is in. */}
            <ActionTooltip label="عرض التفاصيل">
              <Link
                href={`${base}/citizens/${row.original.citizenId}`}
                aria-label="عرض التفاصيل"
                className={buttonVariants({ variant: 'secondary', size: 'icon-sm' })}
              >
                <UserRound className="size-4" aria-hidden />
              </Link>
            </ActionTooltip>

            {/* Only once a claim is accepted — before that, the location on
                file hasn't been confirmed as the one worth acting on yet. */}
            {row.original.status === 'APPROVED' ? (
              <ActionTooltip label="عرض على الخريطة">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="عرض على الخريطة"
                  disabled={locatingId === row.original.citizenId}
                  onClick={() => void showOnMap(row.original.citizenId)}
                >
                  {locatingId === row.original.citizenId ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <MapPin className="size-4" aria-hidden />
                  )}
                </Button>
              </ActionTooltip>
            ) : null}

            {/*
              Forward moves only. Rejection now lives on the review screen
              (عرض التفاصيل), because refusing a claim means naming the fields
              at fault — and those fields are only on screen there. A reject
              button here could collect a note but never a field, which is
              what made the old dialog a worse version of the same job.
            */}
            {nextStatusesFor(row.original.status)
              .filter((next) => next !== 'REJECTED')
              .map((next) => {
                const label = ar.reportStatus[next as never] ?? next;
                const Icon = STATUS_ICON[next] ?? CheckCircle2;
                return (
                  <ActionTooltip key={next} label={`نقل إلى: ${label}`}>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={`نقل إلى: ${label}`}
                      onClick={() => void transition(row.original.id, next)}
                    >
                      <Icon className="size-4" aria-hidden />
                    </Button>
                  </ActionTooltip>
                );
              })}
          </div>
        ),
      },
    ],
    [base, transition, locatingId, showOnMap],
  );

  if (!token) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col items-start justify-between gap-4 border-b pb-6 md:flex-row md:items-center">
        <div className="space-y-2">
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
            لوحة البلدية
            {role ? <Badge variant="secondary">{role}</Badge> : null}
          </h1>
          <p className="text-sm text-muted-foreground">
            مراجعة طلبات تسجيل العقارات وإدارة حالاتها
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {/* SUPER_ADMIN/AUDITOR only server-side; hidden here too so it is
              not offered to a role that will only get refused. */}
          {role === 'SUPER_ADMIN' || role === 'AUDITOR' ? (
            <a
              href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'}/t/${tenant}/dashboard/export.csv${filter ? `?status=${filter}` : ''}`}
              className={buttonVariants({ variant: 'outline' })}
            >
              <Download className="size-4" aria-hidden />
              تصدير CSV
            </a>
          ) : null}
          <Button variant="outline" onClick={() => void load()} disabled={refreshing} title="تحديث البيانات">
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="إجمالي الطلبات"
          value={counters?.total ?? 0}
          loading={loading}
          icon={<Users className="size-6 text-primary" aria-hidden />}
        />
        <MetricCard
          label="آخر ٧ أيام"
          value={counters?.submittedLast7Days ?? 0}
          loading={loading}
          icon={<FileSpreadsheet className="size-6 text-primary" aria-hidden />}
        />
        <MetricCard
          label="قيد المراجعة"
          value={counters?.byStatus.UNDER_REVIEW ?? 0}
          loading={loading}
          icon={<Clock className="size-6 text-warning" aria-hidden />}
          accent="bg-warning/10"
        />
        <MetricCard
          label="مقبولة"
          value={counters?.byStatus.APPROVED ?? 0}
          loading={loading}
          icon={<CheckCircle2 className="size-6 text-success" aria-hidden />}
          accent="bg-success/10"
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="flex-col gap-4 border-b md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileSpreadsheet className="size-5" aria-hidden />
              الطلبات
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              كل طلبات تسجيل العقارات المقدَّمة، مع حالة المراجعة الحالية
            </p>
          </div>

          <Select
            value={filter || ALL_STATUSES}
            onValueChange={(next) => setFilter(next === ALL_STATUSES ? '' : next)}
          >
            <SelectTrigger className="h-10 w-full md:w-[180px]" aria-label="تصفية حسب الحالة">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>كل الحالات</SelectItem>
              {STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {ar.reportStatus[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>

        <CardContent className="p-6">
          <DataTable
            columns={columns}
            data={items}
            labels={TABLE_LABELS}
            getRowId={(row) => row.id}
            loading={loading}
            onRetry={() => void load()}
          />
        </CardContent>
      </Card>

    </div>
  );
}

/** A single KPI widget: label, value, and an accent icon chip. */
function MetricCard({
  label,
  value,
  loading,
  icon,
  accent = 'bg-accent',
}: {
  label: string;
  value: number;
  loading: boolean;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex items-center justify-between p-5">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-3xl font-bold">{loading ? '—' : value.toLocaleString('en-US')}</p>
        </div>
        <div className={`rounded-lg p-3 ${accent}`}>{icon}</div>
      </CardContent>
    </Card>
  );
}

