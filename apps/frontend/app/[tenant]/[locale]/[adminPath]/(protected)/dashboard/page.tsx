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
  Map as MapIcon,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import {
  ApiRequestError,
  changeRegistrationStatus,
  getDashboardCounters,
  listForReview,
  logApiError,
} from '@/lib/api-client';
import type { DashboardCounters, RegistrationListItem } from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { Badge, STATUS_BADGE_VARIANT } from '@/components/ui/badge';
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

      // Rejection must carry a reason — the domain refuses one without it, so
      // asking here avoids a round-trip that can only fail.
      const reason =
        status === 'REJECTED' ? (prompt('سبب الرفض (إلزامي):') ?? '').trim() : undefined;
      if (status === 'REJECTED' && !reason) return;

      try {
        await changeRegistrationStatus(tenant, token, id, { status, reason });
        await load();
      } catch (caught) {
        logApiError(caught);
        setError(caught instanceof ApiRequestError ? caught.message : 'تعذّر تغيير الحالة.');
      }
    },
    [tenant, token, load],
  );

  const columns = useMemo<ColumnDef<RegistrationListItem>[]>(
    () => [
      {
        accessorKey: 'referenceNumber',
        header: 'الرقم المرجعي',
        cell: ({ row }) => (
          <span className="font-medium" dir="ltr">
            {row.original.referenceNumber}
          </span>
        ),
      },
      {
        accessorKey: 'citizenName',
        header: 'مقدّم الطلب',
      },
      {
        accessorKey: 'neighborhoods',
        header: 'الحي',
        // A registration usually names one حي; a landlord filing several
        // properties at once can span more than one, so every value the
        // claim actually touches is shown rather than just the first.
        cell: ({ row }) => row.original.neighborhoods.join('، ') || '—',
      },
      {
        accessorKey: 'submittedAt',
        header: 'تاريخ التقديم',
        cell: ({ row }) => new Date(row.original.submittedAt).toLocaleDateString('ar-LB'),
      },
      {
        accessorKey: 'propertyCount',
        header: 'العقارات',
        meta: { headerClassName: 'w-24' },
      },
      {
        accessorKey: 'status',
        header: 'الحالة',
        cell: ({ row }) => (
          <Badge variant={STATUS_BADGE_VARIANT[row.original.status] ?? 'secondary'}>
            {ar.reportStatus[row.original.status as never] ?? row.original.status}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: 'إجراء',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-2">
            {/* Always first, and always present: reviewing a claim starts with
                reading who filed it, whatever state the claim is in. */}
            <Link
              href={`${base}/citizens/${row.original.citizenId}`}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              <UserRound className="size-3.5" aria-hidden />
              عرض التفاصيل
            </Link>

            {nextStatusesFor(row.original.status).map((next) => (
              <Button
                key={next}
                variant="outline"
                size="sm"
                onClick={() => void transition(row.original.id, next)}
              >
                {ar.reportStatus[next as never] ?? next}
              </Button>
            ))}
          </div>
        ),
      },
    ],
    [base, transition],
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
          <Button asChild variant="outline">
            <Link href={`${base}/map`}>
              <MapIcon className="size-4" aria-hidden />
              الخريطة
            </Link>
          </Button>
          {/* Both are SUPER_ADMIN/AUDITOR only server-side; hidden here too so
              neither is offered to a role that will only get refused. */}
          {role === 'SUPER_ADMIN' || role === 'AUDITOR' ? (
            <>
              <Button asChild variant="outline">
                <Link href={`${base}/audit`}>
                  <ShieldCheck className="size-4" aria-hidden />
                  سجل النشاطات
                </Link>
              </Button>
              <a
                href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'}/t/${tenant}/dashboard/export.csv${filter ? `?status=${filter}` : ''}`}
                className={buttonVariants({ variant: 'outline' })}
              >
                <Download className="size-4" aria-hidden />
                تصدير CSV
              </a>
            </>
          ) : null}
          <Button variant="outline" onClick={() => void load()} disabled={refreshing} title="تحديث البيانات">
            <RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
            تحديث
          </Button>
          <Button variant="ghost" onClick={signOut}>
            خروج
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

/**
 * Mirrors the aggregate's ALLOWED_TRANSITIONS. Duplicated here only to avoid
 * offering a button the server will refuse — the server remains the authority,
 * and a mismatch shows up as a rejected click rather than a bad write.
 */
function nextStatusesFor(status: string): string[] {
  switch (status) {
    case 'PENDING':
      return ['UNDER_REVIEW', 'REJECTED'];
    case 'UNDER_REVIEW':
      return ['VERIFIED', 'REJECTED'];
    case 'VERIFIED':
      return ['APPROVED', 'REJECTED'];
    default:
      return [];
  }
}
