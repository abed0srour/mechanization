'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock3,
  Filter,
  Loader2,
  MessageCircle,
  Plus,
  Receipt,
  RefreshCw,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import {
  ApiRequestError,
  chargeCitizen,
  getAllPayments,
  getCitizenProfile,
  getFeeNotices,
  getFeeSummary,
  getMunicipalitySettings,
  getTenantConfig,
  issueFeeNotice,
  listCitizens,
  logApiError,
  reviewPayment,
} from '@/lib/api-client';
import type {
  AdminPaymentItem,
  CitizenListItem,
  CitizenProfile,
  CitizenProfilePayment,
  FeeNoticeSummary,
  FeeSummary,
  MunicipalitySettings,
} from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { formatLbp } from '@/lib/currency';
import { formatDate } from '@/lib/dates';
import { buildWhatsAppReceiptUrl, getReceiptNumber } from '@/lib/whatsapp';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableLabels } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { ChargeCitizenDialog, type ChargeValues } from '@/components/admin/charge-citizen-dialog';
import { IssueFeeDialog, type IssueFeeValues } from '@/components/admin/issue-fee-dialog';
import { PaymentReceipt } from '@/components/admin/payment-receipt';
import { cn } from '@/lib/utils';

const TABLE_LABELS: DataTableLabels = {
  searchAriaLabel: 'بحث في الرسوم والمطالبات',
  searchPlaceholder: 'ابحث باسم المواطن أو الرسم أو الرقم المرجعي…',
  clearSearch: 'مسح البحث',
  empty: 'لا توجد رسوم أو مطالبات مسجّلة بعد.',
  emptyHint: 'أصدر أول رسم من زر «إصدار رسم جديد» أعلاه.',
  emptySearch: 'لا توجد نتائج مطابقة لبحثك.',
  emptySearchHint: 'جرّب البحث باسم المواطن، أو نوع الرسم، أو الرقم المرجعي.',
  loadError: 'تعذّر تحميل سجل الرسوم والمدفوعات.',
  retry: 'إعادة المحاولة',
  previous: 'السابق',
  next: 'التالي',
  pageOf: 'صفحة {current} من {total}',
  rowsPerPage: 'عدد الصفوف',
  totalRows: '{count} مطالبة',
  sortAscending: 'ترتيب تصاعدي',
  sortDescending: 'ترتيب تنازلي',
  sortNone: 'إلغاء الترتيب',
  columns: 'الأعمدة',
  columnsHint: 'الأعمدة الظاهرة',
  resetColumns: 'استعادة الافتراضي',
};

const STATUS_FILTERS = [
  { id: '', label: 'الكل' },
  { id: 'UNPAID', label: 'غير مسددة' },
  { id: 'OVERDUE', label: 'متأخرة' },
  { id: 'PENDING_REVIEW', label: 'قيد المراجعة' },
  { id: 'PAID', label: 'مدفوعة' },
] as const;

function initials(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '—';
  return `${words[0][0] ?? ''}${words.length > 1 ? (words[words.length - 1][0] ?? '') : ''}`;
}

