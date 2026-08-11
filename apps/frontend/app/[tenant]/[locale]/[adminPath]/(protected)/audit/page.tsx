'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { History, ShieldCheck } from 'lucide-react';
import { ApiRequestError, getAuditLog, logApiError } from '@/lib/api-client';
import type { AuditEntry, Session } from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
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

/** Exactly the values `AuditService` records — a filter option that matches
 *  nothing reads as a broken page, not an empty result. */
const ENTITY_TYPES = ['Registration', 'Document', 'User', 'Zone', 'Parcel'] as const;

const ENTITY_LABELS: Record<string, string> = {
  Registration: 'طلب',
  Document: 'مرفق',
  User: 'مستخدم',
  Zone: 'قطاع',
  Parcel: 'عقار',
};
const ALL_ENTITY_TYPES = 'ALL';

const ACTION_LABELS: Record<string, string> = {
  REGISTRATION_SUBMITTED: 'تقديم طلب',
  REGISTRATION_RESUBMITTED: 'إعادة تقديم بعد التصحيح',
  STATUS_CHANGE: 'تغيير حالة',
  LOGIN: 'تسجيل دخول',
  DOCUMENT_VIEW: 'فتح مرفق',
  CSV_EXPORT: 'تصدير CSV',
  CADASTRE_IMPORT: 'استيراد خريطة',
  STAFF_CREATED: 'إنشاء حساب موظف',
  STAFF_UPDATED: 'تعديل حساب موظف',
  STAFF_DEACTIVATED: 'إلغاء تفعيل موظف',
  STAFF_REACTIVATED: 'إعادة تفعيل موظف',
  STAFF_DELETED: 'حذف حساب موظف',
  TOTP_ENROLLED: 'تسجيل تحقق ثنائي',
  TOTP_CONFIRMED: 'تأكيد التحقق الثنائي',
  ZONE_CREATED: 'إنشاء قطاع',
  ZONE_UPDATED: 'تعديل قطاع',
  ZONE_DELETED: 'حذف قطاع',
};

const TABLE_LABELS: DataTableLabels = {
  searchAriaLabel: 'بحث في سجل النشاطات',
  searchPlaceholder: 'ابحث بالإجراء أو البريد الإلكتروني…',
  clearSearch: 'مسح البحث',
  empty: 'لا توجد نشاطات.',
  emptySearch: 'لا نتائج مطابقة لبحثك.',
  loadError: 'تعذّر تحميل سجل النشاطات.',
  retry: 'إعادة المحاولة',
  previous: 'السابق',
  next: 'التالي',
  pageOf: 'صفحة {current} من {total}',
  rowsPerPage: 'عدد الصفوف',
  totalRows: '{count} نشاط',
  sortAscending: 'ترتيب تصاعدي',
  sortDescending: 'ترتيب تنازلي',
  sortNone: 'إلغاء الترتيب',
};

/**
 * Every administrative action, who performed it, and when — SUPER_ADMIN and
 * AUDITOR only, matching the backend guard exactly (a FIELD_INSPECTOR who
 * could read this would see how closely their own work is being reviewed).
 *
 * "My activity" is the same endpoint with `actorId` narrowed to the signed-in
 * user rather than a separate one: the audit log already knows who did what,
 * so a personal history view is a filter, not a new data source.
 */
