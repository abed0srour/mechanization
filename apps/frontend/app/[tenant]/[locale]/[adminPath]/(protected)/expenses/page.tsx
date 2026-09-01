'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Archive,
  ArchiveRestore,
  BarChart3,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import { EXPENSE_CATEGORY, getLabels } from '@mechanization/shared-schemas';
import {
  ApiRequestError,
  archiveExpense,
  createExpense,
  getExpenses,
  getExpenseSummary,
  logApiError,
  restoreExpense,
  updateExpense,
} from '@/lib/api-client';
import type { AdminExpenseItem } from '@/lib/api-client';
import { loadSession } from '@/lib/session';
import { useStaffQuery } from '@/lib/use-staff-query';
import { formatDate } from '@/lib/dates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type DataTableLabels } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { ChartCard, ColumnChart } from '@/components/admin/charts';
import { ExpenseDialog, type ExpenseValues } from '@/components/admin/expense-dialog';
import { cn } from '@/lib/utils';

/** `1,234.5 USD` / `1,234,567 LBP` — LBP has no minor unit, the other two do. */
function formatMoney(amount: number, currency: string): string {
  const digits = currency === 'LBP' ? 0 : 2;
  return `${amount.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${currency}`;
}

/** `2026-08` → `أغسطس` / `Aug`. */
function monthLabel(month: string, locale: string, style: 'short' | 'long'): string {
  const [year, index] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, (index ?? 1) - 1, 1));
  return date.toLocaleDateString(locale === 'en' ? 'en-US' : 'ar-LB-u-nu-latn', {
    month: style,
    year: style === 'long' ? 'numeric' : undefined,
    timeZone: 'UTC',
  });
}

function getTableLabels(locale: string): DataTableLabels {
  if (locale === 'en') {
    return {
      searchAriaLabel: 'Search expenses',
      searchPlaceholder: 'Search by description, payee, or reference…',
      clearSearch: 'Clear search',
      searchHint: 'Enter',
      searchApplied: 'Search: "{term}"',
      empty: 'No expenses recorded yet.',
      emptyHint: 'Record your first expense using the "New Expense" button above.',
      emptySearch: 'No results match your search.',
      emptySearchHint: 'Try searching by description, payee, or reference.',
      loadError: 'Failed to load the expenses register.',
      retry: 'Retry',
      previous: 'Previous',
      next: 'Next',
      pageOf: 'Page {current} of {total}',
      rowsPerPage: 'Rows per page',
      totalRows: '{count} expenses',
      sortAscending: 'Sort ascending',
      sortDescending: 'Sort descending',
      sortNone: 'Clear sorting',
      columns: 'Columns',
      columnsHint: 'Visible columns',
      resetColumns: 'Reset to default',
    };
  }
  return {
    searchAriaLabel: 'بحث في المصاريف',
    searchPlaceholder: 'ابحث بالوصف أو المستفيد أو المرجع…',
    clearSearch: 'مسح البحث',
    searchHint: 'Enter',
    searchApplied: 'بحث: «{term}»',
    empty: 'لا توجد مصاريف مسجّلة بعد.',
    emptyHint: 'سجّل أول مصروف من زر «مصروف جديد» أعلاه.',
    emptySearch: 'لا توجد نتائج مطابقة لبحثك.',
    emptySearchHint: 'جرّب البحث بالوصف أو المستفيد أو المرجع.',
    loadError: 'تعذّر تحميل سجل المصاريف.',
    retry: 'إعادة المحاولة',
    previous: 'السابق',
    next: 'التالي',
    pageOf: 'صفحة {current} من {total}',
    rowsPerPage: 'عدد الصفوف',
    totalRows: '{count} مصروف',
    sortAscending: 'ترتيب تصاعدي',
    sortDescending: 'ترتيب تنازلي',
    sortNone: 'إلغاء الترتيب',
    columns: 'الأعمدة',
    columnsHint: 'الأعمدة الظاهرة',
    resetColumns: 'استعادة الافتراضي',
  };
}

