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
  FileSpreadsheet,
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
import {
  ApiRequestError,
  deleteCitizen,
  importCitizens,
  listCitizens,
  logApiError,
  setCitizenActive,
} from '@/lib/api-client';
import { ImportCitizensDialog } from '@/components/admin/import-citizens-dialog';
import { PageHeader } from '@/components/ui/page-header';
import type { CitizenListItem } from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type DataTableLabels } from '@/components/ui/data-table';
import { Money } from '@/components/ui/money';
import { useToast } from '@/components/ui/toast';
import { ActionTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import { ar } from '@mechanization/shared-schemas';

/** Roles allowed to write. Mirrors the server; the server is the enforcement. */
const CAN_WRITE = ['SUPER_ADMIN', 'FIELD_INSPECTOR', 'ADMINISTRATIVE_OFFICER'];

const TABLE_LABELS: DataTableLabels = {
  searchAriaLabel: 'بحث في المواطنين',
  searchPlaceholder: 'ابحث بالاسم، رقم الهاتف، الرقم المرجعي، أو رقم الهوية…',
  clearSearch: 'مسح البحث',
  empty: 'لا يوجد مواطنون مسجّلون بعد.',
  emptyHint: 'أضف أول مواطن، أو استورد سجلاً من ملف Excel.',
  emptySearch: 'لا نتائج مطابقة لبحثك.',
  emptySearchHint: 'جرّب الاسم الأول وحده، أو الرقم المرجعي، أو رقم الهاتف بدون صفر البداية.',
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
  columns: 'الأعمدة',
  columnsHint: 'الأعمدة الظاهرة',
  resetColumns: 'استعادة الافتراضي',
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
  /**
   * The page and the search are request parameters now.
   *
   * The registry endpoint has always taken `limit`/`offset` and returned a
   * `total`; the page ignored all three, fetched the first 200 rows and then
   * paginated *those* in the browser. A municipality with more than 200
   * registered citizens was shown a page counter that described a slice, with
   * no way to reach the rest.
   */
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState({ outstanding: 0, overdue: 0, inArrears: 0 });
  /** The committed term — set when the clerk presses Enter, not as they type. */
  const [appliedSearch, setAppliedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  /** The row whose deletion is being confirmed, or null. */
  const [pendingDelete, setPendingDelete] = useState<CitizenListItem | null>(null);
  const toast = useToast();

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
      const result = await listCitizens(tenant, token, {
        search: appliedSearch || undefined,
        limit: pagination.pageSize,
        offset: pagination.pageIndex * pagination.pageSize,
      });
      setItems(result.items);
      setTotal(result.total);
      setTotals(result.totals);
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
  }, [tenant, token, base, router, appliedSearch, pagination]);

  // A new search starts at page one; otherwise it asks for rows 150–175 of a
  // set that may now have three.
  useEffect(() => {
    setPagination((previous) =>
      previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 },
    );
  }, [appliedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = useCallback(
    async (citizen: CitizenListItem) => {
      if (!token) return;
      setBusyId(citizen.id);
      const reactivating = !citizen.isActive;
      try {
        await setCitizenActive(tenant, token, citizen.id, reactivating);
        await load();
        toast.success(
          reactivating ? 'تمت إعادة تفعيل الملف' : 'تم تعطيل الملف',
          {
            description: reactivating
              ? `${citizen.fullName} — يمكن الآن إصدار رسوم جديدة على هذا الملف.`
              : `${citizen.fullName} — لن تُصدر رسوم جديدة. السجل والفواتير القائمة كما هي.`,
          },
        );
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

  /*
   * Deletion is confirmed in a dialog rather than `confirm()`.
   *
   * The browser's prompt is unstyled, LTR whatever the page direction, and
   * renders "\n\n" as literal characters in some browsers — so the sentence
   * naming what is about to be destroyed arrived as one run-on line. It also
   * offers a Cancel/OK pair that gives no clue which button is the
   * irreversible one. This asks for the citizen's own name to be typed, which
   * is the one confirmation muscle memory cannot dismiss.
   */
  const removeCitizen = useCallback(
    async (citizen: CitizenListItem) => {
      if (!token) throw new Error('انتهت الجلسة.');
      setBusyId(citizen.id);
      try {
        await deleteCitizen(tenant, token, citizen.id);
        await load();
        toast.success('تم حذف الملف نهائياً', { description: citizen.fullName });
      } catch (caught) {
        logApiError(caught);
        const message =
          caught instanceof ApiRequestError ? caught.message : 'تعذّر حذف الملف.';
        setError(message);
        // Rethrown so ConfirmDialog stays open and shows the reason in place:
        // a refusal usually names something the clerk must deal with first.
        throw new Error(message);
      } finally {
        setBusyId(null);
      }
    },
    [tenant, token, load, toast],
  );

  const columns = useMemo<ColumnDef<CitizenListItem>[]>(
    () => [
      {
        accessorKey: 'fullName',
        header: 'المواطن',
        // Never hideable: a citizens table without the citizen is a grid of
        // numbers belonging to nobody.
        enableHiding: false,
        meta: { label: 'المواطن' },
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
      /*
       * Phone and WhatsApp are two columns, not one stacked cell.
       *
       * They were one «التواصل» column with the WhatsApp number as a subtitle,
       * which made the pair inseparable: a clerk who works entirely over
       * WhatsApp could not drop the landline, and one who never uses WhatsApp
       * could not drop that. Split, each is a row in the columns menu and the
       * table becomes the one that particular desk needs.
       */
      {
        accessorKey: 'phone',
        header: 'الهاتف',
        meta: { label: 'الهاتف' },
        enableSorting: false,
        cell: ({ row }) => {
          const { phone } = row.original;
          if (!phone) return <span className="text-muted-foreground">—</span>;
          return (
            // Click-to-call: the first move on a questionable record is to
            // phone whoever is on it.
            <a
              href={`tel:${phone}`}
              dir="ltr"
              className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
            >
              <Phone className="size-3.5 shrink-0" aria-hidden />
              {phone}
            </a>
          );
        },
      },
      {
        accessorKey: 'whatsapp',
        header: 'واتساب',
        meta: { label: 'واتساب' },
        enableSorting: false,
        cell: ({ row }) => {
          const { phone, whatsapp } = row.original;
          if (!whatsapp) return <span className="text-muted-foreground">—</span>;
          return (
            <a
              // `wa.me` wants digits only — no spaces, no dashes, no leading
              // `+`. The stored string is whatever a clerk typed, so it is
              // normalised here rather than at rest, where it is printed for a
              // human to read and dial.
              href={`https://wa.me/${whatsapp.replace(/\D/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
              className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
            >
              <MessageCircle className="size-3.5 shrink-0" aria-hidden />
              {whatsapp}
              {/* Says "same number as the landline" without repeating it — the
                  common case, and worth distinguishing from a genuinely
                  separate WhatsApp line. */}
              {whatsapp === phone ? (
                <span className="text-xs text-muted-foreground">(نفس الهاتف)</span>
              ) : null}
            </a>
          );
        },
      },
      {
        accessorKey: 'identityDocNumber',
        header: 'وثيقة الهوية',
        meta: { label: 'وثيقة الهوية', mobile: 'hide' },
        enableSorting: false,
        cell: ({ row }) => {
          const { identityDocType, identityDocNumber } = row.original;
          if (!identityDocNumber) return <span className="text-muted-foreground">—</span>;
          return (
            <div className="space-y-0.5">
              <p className="font-mono text-sm" dir="ltr">
                {identityDocNumber}
              </p>
              {identityDocType ? (
                <p className="text-xs text-muted-foreground">
                  {ar.identityDocType?.[identityDocType as never] ?? identityDocType}
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: 'residentStatus',
        header: 'صفة الإقامة',
        meta: { label: 'صفة الإقامة', mobile: 'hide' },
        enableSorting: false,
        cell: ({ row }) => {
          const { residentStatus } = row.original;
          if (!residentStatus) return <span className="text-muted-foreground">—</span>;
          return (
            <Badge variant="soft-muted">
              {ar.residentStatus?.[residentStatus as never] ?? residentStatus}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'registeredAt',
        header: 'تاريخ التسجيل',
        meta: { label: 'تاريخ التسجيل', cellClassName: 'whitespace-nowrap', mobile: 'hide' },
        cell: ({ row }) => (
          <span className="text-sm">{formatDate(row.original.registeredAt)}</span>
        ),
      },
      {
        // Was «الطلبات» — a review-status badge over a filing count. A record
        // has no status to report now, so the column says what the citizen
        // actually has on the register: their properties, and when the
        // municipality last recorded one.
        accessorKey: 'propertyCount',
        header: 'العقارات',
        meta: { label: 'العقارات' },
        cell: ({ row }) => {
          const citizen = row.original;
          if (citizen.propertyCount === 0) {
            return <span className="text-sm text-muted-foreground">لا توجد عقارات</span>;
          }
          return (
            <div className="space-y-0.5">
              <p className="font-medium tabular-nums">{citizen.propertyCount} عقار</p>
              {citizen.latestSubmittedAt ? (
                <p className="whitespace-nowrap text-xs text-muted-foreground">
                  آخر تسجيل {formatDate(citizen.latestSubmittedAt)}
                </p>
              ) : null}
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
        meta: { label: 'الرسوم', cellClassName: 'whitespace-nowrap' },
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
        meta: { label: 'المتأخرات', cellClassName: 'whitespace-nowrap' },
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
        // Always on: hiding the row's own controls leaves a table nothing can
        // be done from, and no obvious way to get them back.
        enableHiding: false,

        enableSorting: false,
        // Pinned to the card footer on a phone rather than rendered as a
        // label/value row, which squeezed four icon buttons into a
        // right-aligned <dd>.
        meta: { label: 'إجراء', mobile: 'actions' },
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
                    onClick={() => setPendingDelete(citizen)}
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
    [base, busyId, canWrite, canDelete, toggleActive],
  );

  /**
   * Headline totals computed from the loaded page rather than fetched.
   *
   * The list endpoint already carries every number these need, so a second
   * round trip would only introduce a moment where the cards and the table
   * below them disagree.
   */

  if (!token) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        icon={Users}
        title="المواطنون"
        subtitle="سجل المواطنين المسجّلين لدى البلدية — البيانات والعقارات والرسوم المستحقة"
        actions={
          canWrite ? (
            <>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <FileSpreadsheet className="size-4" aria-hidden />
                استيراد من ملف
              </Button>
              <Link href={`${base}/citizens/new`} className={buttonVariants()}>
                <UserPlus className="size-4" aria-hidden />
                تسجيل مواطن جديد
              </Link>
            </>
          ) : null
        }
      />

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
          value={total.toLocaleString('en-US')}
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
            /*
              The column layout is a per-desk preference, remembered here.
              A clerk chasing arrears wants المتأخرات and no identity document;
              the one entering records wants the reverse — and re-picking it on
              every page load is what stops people using the feature at all.
            */
            columnStorageKey="citizens"
            /*
              Off by default. Eleven columns at once is a table nobody can read;
              these four are the ones a clerk turns on for a specific job — the
              identity document when verifying papers, صفة الإقامة when
              reporting, تاريخ التسجيل when auditing intake. واتساب starts
              hidden because it usually repeats the landline, and the pair is
              only worth two columns when a municipality actually works over it.
            */
            initialHiddenColumns={[
              'whatsapp',
              'identityDocNumber',
              'residentStatus',
              'registeredAt',
            ]}
            /*
              The registry can run to thousands of rows, so the page and the
              search both belong to the server. Sorting stays off rather than
              re-ordering the twenty-five rows in hand and calling it sorted;
              the server returns newest-registered first.
            */
            manualPagination
            manualFiltering
            sortable={false}
            pageCount={Math.max(Math.ceil(total / pagination.pageSize), 1)}
            totalRowCount={total}
            pagination={pagination}
            onPaginationChange={setPagination}
            /* The box holds its own draft; this fires once, on Enter. */
            searchValue={appliedSearch}
            onSearchChange={setAppliedSearch}
          />
        </CardContent>
      </Card>

      <ImportCitizensDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={(input) => {
          // `token` is non-null past the guard above; the dialog never renders
          // before it is set.
          if (!token) return Promise.reject(new Error('انتهت الجلسة.'));
          return importCitizens(tenant, token, input);
        }}
        onDone={() => void load()}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="حذف الملف نهائياً"
        description={
          pendingDelete ? (
            <>
              سيُحذف ملف <span className="font-semibold text-foreground">{pendingDelete.fullName}</span>{' '}
              بكل ما فيه: {pendingDelete.registrationCount} طلب، {pendingDelete.propertyCount} عقار،
              ومستنداته وفواتيره. لا يمكن التراجع.
              {pendingDelete.outstandingTotal > 0 ? (
                // Named rather than left to be discovered afterwards: deleting
                // a file with money owed against it deletes the debt too, and
                // that is a decision the municipality should make knowingly.
                <span className="mt-2 block font-medium text-destructive">
                  على هذا الملف رسوم غير مسدّدة — سيُحذف الدين معه.
                </span>
              ) : null}
            </>
          ) : null
        }
        confirmLabel="حذف نهائي"
        requireText={pendingDelete?.fullName}
        requireTextHint="اكتب اسم المواطن بالكامل للتأكيد"
        onConfirm={async () => {
          if (pendingDelete) await removeCitizen(pendingDelete);
        }}
      />
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