export default function AuditTrailPage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;

  const [session, setSession] = useState<Session | null>(null);
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const [entityType, setEntityType] = useState('');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  /**
   * The audit trail is append-only and never pruned, so it is the one table
   * guaranteed to outgrow any fixed fetch. It was reading the first 100 rows
   * and paginating those — which, on a log, silently hid everything older than
   * the last hundred actions.
   */
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const existing = loadSession(tenant);
    if (!existing || existing.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }
    if (existing.user.role !== 'SUPER_ADMIN' && existing.user.role !== 'AUDITOR') {
      // Enforced server-side regardless; redirecting avoids offering a page
      // that can only ever answer "لا يوجد صلاحية" for this role.
      router.replace(`${base}/dashboard`);
      return;
    }
    setSession(existing);
  }, [tenant, base, router]);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const result = await getAuditLog(tenant, session.accessToken, {
        actorId: scope === 'mine' ? session.user.id : undefined,
        entityType: entityType || undefined,
        limit: pagination.pageSize,
        offset: pagination.pageIndex * pagination.pageSize,
      });
      setEntries(result.items);
      setTotal(result.total);
      setError(null);
    } catch (caught) {
      logApiError(caught);
      if (caught instanceof ApiRequestError && caught.status === 401) {
        clearSession(tenant);
        router.replace(`${base}/login`);
        return;
      }
      setError('تعذّر تحميل سجل النشاطات.');
    } finally {
      setLoading(false);
    }
  }, [tenant, session, scope, entityType, base, router, pagination]);

  useEffect(() => {
    void load();
  }, [load]);

  // Switching scope or entity filter narrows the set; page 7 of the old one is
  // rarely a page of the new one.
  useEffect(() => {
    setPagination((previous) =>
      previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 },
    );
  }, [scope, entityType]);

  const columns = useMemo<ColumnDef<AuditEntry>[]>(
    () => [
      {
        accessorKey: 'action',
        header: 'الإجراء',
        cell: ({ row }) => (
          <div className="space-y-1">
            <Badge variant="secondary">
              {ACTION_LABELS[row.original.action] ?? row.original.action}
            </Badge>
            <p className="text-xs text-muted-foreground">
              {ENTITY_LABELS[row.original.entityType] ?? row.original.entityType}
            </p>
          </div>
        ),
      },
      {
        id: 'actor',
        header: 'القائم بالإجراء',
        accessorFn: (row) => row.actorEmail ?? row.actorId ?? '',
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <p className="font-medium">{row.original.actorEmail ?? 'غير معروف'}</p>
            <p className="text-xs text-muted-foreground">
              {row.original.actorRole ?? row.original.actorType}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: 'الوقت',
        cell: ({ row }) => (
          <span dir="ltr" className="text-sm">
            {formatDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: 'entity',
        header: 'العنصر',
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
    [],
  );

  if (!session) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="border-b pb-6">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <ShieldCheck className="size-7 text-primary" aria-hidden />
          سجل النشاطات
        </h1>
        <p className="text-sm text-muted-foreground">
          كل إجراء إداري في النظام: الفعل، القائم به، وتوقيته
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive"
        >
          {error}
        </p>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader className="flex-col gap-4 border-b md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <History className="size-5" aria-hidden />
              {scope === 'mine' ? 'نشاطي' : 'كل النشاطات'}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {scope === 'mine'
                ? 'العناصر التي أنشأتها أو عدّلتها بنفسك'
                : 'كل الإجراءات التي قام بها موظفو البلدية'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="flex overflow-hidden rounded-lg border">
              <Button
                variant={scope === 'all' ? 'default' : 'ghost'}
                className="rounded-none"
                onClick={() => setScope('all')}
              >
                الكل
              </Button>
              <Button
                variant={scope === 'mine' ? 'default' : 'ghost'}
                className="rounded-none"
                onClick={() => setScope('mine')}
              >
                نشاطي
              </Button>
            </div>

            <Select
              value={entityType || ALL_ENTITY_TYPES}
              onValueChange={(next) => setEntityType(next === ALL_ENTITY_TYPES ? '' : next)}
            >
              <SelectTrigger className="h-10 w-full md:w-[180px]" aria-label="تصفية حسب نوع العنصر">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ENTITY_TYPES}>كل الأنواع</SelectItem>
                {ENTITY_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {ENTITY_LABELS[type] ?? type}
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
            labels={TABLE_LABELS}
            getRowId={(row) => row.id}
            loading={loading}
            onRetry={() => void load()}
            /*
              The search box is off rather than manual: the audit endpoint
              filters by actor and entity type, not by free text, so a search
              field here would only ever filter the page on screen — which on a
              log reads as "no results" for anything older.
            */
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
