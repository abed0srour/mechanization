'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Ban,
  CheckCircle2,
  Loader2,
  Mail,
  Pencil,
  RotateCcw,
  Trash2,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import {
  ApiRequestError,
  createStaff,
  deleteStaff,
  getStaff,
  logApiError,
  setStaffActive,
  updateStaff,
} from '@/lib/api-client';
import type { StaffSummary } from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { formatDate } from '@/lib/dates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type DataTableLabels } from '@/components/ui/data-table';
import { useToast } from '@/components/ui/toast';
import { ActionTooltip } from '@/components/ui/tooltip';
import { StaffForm, type StaffFormValues } from '@/components/admin/staff-form';

const TABLE_LABELS: DataTableLabels = {
  searchAriaLabel: 'بحث في الموظفين',
  searchPlaceholder: 'ابحث بالاسم أو البريد الإلكتروني…',
  clearSearch: 'مسح البحث',
  empty: 'لا يوجد موظفون بعد.',
  emptySearch: 'لا نتائج مطابقة لبحثك.',
  loadError: 'تعذّر تحميل الموظفين.',
  retry: 'إعادة المحاولة',
  previous: 'السابق',
  next: 'التالي',
  pageOf: 'صفحة {current} من {total}',
  rowsPerPage: 'عدد الصفوف',
  totalRows: '{count} موظف',
  sortAscending: 'ترتيب تصاعدي',
  sortDescending: 'ترتيب تنازلي',
  sortNone: 'إلغاء الترتيب',
  columns: 'الأعمدة',
  columnsHint: 'الأعمدة الظاهرة',
  resetColumns: 'استعادة الافتراضي',
};

/**
 * Staff account administration — SUPER_ADMIN only.
 *
 * The role check here is a courtesy, not the protection: every `/staff` route
 * is `@Roles('SUPER_ADMIN')` on the server. Redirecting rather than rendering
 * a permission error keeps a page that can only ever say "no" out of an
 * auditor's way.
 */