export default function ExpensesPage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;

  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | undefined>();

  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [archived, setArchived] = useState(false);
  const [appliedSearch, setAppliedSearch] = useState('');
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminExpenseItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<AdminExpenseItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const toast = useToast();
  // AUDITOR reads the books; only these two roles write to them — the same
  // split as every other financial mutation in this app.
  const canManage = role === 'SUPER_ADMIN' || role === 'ACCOUNTANT';

  useEffect(() => {
    const session = loadSession(tenant);
    if (!session || session.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }
    setToken(session.accessToken);
    setRole(session.user.role);
  }, [tenant, base, router]);

  const expensesQuery = useStaffQuery({
    queryKey: [
      'expenses',
      tenant,
      categoryFilter,
      archived,
      appliedSearch,
      pagination.pageIndex,
      pagination.pageSize,
    ],
    queryFn: (accessToken, signal) =>
      getExpenses(
        tenant,
        accessToken,
        {
          category: categoryFilter || undefined,
          archived,
          search: appliedSearch || undefined,
          limit: pagination.pageSize,
          offset: pagination.pageIndex * pagination.pageSize,
        },
        signal,
      ),
    tenant,
    base,
    token,
    errorMessage: 'تعذّر تحميل سجل المصاريف.',
    keepPrevious: true,
  });

  const summaryQuery = useStaffQuery({
    queryKey: ['expenses-summary', tenant],
    queryFn: (accessToken) => getExpenseSummary(tenant, accessToken),
    tenant,
    base,
    token,
    errorMessage: 'تعذّر تحميل ملخّص المصاريف.',
  });

  const items = expensesQuery.data?.items ?? [];
  const total = expensesQuery.data?.total ?? 0;
  const summary = summaryQuery.data ?? null;
  const loading = expensesQuery.loading;
  const refreshing = expensesQuery.fetching || summaryQuery.fetching;
  const error = expensesQuery.error;

  const queryClient = useQueryClient();
  const load = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['expenses', tenant] }),
        queryClient.invalidateQueries({ queryKey: ['expenses-summary', tenant] }),
      ]),
    [queryClient, tenant],
  );

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    setDialogOpen(true);
  };
  const openEdit = (expense: AdminExpenseItem) => {
    setEditing(expense);
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSubmit = async (values: ExpenseValues) => {
    if (!token) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const input = {
        category: values.category,
        description: values.description,
        amount: Number(values.amount),
        currency: values.currency,
        expenseDate: values.expenseDate,
        payee: values.payee || undefined,
        paymentMethod: values.paymentMethod,
        reference: values.reference || undefined,
        notes: values.notes || undefined,
      };
      if (editing) {
        await updateExpense(tenant, token, editing.id, input);
        toast.success(locale === 'en' ? 'Expense updated.' : 'تم تعديل المصروف.');
      } else {
        await createExpense(tenant, token, input);
        toast.success(locale === 'en' ? 'Expense recorded.' : 'تم تسجيل المصروف.');
      }
      setDialogOpen(false);
      void load();
    } catch (caught) {
      logApiError(caught);
      const message =
        caught instanceof ApiRequestError
          ? caught.message
          : locale === 'en'
            ? 'Could not save the expense.'
            : 'تعذّر حفظ المصروف.';
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRestore = useCallback(
    async (expense: AdminExpenseItem) => {
      if (!token || busyId) return;
      setBusyId(expense.id);
      try {
        await restoreExpense(tenant, token, expense.id);
        toast.success(locale === 'en' ? 'Expense restored.' : 'تمت استعادة المصروف.');
        void load();
      } catch (caught) {
        logApiError(caught);
        toast.error(locale === 'en' ? 'Could not restore the expense.' : 'تعذّر استعادة المصروف.');
      } finally {
        setBusyId(null);
      }
    },
    [tenant, token, busyId, toast, locale, load],
  );

  const labels = getLabels(locale);
  const tableLabels = getTableLabels(locale);

  const categoryOptions = [
    { id: '', label: locale === 'en' ? 'All Categories' : 'كل الفئات' },
    ...EXPENSE_CATEGORY.map((option) => ({ id: option, label: labels.expenseCategory[option] })),
  ];

  const monthlyChart = useMemo(
    () =>
      (summary?.byMonth ?? []).map((entry) => ({
        label: monthLabel(entry.month, locale, 'short'),
        title: monthLabel(entry.month, locale, 'long'),
        value: entry.amount,
      })),
    [summary, locale],
  );

  const columns = useMemo<ColumnDef<AdminExpenseItem>[]>(
    () => [
      {
        accessorKey: 'expenseDate',
        header: locale === 'en' ? 'Date' : 'التاريخ',
        cell: ({ row }) => (
          <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
            {formatDate(row.original.expenseDate)}
          </span>
        ),
      },
      {
        accessorKey: 'category',
        header: locale === 'en' ? 'Category' : 'الفئة',
        cell: ({ row }) => (
          <Badge variant="soft-muted" className="whitespace-nowrap text-xs">
            {labels.expenseCategory[row.original.category as never] ?? row.original.category}
          </Badge>
        ),
      },
      {
        accessorKey: 'description',
        header: locale === 'en' ? 'Description' : 'الوصف',
        meta: { mobile: 'primary' },
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">{row.original.description}</p>
            {row.original.payee ? (
              <p className="text-xs text-muted-foreground">{row.original.payee}</p>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: 'paymentMethod',
        header: locale === 'en' ? 'Method' : 'طريقة الدفع',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {labels.expensePaymentMethod[row.original.paymentMethod as never] ??
              row.original.paymentMethod}
          </span>
        ),
      },
      {
        accessorKey: 'amount',
        header: locale === 'en' ? 'Amount' : 'المبلغ',
        meta: { align: 'end' },
        cell: ({ row }) => (
          <span className="font-mono text-sm font-semibold tabular-nums whitespace-nowrap">
            {formatMoney(row.original.amount, row.original.currency)}
          </span>
        ),
      },
      {
        accessorKey: 'reference',
        header: locale === 'en' ? 'Reference' : 'المرجع',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
            {row.original.reference || '—'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: locale === 'en' ? 'Actions' : 'الإجراءات',
        meta: { align: 'end' },
        cell: ({ row }) => {
          const expense = row.original;
          const isBusy = busyId === expense.id;
          if (!canManage) return null;

          return (
            <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
              {expense.archived ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={isBusy}
                  onClick={() => void handleRestore(expense)}
                >
                  {isBusy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <ArchiveRestore className="size-3.5 rtl:ml-1.5 ltr:mr-1.5" />
                  )}
                  {locale === 'en' ? 'Restore' : 'استعادة'}
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => openEdit(expense)}
                  >
                    <Pencil className="size-3.5 rtl:ml-1.5 ltr:mr-1.5" />
                    {locale === 'en' ? 'Edit' : 'تعديل'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-destructive hover:bg-destructive/10"
                    onClick={() => setArchiveTarget(expense)}
                  >
                    <Archive className="size-3.5 rtl:ml-1.5 ltr:mr-1.5" />
                    {locale === 'en' ? 'Archive' : 'أرشفة'}
                  </Button>
                </>
              )}
            </div>
          );
        },
      },
    ],
    [locale, labels, canManage, busyId, handleRestore],
  );

  if (!token) return null;

  return (
    <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        icon={Wallet}
        title={locale === 'en' ? 'Expenses' : 'المصاريف'}
        subtitle={
          locale === 'en'
            ? 'Money the municipality spends — salaries, maintenance, fuel, and the like'
            : 'المبالغ التي تنفقها البلدية — رواتب، صيانة، محروقات وما شابه'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={refreshing}>
              <RefreshCw
                className={cn('size-4 rtl:ml-1.5 ltr:mr-1.5', refreshing && 'animate-spin')}
                aria-hidden
              />
              {locale === 'en' ? 'Refresh' : 'تحديث'}
            </Button>
            {canManage ? (
              <Button size="sm" onClick={openCreate}>
                <Plus className="size-4 rtl:ml-1.5 ltr:mr-1.5" />
                {locale === 'en' ? 'New Expense' : 'مصروف جديد'}
              </Button>
            ) : null}
          </div>
        }
      />

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {/* Summary: totals by category, and the monthly trend beside it */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground">
              {locale === 'en' ? 'Last 12 Months' : 'آخر ١٢ شهراً'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summaryQuery.loading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-bold tabular-nums">
                {formatMoney(summary?.total ?? 0, 'LBP')}
              </div>
            )}
            <ul className="space-y-2 border-t pt-3">
              {(summary?.byCategory ?? []).slice(0, 6).map((entry) => (
                <li key={entry.category} className="flex items-center justify-between gap-2 text-xs">
                  <Badge variant="soft-muted" className="whitespace-nowrap">
                    {labels.expenseCategory[entry.category as never] ?? entry.category}
                  </Badge>
                  <span className="font-mono font-medium tabular-nums text-muted-foreground">
                    {formatMoney(entry.total, 'LBP')}
                  </span>
                </li>
              ))}
              {!summaryQuery.loading && (summary?.byCategory.length ?? 0) === 0 ? (
                <li className="text-xs text-muted-foreground">
                  {locale === 'en' ? 'No expenses in this window.' : 'لا مصاريف في هذه الفترة.'}
                </li>
              ) : null}
            </ul>
          </CardContent>
        </Card>

        <ChartCard
          className="lg:col-span-2"
          title={locale === 'en' ? 'Monthly Trend' : 'الاتجاه الشهري'}
          description={locale === 'en' ? 'Total spent per month, last 12 months' : 'إجمالي الإنفاق شهرياً، آخر ١٢ شهراً'}
          icon={BarChart3}
          table={{
            columns: locale === 'en' ? ['Month', 'Amount (LBP)'] : ['الشهر', 'المبلغ (ل.ل)'],
            rows: (summary?.byMonth ?? []).map((entry) => [
              monthLabel(entry.month, locale, 'long'),
              entry.amount.toLocaleString('en-US'),
            ]),
          }}
        >
          <ColumnChart
            data={monthlyChart}
            color="var(--viz-series-2)"
            yLabel={locale === 'en' ? 'Amount (LBP)' : 'المبلغ (ل.ل)'}
            formatValue={(value) => formatMoney(value, 'LBP')}
          />
        </ChartCard>
      </div>

      {/* Main Table Card */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b pb-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              <Receipt className="size-5 text-primary" />
              {locale === 'en' ? 'Expenses Register' : 'سجل المصاريف'}
            </CardTitle>

            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={categoryFilter}
                onValueChange={(next) => {
                  setCategoryFilter(next === '__all__' ? '' : next);
                  setPagination((previous) =>
                    previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 },
                  );
                }}
              >
                <SelectTrigger className="h-9 w-44 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((option) => (
                    <SelectItem key={option.id || '__all__'} value={option.id || '__all__'}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Active / Archived segmented switch */}
              <div className="flex items-center gap-1 rounded-xl bg-muted p-1">
                {[
                  { id: false, label: locale === 'en' ? 'Active' : 'نشطة' },
                  { id: true, label: locale === 'en' ? 'Archived' : 'مؤرشفة' },
                ].map((tab) => (
                  <button
                    key={String(tab.id)}
                    type="button"
                    onClick={() => {
                      setArchived(tab.id);
                      setPagination((previous) =>
                        previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 },
                      );
                    }}
                    className={cn(
                      'rounded-lg px-3 py-1 text-xs font-semibold transition-all cursor-pointer',
                      archived === tab.id
                        ? 'bg-card text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6">
          <DataTable
            columns={columns}
            data={items}
            labels={tableLabels}
            columnStorageKey="expenses"
            getRowId={(row) => row.id}
            loading={loading}
            error={expensesQuery.error}
            onRetry={expensesQuery.refetch}
            emptyIcon={<Wallet className="size-10 text-muted-foreground/60" />}
            manualPagination
            manualFiltering
            sortable={false}
            pageCount={Math.max(Math.ceil(total / pagination.pageSize), 1)}
            totalRowCount={total}
            pagination={pagination}
            onPaginationChange={setPagination}
            searchValue={appliedSearch}
            onSearchChange={setAppliedSearch}
          />
        </CardContent>
      </Card>

      <ExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        expense={editing}
        submitting={submitting}
        error={formError}
        onSubmit={handleSubmit}
        locale={locale}
      />

      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(next) => {
          if (!next) setArchiveTarget(null);
        }}
        title={locale === 'en' ? 'Archive this expense?' : 'أرشفة هذا المصروف؟'}
        description={
          locale === 'en'
            ? 'It will be hidden from reports and totals. You can restore it from the Archived tab at any time.'
            : 'سيُخفى من التقارير والمجاميع. يمكنك استعادته من تبويب «مؤرشفة» في أي وقت.'
        }
        confirmLabel={locale === 'en' ? 'Archive' : 'أرشفة'}
        cancelLabel={locale === 'en' ? 'Cancel' : 'إلغاء'}
        onConfirm={async () => {
          if (!token || !archiveTarget) return;
          await archiveExpense(tenant, token, archiveTarget.id);
          toast.success(locale === 'en' ? 'Expense archived.' : 'تمت أرشفة المصروف.');
          void load();
        }}
      />
    </div>
  );
}
