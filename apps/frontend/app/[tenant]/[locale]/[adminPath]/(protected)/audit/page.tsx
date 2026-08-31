'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { History, ShieldCheck } from 'lucide-react';
import { getAuditLog } from '@/lib/api-client';
import type { AuditEntry, Session } from '@/lib/api-client';
import { getLabels } from '@mechanization/shared-schemas';
import { loadSession } from '@/lib/session';
import { useStaffQuery } from '@/lib/use-staff-query';
import { formatDateTime } from '@/lib/dates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableLabels } from '@/components/ui/data-table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ENTITY_TYPES = ['Registration', 'Document', 'User', 'Zone', 'Parcel'] as const;
const ALL_ENTITY_TYPES = 'ALL';

export default function AuditTrailPage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;
  const labels = getLabels(locale);

  const entityLabels: Record<string, string> = {
    Registration: locale === 'en' ? 'Application' : 'طلب',
    Document: locale === 'en' ? 'Document / Attachment' : 'مرفق',
    User: locale === 'en' ? 'User' : 'مستخدم',
    Zone: locale === 'en' ? 'Sector' : 'قطاع',
    Parcel: locale === 'en' ? 'Parcel' : 'عقار',
  };

  const actionLabels: Record<string, string> = {
    REGISTRATION_SUBMITTED: locale === 'en' ? 'Submission' : 'تقديم طلب',
    REGISTRATION_RESUBMITTED: locale === 'en' ? 'Resubmission' : 'إعادة تقديم بعد التصحيح',
    STATUS_CHANGE: locale === 'en' ? 'Status Change' : 'تغيير حالة',
    LOGIN: locale === 'en' ? 'Login' : 'تسجيل دخول',
    DOCUMENT_VIEW: locale === 'en' ? 'View Document' : 'فتح مرفق',
    CSV_EXPORT: locale === 'en' ? 'Export CSV' : 'تصدير CSV',
    CADASTRE_IMPORT: locale === 'en' ? 'Cadastre Import' : 'استيراد خريطة',
    STAFF_CREATED: locale === 'en' ? 'Create Staff' : 'إنشاء حساب موظف',
    STAFF_UPDATED: locale === 'en' ? 'Update Staff' : 'تعديل حساب موظف',
    STAFF_DEACTIVATED: locale === 'en' ? 'Deactivate Staff' : 'إلغاء تفعيل موظف',
    STAFF_REACTIVATED: locale === 'en' ? 'Reactivate Staff' : 'إعادة تفعيل موظف',
    STAFF_DELETED: locale === 'en' ? 'Delete Staff' : 'حذف حساب موظف',
    TOTP_ENROLLED: locale === 'en' ? '2FA Enrollment' : 'تسجيل تحقق ثنائي',
    TOTP_CONFIRMED: locale === 'en' ? '2FA Confirmed' : 'تأكيد التحقق الثنائي',
    ZONE_CREATED: locale === 'en' ? 'Create Sector' : 'إنشاء قطاع',
    ZONE_UPDATED: locale === 'en' ? 'Update Sector' : 'تعديل قطاع',
    ZONE_DELETED: locale === 'en' ? 'Delete Sector' : 'حذف قطاع',
  };

  const tableLabels: DataTableLabels = {
    searchAriaLabel: locale === 'en' ? 'Search audit trail' : 'بحث في سجل النشاطات',
    searchPlaceholder: locale === 'en' ? 'Search by action or email…' : 'ابحث بالإجراء أو البريد الإلكتروني…',
    clearSearch: locale === 'en' ? 'Clear search' : 'مسح البحث',
    searchHint: 'Enter',
    searchApplied: locale === 'en' ? 'Search: "{term}"' : 'بحث: «{term}»',
    empty: locale === 'en' ? 'No audit records.' : 'لا توجد نشاطات.',
    emptySearch: locale === 'en' ? 'No matching records found.' : 'لا نتائج مطابقة لبحثك.',
    loadError: locale === 'en' ? 'Failed to load audit logs.' : 'تعذّر تحميل سجل النشاطات.',
    retry: locale === 'en' ? 'Retry' : 'إعادة المحاولة',
    previous: locale === 'en' ? 'Previous' : 'السابق',
    next: locale === 'en' ? 'Next' : 'التالي',
    pageOf: locale === 'en' ? 'Page {current} of {total}' : 'صفحة {current} من {total}',
    rowsPerPage: locale === 'en' ? 'Rows per page' : 'عدد الصفوف',
    totalRows: locale === 'en' ? '{count} records' : '{count} نشاط',
    sortAscending: locale === 'en' ? 'Sort ascending' : 'ترتيب تصاعدي',
    sortDescending: locale === 'en' ? 'Sort descending' : 'ترتيب تنازلي',
    sortNone: locale === 'en' ? 'Clear sort' : 'إلغاء الترتيب',
    columns: locale === 'en' ? 'Columns' : 'الأعمدة',
    columnsHint: locale === 'en' ? 'Visible columns' : 'الأعمدة الظاهرة',
    resetColumns: locale === 'en' ? 'Reset defaults' : 'استعادة الافتراضي',
  };

  const [session, setSession] = useState<Session | null>(null);
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const [entityType, setEntityType] = useState('');
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });

  useEffect(() => {
    const existing = loadSession(tenant);
    if (!existing || existing.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }
    if (existing.user.role !== 'SUPER_ADMIN' && existing.user.role !== 'AUDITOR') {
      router.replace(`${base}/dashboard`);
      return;
    }
    setSession(existing);
  }, [tenant, base, router]);

  const query = useStaffQuery({
    queryKey: [
      'audit',
      tenant,
      scope === 'mine' ? session?.user.id : 'all',
      entityType,
      pagination.pageIndex,
      pagination.pageSize,
    ],
    queryFn: (accessToken, signal) =>
      getAuditLog(
        tenant,
        accessToken,
        {
          actorId: scope === 'mine' ? session?.user.id : undefined,
          entityType: entityType || undefined,
          limit: pagination.pageSize,
          offset: pagination.pageIndex * pagination.pageSize,
        },
        signal,
      ),
    tenant,
    base,
    token: session?.accessToken ?? null,
    errorMessage: locale === 'en' ? 'Failed to load audit logs.' : 'تعذّر تحميل سجل النشاطات.',
    keepPrevious: true,
  });

  const entries = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  const resetPage = useCallback(
    () =>
      setPagination((previous) =>
        previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 },
      ),
    [],
  );

  const columns = useMemo<ColumnDef<AuditEntry>[]>(
    () => [
      {
        accessorKey: 'action',
        header: locale === 'en' ? 'Action' : 'الإجراء',
        cell: ({ row }) => (
          <div className="space-y-1">
            <Badge variant="secondary">
              {actionLabels[row.original.action] ?? row.original.action}
            </Badge>
            <p className="text-xs text-muted-foreground">
              {entityLabels[row.original.entityType] ?? row.original.entityType}
            </p>
          </div>
        ),
      },
      {
        id: 'actor',
        header: locale === 'en' ? 'Performed By' : 'القائم بالإجراء',
        accessorFn: (row) => row.actorEmail ?? row.actorId ?? '',
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <p className="font-medium">{row.original.actorEmail ?? (locale === 'en' ? 'Unknown' : 'غير معروف')}</p>
            <p className="text-xs text-muted-foreground">
              {row.original.actorRole
                ? (labels.staffRole?.[row.original.actorRole as never] ?? row.original.actorRole)
                : row.original.actorType}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: locale === 'en' ? 'Timestamp' : 'الوقت',
        cell: ({ row }) => (
          <span dir="ltr" className="text-sm">
            {formatDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: 'entity',
        header: locale === 'en' ? 'Target Entity' : 'العنصر',
        cell: ({ row }) =>
          row.original.entityId ? (
            <span dir="ltr" className="font-mono text-xs text-muted-foreground">
              {row.original.entityId.slice(0, 8)}…
            </span>
          ) : (
            '—'
          ),
      },
    ],
    [labels, locale],
  );

  if (!session) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="border-b pb-6">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <ShieldCheck className="size-7 text-primary" aria-hidden />
          {locale === 'en' ? 'Audit Trail' : 'سجل النشاطات'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {locale === 'en'
            ? 'Complete immutable log of all administrative actions, users, and timestamps'
            : 'كل إجراء إداري في النظام: الفعل، القائم به، وتوقيته'}
        </p>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="flex-col gap-4 border-b md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <History className="size-5" aria-hidden />
              {scope === 'mine'
                ? (locale === 'en' ? 'My Activity' : 'نشاطي')
                : (locale === 'en' ? 'All Activities' : 'كل النشاطات')}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {scope === 'mine'
                ? (locale === 'en' ? 'Actions and modifications performed by your account' : 'العناصر التي أنشأتها أو عدّلتها بنفسك')
                : (locale === 'en' ? 'All actions performed by municipal staff members' : 'كل الإجراءات التي قام بها موظفو البلدية')}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="flex overflow-hidden rounded-lg border">
              <Button
                variant={scope === 'all' ? 'default' : 'ghost'}
                className="rounded-none"
                onClick={() => {
                  setScope('all');
                  resetPage();
                }}
              >
                {locale === 'en' ? 'All' : 'الكل'}
              </Button>
              <Button
                variant={scope === 'mine' ? 'default' : 'ghost'}
                className="rounded-none"
                onClick={() => {
                  setScope('mine');
                  resetPage();
                }}
              >
                {locale === 'en' ? 'My Activity' : 'نشاطي'}
              </Button>
            </div>

            <Select
              value={entityType || ALL_ENTITY_TYPES}
              onValueChange={(next) => {
                setEntityType(next === ALL_ENTITY_TYPES ? '' : next);
                resetPage();
              }}
            >
              <SelectTrigger
                className="h-10 w-full md:w-[180px]"
                aria-label={locale === 'en' ? 'Filter by entity type' : 'تصفية حسب نوع العنصر'}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ENTITY_TYPES}>
                  {locale === 'en' ? 'All Types' : 'كل الأنواع'}
                </SelectItem>
                {ENTITY_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {entityLabels[type] ?? type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="p-6">
          <DataTable
            columns={columns}
            data={entries}
            labels={tableLabels}
            columnStorageKey="audit"
            getRowId={(row) => row.id}
            loading={query.loading}
            error={query.error}
            onRetry={query.refetch}
            searchable={false}
            manualPagination
            sortable={false}
            pageCount={Math.max(Math.ceil(total / pagination.pageSize), 1)}
            totalRowCount={total}
            pagination={pagination}
            onPaginationChange={setPagination}
          />
        </CardContent>
      </Card>
    </div>
  );
}