export default function StaffPage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;

  const [token, setToken] = useState<string | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [items, setItems] = useState<StaffSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StaffSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** The account whose deletion is being confirmed, or null. */
  const [pendingDelete, setPendingDelete] = useState<StaffSummary | null>(null);
  const toast = useToast();

  useEffect(() => {
    const session = loadSession(tenant);
    if (!session || session.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }
    if (session.user.role !== 'SUPER_ADMIN') {
      router.replace(`${base}/dashboard`);
      return;
    }
    setToken(session.accessToken);
    setSelfId(session.user.id);
  }, [tenant, base, router]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const result = await getStaff(tenant, token);
      setItems(result.items);
      setError(null);
    } catch (caught) {
      logApiError(caught);
      if (caught instanceof ApiRequestError && caught.status === 401) {
        clearSession(tenant);
        router.replace(`${base}/login`);
        return;
      }
      setError('تعذّر تحميل الموظفين.');
    } finally {
      setLoading(false);
    }
  }, [tenant, token, base, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitForm = useCallback(
    async (values: StaffFormValues) => {
      if (!token) return;
      setSubmitting(true);
      setFormError(null);
      try {
        if (editing) {
          await updateStaff(tenant, token, editing.id, {
            firstName: values.firstName.trim(),
            lastName: values.lastName.trim(),
            email: values.email.trim(),
            role: values.role,
            // Absent means "keep the current one" — the server treats an
            // omitted password as no change rather than a reset.
            ...(values.password ? { password: values.password } : {}),
          });
        } else {
          await createStaff(tenant, token, {
            firstName: values.firstName.trim(),
            lastName: values.lastName.trim(),
            email: values.email.trim(),
            password: values.password,
            role: values.role,
          });
        }
        setFormOpen(false);
        setEditing(null);
        await load();
      } catch (caught) {
        logApiError(caught);
        setFormError(
          caught instanceof ApiRequestError ? caught.message : 'تعذّر حفظ الحساب.',
        );
      } finally {
        setSubmitting(false);
      }
    },
    [tenant, token, editing, load],
  );

  const toggleActive = useCallback(
    async (staff: StaffSummary) => {
      if (!token) return;
      setBusyId(staff.id);
      const reactivating = !staff.isActive;
      try {
        await setStaffActive(tenant, token, staff.id, reactivating);
        await load();
        toast.success(reactivating ? 'تمت إعادة تفعيل الحساب' : 'تم تعطيل الحساب', {
          description: reactivating
            ? `${staff.fullName} — يستطيع تسجيل الدخول من جديد.`
            : `${staff.fullName} — لن يستطيع تسجيل الدخول. الحساب وسجل نشاطه محفوظان.`,
        });
      } catch (caught) {
        logApiError(caught);
        const message =
          caught instanceof ApiRequestError ? caught.message : 'تعذّر تحديث الحساب.';
        setError(message);
        toast.error('تعذّر تحديث الحساب', { description: message });
      } finally {
        setBusyId(null);
      }
    },
    [tenant, token, load, toast],
  );

  const removeStaff = useCallback(
    async (staff: StaffSummary) => {
      if (!token) throw new Error('انتهت الجلسة.');
      setBusyId(staff.id);
      try {
        await deleteStaff(tenant, token, staff.id);
        await load();
        toast.success('تم حذف الحساب', { description: staff.fullName });
      } catch (caught) {
        logApiError(caught);
        const message =
          caught instanceof ApiRequestError ? caught.message : 'تعذّر حذف الحساب.';
        setError(message);
        // Rethrown so the dialog stays open with the reason in place — the
        // server refuses the last SUPER_ADMIN, and that is worth reading.
        throw new Error(message);
      } finally {
        setBusyId(null);
      }
    },
    [tenant, token, load, toast],
  );

  const columns = useMemo<ColumnDef<StaffSummary>[]>(
    () => [
      {
        accessorKey: 'fullName',
        header: 'الاسم',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.original.fullName}</span>
            {row.original.id === selfId ? <Badge variant="outline">أنت</Badge> : null}
          </div>
        ),
      },
      {
        accessorKey: 'email',
        header: 'البريد الإلكتروني',
        cell: ({ row }) => (
          <a
            href={`mailto:${row.original.email}`}
            dir="ltr"
            className="inline-flex items-center gap-1.5 text-primary hover:underline"
          >
            <Mail className="size-3.5 shrink-0" aria-hidden />
            {row.original.email}
          </a>
        ),
      },
      {
        accessorKey: 'role',
        header: 'الصلاحية',
        cell: ({ row }) => (
          <Badge variant={row.original.role === 'SUPER_ADMIN' ? 'default' : 'secondary'}>
            {ar.staffRole?.[row.original.role as never] ?? row.original.role}
          </Badge>
        ),
      },
      {
        accessorKey: 'isActive',
        header: 'الحالة',
        cell: ({ row }) =>
          row.original.isActive ? (
            <Badge className="gap-1.5 border-emerald-600/30 bg-emerald-600/10 py-1 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" variant="outline">
              <CheckCircle2 className="size-3.5" aria-hidden />
              فعّال
            </Badge>
          ) : (
            <Badge className="gap-1.5 py-1" variant="outline">
              <Ban className="size-3.5" aria-hidden />
              معطّل
            </Badge>
          ),
      },
      {
        accessorKey: 'lastLoginAt',
        header: 'آخر دخول',
        cell: ({ row }) =>
          row.original.lastLoginAt
            ? formatDate(row.original.lastLoginAt)
            : '—',
      },
      {
        id: 'actions',
        header: 'إجراء',
        enableSorting: false,
        // Pinned to the card footer on a phone rather than rendered as a
        // label/value row, which squeezed four icon buttons into a
        // right-aligned <dd>.
        meta: { mobile: 'actions' },
        cell: ({ row }) => {
          const staff = row.original;
          const isSelf = staff.id === selfId;
          const busy = busyId === staff.id;
          // Erasing an account that has reviewed a claim would strip the name
          // off that decision, so the option only exists while there is
          // nothing to orphan. The server enforces the same rule.
          const deletable = staff.historyCount === 0 && !isSelf;

          return (
            <div className="flex items-center gap-1.5">
              <ActionTooltip label="تعديل">
                <Button
                  variant="secondary"
                  size="icon-sm"
                  aria-label="تعديل"
                  disabled={busy}
                  onClick={() => {
                    setEditing(staff);
                    setFormError(null);
                    setFormOpen(true);
                  }}
                >
                  <Pencil className="size-4" aria-hidden />
                </Button>
              </ActionTooltip>

              {!isSelf ? (
                <ActionTooltip label={staff.isActive ? 'إلغاء التفعيل' : 'إعادة التفعيل'}>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={staff.isActive ? 'إلغاء التفعيل' : 'إعادة التفعيل'}
                    disabled={busy}
                    onClick={() => void toggleActive(staff)}
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : staff.isActive ? (
                      <Ban className="size-4" aria-hidden />
                    ) : (
                      <RotateCcw className="size-4" aria-hidden />
                    )}
                  </Button>
                </ActionTooltip>
              ) : null}

              {deletable ? (
                <ActionTooltip label="حذف نهائي — لا سجل نشاطات لهذا الحساب">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="حذف نهائي"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={busy}
                    onClick={() => setPendingDelete(staff)}
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
    [selfId, busyId, toggleActive, removeStaff],
  );

  if (!token) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col items-start justify-between gap-4 border-b pb-6 md:flex-row md:items-center">
        <div className="space-y-2">
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
            <UsersRound className="size-7 text-primary" aria-hidden />
            الموظفون
          </h1>
          <p className="text-sm text-muted-foreground">
            إنشاء حسابات موظفي البلدية وتعديل صلاحياتها
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormError(null);
            setFormOpen(true);
          }}
        >
          <UserPlus className="size-4" aria-hidden />
          إضافة موظف
        </Button>
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
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-lg">
            <UsersRound className="size-5" aria-hidden />
            حسابات الموظفين
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            إلغاء التفعيل يمنع الدخول ويُبقي سجل نشاطات الموظف كما هو. الحذف النهائي متاح
            فقط لحساب لم يقم بأي إجراء.
          </p>
        </CardHeader>
        <CardContent className="p-6">
          <DataTable
            columns={columns}
            data={items}
            labels={TABLE_LABELS}
            columnStorageKey="staff"
            getRowId={(row) => row.id}
            loading={loading}
            onRetry={() => void load()}
          />
        </CardContent>
      </Card>

      <StaffForm
        open={formOpen}
        editing={editing}
        submitting={submitting}
        error={formError}
        onOpenChange={(next) => {
          setFormOpen(next);
          if (!next) setEditing(null);
        }}
        onSubmit={(values) => void submitForm(values)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="حذف الحساب نهائياً"
        description={
          pendingDelete ? (
            <>
              سيُحذف حساب{' '}
              <span className="font-semibold text-foreground">{pendingDelete.fullName}</span> ولن
              يستطيع تسجيل الدخول. سجل نشاطه في «سجل النشاطات» يبقى كما هو.
              {/* The gentler option, offered at the moment the harsher one is
                  being considered: disabling keeps the account attributable in
                  the audit trail, and is what most of these actually want. */}
              <span className="mt-2 block text-muted-foreground">
                إن كان الهدف منع الدخول مؤقتاً، «التعطيل» يكفي ويمكن التراجع عنه.
              </span>
            </>
          ) : null
        }
        confirmLabel="حذف نهائي"
        requireText={pendingDelete?.email}
        requireTextHint="اكتب البريد الإلكتروني للحساب للتأكيد"
        onConfirm={async () => {
          if (pendingDelete) await removeStaff(pendingDelete);
        }}
      />
    </div>
  );
}