export default function FeesPage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;

  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Table Data State
  const [items, setItems] = useState<AdminPaymentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const [citizens, setCitizens] = useState<CitizenListItem[]>([]);
  const [feeNotices, setFeeNotices] = useState<FeeNoticeSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [feeTypeFilter, setFeeTypeFilter] = useState<string>('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });

  // Dialogs State
  const [issueOpen, setIssueOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [charging, setCharging] = useState(false);
  const [busyPaymentId, setBusyPaymentId] = useState<string | null>(null);

  // Receipt State
  const [receipt, setReceipt] = useState<{
    citizen: CitizenProfile;
    payment: CitizenProfilePayment;
    received: number;
  } | null>(null);
  const [settings, setSettings] = useState<MunicipalitySettings | null>(null);
  const [municipalityName, setMunicipalityName] = useState('');

  const toast = useToast();
  const canManage = role === 'SUPER_ADMIN' || role === 'COLLECTOR';

  useEffect(() => {
    const session = loadSession(tenant);
    if (!session || session.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }
    setToken(session.accessToken);
    setRole(session.user.role);
  }, [tenant, base, router]);

  const load = useCallback(
    async (isManualRefresh = false) => {
      if (!token) return;
      if (isManualRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const [paymentsRes, summaryRes, settingsRes, configRes, citizensRes, noticesRes] =
          await Promise.allSettled([
            getAllPayments(tenant, token, {
              status: statusFilter || undefined,
              feeType: feeTypeFilter || undefined,
              search: appliedSearch || undefined,
              limit: pagination.pageSize,
              offset: pagination.pageIndex * pagination.pageSize,
            }),
            getFeeSummary(tenant, token),
            getMunicipalitySettings(tenant, token),
            getTenantConfig(tenant),
            listCitizens(tenant, token, { limit: 200 }),
            getFeeNotices(tenant, token),
          ]);

        if (paymentsRes.status === 'fulfilled') {
          setItems(paymentsRes.value.items);
          setTotal(paymentsRes.value.total);
        } else {
          logApiError(paymentsRes.reason);
          setError('تعذّر تحميل سجل الرسوم والمدفوعات.');
        }

        if (summaryRes.status === 'fulfilled') {
          setSummary(summaryRes.value);
        }

        if (settingsRes.status === 'fulfilled') {
          setSettings(settingsRes.value);
        }

        if (configRes.status === 'fulfilled') {
          setMunicipalityName(configRes.value.nameAr || configRes.value.name);
        }

        if (citizensRes.status === 'fulfilled') {
          setCitizens(citizensRes.value.items);
        }

        if (noticesRes.status === 'fulfilled') {
          setFeeNotices(noticesRes.value.items);
        }
      } catch (caught) {
        logApiError(caught);
        if (caught instanceof ApiRequestError && caught.status === 401) {
          clearSession(tenant);
          router.replace(`${base}/login`);
          return;
        }
        setError('تعذّر تحميل بيانات الرسوم.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [tenant, token, base, router, statusFilter, feeTypeFilter, appliedSearch, pagination],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Reset page index on search or filter change
  useEffect(() => {
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }));
  }, [statusFilter, feeTypeFilter, appliedSearch]);

  const availableFeeTypes = useMemo(() => {
    const defaults = ['نفايات', 'رخصة بناء', 'قيمة تأجيرية', 'صيانة وأرصفة', 'إشغال أملاك عامة'];
    const fromNotices = feeNotices.map((n) => n.title.trim());
    const fromItems = items.map((i) => i.title.trim());
    return Array.from(new Set([...defaults, ...fromNotices, ...fromItems].filter(Boolean)));
  }, [feeNotices, items]);

  const openReceipt = useCallback(
    async (citizenId: string, paymentId: string, receivedAmount: number) => {
      if (!token) return;
      setBusyPaymentId(paymentId);
      try {
        const profile = await getCitizenProfile(tenant, token, citizenId);
        const row = profile.payments.find((entry) => entry.id === paymentId);
        if (!row) {
          toast.error('تعذّر العثور على سجل الدفعة.');
          return;
        }
        setReceipt({ citizen: profile, payment: row, received: receivedAmount });
      } catch (caught) {
        logApiError(caught);
        toast.error('تعذّر فتح الوصل — يمكنك إصداره من ملف المواطن.');
      } finally {
        setBusyPaymentId(null);
      }
    },
    [tenant, token, toast],
  );

  const handleReview = async (paymentId: string, confirmed: boolean) => {
    if (!token || busyPaymentId) return;
    setBusyPaymentId(paymentId);
    try {
      await reviewPayment(tenant, token, paymentId, { confirmed });
      toast.success(confirmed ? 'تم تأكيد الدفعة بنجاح.' : 'تم رفض الدفعة.');
      void load();
    } catch (caught) {
      logApiError(caught);
      toast.error(caught instanceof ApiRequestError ? caught.message : 'تعذّر مراجعة الدفعة.');
    } finally {
      setBusyPaymentId(null);
    }
  };

  const handleIssueNotice = async (values: IssueFeeValues) => {
    if (!token) return;
    setIssuing(true);
    try {
      const res = await issueFeeNotice(tenant, token, {
        title: values.title,
        amount: Number(values.amount.replace(/\D/g, '')),
        frequency: values.frequency,
        targetType: values.targetType,
        targetCategory: values.targetCategory || undefined,
        targetCitizenId: values.targetCitizenId || undefined,
        dueDate: values.dueDate,
        instructions: values.instructions || undefined,
      });
      toast.success(`تم إصدار الرسم بنجاح وتكليف ${res.issued} مواطن.`);
      setIssueOpen(false);
      void load();
    } catch (caught) {
      logApiError(caught);
      toast.error(caught instanceof ApiRequestError ? caught.message : 'تعذّر إصدار الرسم.');
    } finally {
      setIssuing(false);
    }
  };

  const handleChargeCitizen = async (values: ChargeValues) => {
    if (!token) return;
    setCharging(true);
    try {
      await chargeCitizen(tenant, token, {
        citizenId: values.citizenId,
        title: values.title,
        amount: Number(values.amount.replace(/\D/g, '')),
        dueDate: values.dueDate,
      });
      toast.success('تم تسجيل التكليف المالي على المواطن بنجاح.');
      setChargeOpen(false);
      void load();
    } catch (caught) {
      logApiError(caught);
      toast.error(caught instanceof ApiRequestError ? caught.message : 'تعذّر تكليف المواطن.');
    } finally {
      setCharging(false);
    }
  };

  const columns = useMemo<ColumnDef<AdminPaymentItem>[]>(
    () => [
      {
        accessorKey: 'citizenName',
        header: 'المواطن',
        cell: ({ row }) => {
          const payment = row.original;
          return (
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary"
              >
                {initials(payment.citizenName)}
              </span>
              <div className="min-w-0 space-y-0.5">
                <Link
                  href={`${base}/citizens/${payment.citizenId}`}
                  className="truncate font-semibold text-foreground hover:text-primary transition-colors block"
                >
                  {payment.citizenName}
                </Link>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {payment.citizenReference ? (
                    <span className="font-mono text-[11px]" dir="ltr">
                      {payment.citizenReference}
                    </span>
                  ) : null}
                  {payment.citizenPhone ? (
                    <>
                      <span>•</span>
                      <span className="font-mono text-[11px]" dir="ltr">
                        {payment.citizenPhone}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'title',
        header: 'الرسم / المطالبة',
        cell: ({ row }) => {
          const payment = row.original;
          return (
            <div className="space-y-1">
              <p className="font-medium text-foreground">{payment.title}</p>
              {payment.frequency ? (
                <Badge variant="soft-muted" className="text-[10px] px-1.5 py-0">
                  {ar.feeFrequency[payment.frequency as never] ?? payment.frequency}
                </Badge>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: 'dueDate',
        header: 'تاريخ الاستحقاق',
        cell: ({ row }) => {
          return (
            <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
              {formatDate(row.original.dueDate)}
            </span>
          );
        },
      },
      {
        accessorKey: 'amount',
        header: 'قيمة الرسم',
        meta: { align: 'end' },
        cell: ({ row }) => (
          <span className="font-mono text-sm tabular-nums text-foreground whitespace-nowrap">
            {formatLbp(row.original.amount)}
          </span>
        ),
      },
      {
        accessorKey: 'paidAmount',
        header: 'المسدد',
        meta: { align: 'end' },
        cell: ({ row }) => {
          const paid = row.original.paidAmount;
          return (
            <span
              className={cn(
                'font-mono text-sm tabular-nums whitespace-nowrap',
                paid > 0 ? 'font-semibold text-success' : 'text-muted-foreground',
              )}
            >
              {paid > 0 ? formatLbp(paid) : '—'}
            </span>
          );
        },
      },
      {
        accessorKey: 'remaining',
        header: 'الرصيد المستحق',
        meta: { align: 'end' },
        cell: ({ row }) => {
          const remaining = row.original.remaining;
          const isPaid = row.original.paymentStatus === 'PAID';
          return (
            <span
              className={cn(
                'font-mono text-sm font-bold tabular-nums whitespace-nowrap',
                isPaid
                  ? 'text-muted-foreground line-through opacity-70'
                  : remaining > 0
                    ? 'text-foreground'
                    : 'text-success',
              )}
            >
              {formatLbp(remaining)}
            </span>
          );
        },
      },
      {
        accessorKey: 'paymentStatus',
        header: 'الحالة',
        cell: ({ row }) => {
          const status = row.original.paymentStatus;
          return (
            <Badge
              variant="outline"
              className={cn(
                'whitespace-nowrap px-2.5 py-0.5 text-xs font-medium',
                status === 'PAID'
                  ? 'border-success/40 bg-success/10 text-success'
                  : status === 'OVERDUE'
                    ? 'border-destructive/40 bg-destructive/10 text-destructive'
                    : status === 'PENDING_REVIEW'
                      ? 'border-warning/40 bg-warning/10 text-warning'
                      : 'border-border bg-muted/50 text-muted-foreground',
              )}
            >
              {ar.paymentStatus[status as never] ?? status}
            </Badge>
          );
        },
      },
      {
        id: 'actions',
        header: 'الإجراءات',
        meta: { align: 'end' },
        cell: ({ row }) => {
          const payment = row.original;
          const isPaid = payment.paymentStatus === 'PAID';
          const isPendingReview = payment.paymentStatus === 'PENDING_REVIEW';
          const isBusy = busyPaymentId === payment.id;

          return (
            <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
              {/* Review actions for claims pending review */}
              {isPendingReview && canManage ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs border-success/40 text-success hover:bg-success/10"
                    disabled={isBusy}
                    onClick={() => void handleReview(payment.id, true)}
                  >
                    {isBusy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-3.5 rtl:ml-1 ltr:mr-1" />
                    )}
                    تأكيد
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-destructive hover:bg-destructive/10"
                    disabled={isBusy}
                    onClick={() => void handleReview(payment.id, false)}
                  >
                    رفض
                  </Button>
                </>
              ) : null}

              {/* Settle button for unpaid / overdue / partial */}
              {canManage && !isPaid && !isPendingReview ? (
                <Link
                  href={`${base}/fees/payments/${payment.id}/settle`}
                  className={buttonVariants({ variant: 'default', size: 'sm' })}
                >
                  <Banknote className="size-3.5 rtl:ml-1.5 ltr:mr-1.5" />
                  تسجيل دفعة
                </Link>
              ) : null}

              {/* Receipt button for any invoice with payments */}
              {payment.paidAmount > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={isBusy}
                  onClick={() =>
                    void openReceipt(payment.citizenId, payment.id, payment.paidAmount)
                  }
                >
                  {isBusy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Receipt className="size-3.5 rtl:ml-1.5 ltr:mr-1.5" />
                  )}
                  وصل القبض
                </Button>
              ) : null}

              {/* WhatsApp Receipt Direct Trigger */}
              {payment.paidAmount > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs font-medium text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-800 dark:hover:text-emerald-300"
                  disabled={isBusy}
                  title="إرسال إشعار الدفع عبر واتساب"
                  onClick={() => {
                    const phone = payment.citizenPhone;
                    if (!phone) {
                      toast.error('لا يوجد رقم هاتف مسجّل لهذا المواطن.');
                      return;
                    }
                    const waUrl = buildWhatsAppReceiptUrl({
                      phone,
                      citizenName: payment.citizenName,
                      feeType: payment.title,
                      amount: payment.paidAmount || payment.amount,
                      receiptNumber: getReceiptNumber(payment.id),
                      paymentDate: payment.paidAt || payment.updatedAt,
                    });
                    if (waUrl) {
                      window.open(waUrl, '_blank', 'noopener,noreferrer');
                    } else {
                      toast.error('رقم الهاتف غير صالح للإرسال عبر واتساب.');
                    }
                  }}
                >
                  <MessageCircle className="size-3.5 rtl:ml-1.5 ltr:mr-1.5 text-emerald-600 dark:text-emerald-400 fill-emerald-600/20" />
                  واتساب
                </Button>
              ) : null}
            </div>
          );
        },
      },
    ],
    [base, canManage, busyPaymentId, openReceipt, toast],
  );

  if (!token) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        icon={Receipt}
        title="إدارة الرسوم والمدفوعات"
        subtitle="سجل الرسوم والمطالبات المالية للمواطنين — الإصدار والتحصيل والوصولات"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load(true)}
              disabled={refreshing}
            >
              <RefreshCw
                className={cn('size-4 rtl:ml-1.5 ltr:mr-1.5', refreshing && 'animate-spin')}
                aria-hidden
              />
              تحديث
            </Button>

            {canManage ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setChargeOpen(true)}>
                  <UserPlus className="size-4 rtl:ml-1.5 ltr:mr-1.5" />
                  تكليف مباشر
                </Button>
                <Button size="sm" onClick={() => setIssueOpen(true)}>
                  <Plus className="size-4 rtl:ml-1.5 ltr:mr-1.5" />
                  إصدار رسم جديد
                </Button>
              </>
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

      {/* KPI Cards Summary Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="إجمالي المحصّل"
          value={formatLbp(summary?.paidTotal ?? 0)}
          subtext={summary ? `${summary.paidCount} دفعة مسددة` : undefined}
          loading={loading}
          icon={<Wallet className="size-6 text-success" />}
          accent="bg-success/10"
        />
        <MetricCard
          label="المستحقات غير المسددة"
          value={formatLbp(summary?.unpaidTotal ?? 0)}
          subtext={summary ? `${summary.unpaidCount} مطالبة مطلوبة` : undefined}
          loading={loading}
          icon={<Banknote className="size-6 text-primary" />}
        />
        <MetricCard
          label="دفعات بانتظار التحقق"
          value={(summary?.pendingReviewCount ?? 0).toLocaleString('en-US')}
          subtext="تحويلات تحتاج موافقة الموظف"
          loading={loading}
          icon={<Clock3 className="size-6 text-warning" />}
          accent="bg-warning/10"
        />
        <MetricCard
          label="إجمالي الرسوم الصادرة"
          value={formatLbp((summary?.paidTotal ?? 0) + (summary?.unpaidTotal ?? 0))}
          subtext="المجموع الكلي للمطالبات"
          loading={loading}
          icon={<Receipt className="size-6 text-primary" />}
        />
      </div>

      {/* Main Table Card */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b pb-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              <Receipt className="size-5 text-primary" />
              سجل الرسوم والمطالبات
            </CardTitle>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Fee Type Dropdown Filter */}
              <div className="w-full sm:w-[200px]">
                <Select
                  value={feeTypeFilter || 'ALL'}
                  onValueChange={(val) => setFeeTypeFilter(val === 'ALL' ? '' : val)}
                >
                  <SelectTrigger className="h-8 text-xs bg-background">
                    <Filter className="size-3.5 rtl:ml-1.5 ltr:mr-1.5 text-muted-foreground" />
                    <SelectValue placeholder="نوع الرسم: الكل" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">جميع أنواع الرسوم</SelectItem>
                    {availableFeeTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Status Tabs Filter */}
              <div className="flex flex-wrap items-center gap-1 rounded-xl bg-muted p-1">
                {STATUS_FILTERS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusFilter(tab.id)}
                    className={cn(
                      'rounded-lg px-3 py-1 text-xs font-semibold transition-all',
                      statusFilter === tab.id
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
            labels={TABLE_LABELS}
            getRowId={(row) => row.id}
            loading={loading}
            onRetry={() => void load()}
            emptyIcon={<Receipt className="size-10 text-muted-foreground/60" />}
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

      {/* Issue Fee Dialog */}
      <IssueFeeDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        citizens={citizens}
        submitting={issuing}
        error={null}
        onSubmit={handleIssueNotice}
      />

      {/* Charge Citizen Dialog */}
      <ChargeCitizenDialog
        open={chargeOpen}
        onOpenChange={setChargeOpen}
        citizens={citizens}
        submitting={charging}
        error={null}
        onSubmit={handleChargeCitizen}
      />

      {/* Receipt Modal Dialog */}
      <PaymentReceipt
        open={receipt !== null}
        onOpenChange={(next) => {
          if (!next) {
            setReceipt(null);
            void load();
          }
        }}
        citizen={receipt?.citizen ?? ({} as CitizenProfile)}
        payment={receipt?.payment ?? null}
        municipalityName={municipalityName}
        contactPhone={settings?.contactPhone}
        officeWhatsapp={settings?.whatsappNumber}
        receivedAmount={receipt?.received}
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  subtext,
  loading,
  icon,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  subtext?: string;
  loading: boolean;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="h-7 w-28" />
          ) : (
            <div className="text-xl font-bold tracking-tight text-foreground">{value}</div>
          )}
          {subtext && !loading ? (
            <p className="text-[11px] text-muted-foreground">{subtext}</p>
          ) : null}
        </div>
        <div
          className={cn(
            'flex size-11 items-center justify-center rounded-xl bg-primary/10',
            accent,
          )}
        >
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}
