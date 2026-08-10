'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ArrowLeftRight,
  Banknote,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Loader2,
  Receipt,
  Search,
  UserCheck,
  UserRound,
} from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import {
  ApiRequestError,
  getAllPayments,
  getCitizenProfile,
  getMunicipalitySettings,
  getTenantConfig,
  logApiError,
} from '@/lib/api-client';
import type {
  AdminPaymentItem,
  CitizenProfile,
  CitizenProfilePayment,
  MunicipalitySettings,
} from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { formatLbp } from '@/lib/currency';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type DataTableLabels } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { ActionTooltip } from '@/components/ui/tooltip';
import { PaymentReceipt } from '@/components/admin/payment-receipt';
import { cn } from '@/lib/utils';

const TABLE_LABELS: DataTableLabels = {
  searchAriaLabel: 'بحث في العمليات',
  searchPlaceholder: 'ابحث باسم الدافع أو رقمه المرجعي…',
  clearSearch: 'مسح البحث',
  empty: 'لا توجد عمليات دفع بعد.',
  emptySearch: 'لا نتائج مطابقة لبحثك.',
  loadError: 'تعذّر تحميل سجل العمليات.',
  retry: 'إعادة المحاولة',
  previous: 'السابق',
  next: 'التالي',
  pageOf: 'صفحة {current} من {total}',
  rowsPerPage: 'عدد الصفوف',
  totalRows: '{count} عملية',
  sortAscending: 'ترتيب تصاعدي',
  sortDescending: 'ترتيب تنازلي',
  sortNone: 'إلغاء الترتيب',
};

/** The method filter, as a segmented row above the table. */
const METHOD_FILTERS = [
  { id: '', label: 'الكل', icon: ArrowLeftRight },
  { id: 'CASH', label: 'نقداً', icon: Banknote },
  { id: 'WHISH_MONEY', label: 'Whish', icon: CreditCard },
  { id: 'COLLECTOR', label: 'المحصّل', icon: UserCheck },
] as const;

/** Badge tone and glyph per method — one place, so the filter and the row agree. */
const METHOD_STYLE = {
  CASH: { icon: Banknote, className: 'border-success/40 bg-success/10 text-success' },
  WHISH_MONEY: { icon: CreditCard, className: 'border-primary/40 bg-primary/10 text-primary' },
  COLLECTOR: { icon: UserCheck, className: 'border-warning/40 bg-warning/10 text-warning' },
} as const;

/**
 * Formats a transaction stamp as one line a clerk can scan.
 *
 * Latin digits and an explicit `dir="ltr"` on the element that renders this:
 * a date and a time read left-to-right even inside an Arabic sentence, and
 * letting the bidi algorithm guess puts the minutes before the hour often
 * enough to matter on a page whose whole job is when money moved.
 */
function formatStamp(iso: string): { date: string; time: string } {
  const value = new Date(iso);
  return {
    date: value.toLocaleDateString('ar-LB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }),
    time: value.toLocaleTimeString('ar-LB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  };
}

/**
 * سجل العمليات — every payment transaction in the municipality.
 *
 * Deliberately not the fees ledger with different columns. That screen answers
 * "who owes what", is grouped by citizen and ordered by who to chase; this one
 * answers "what has been paid", is one row per transaction and ordered by when
 * the money moved. An invoice nobody has paid appears on the first and not
 * here — it is an obligation, not a transaction.
 *
 * Read-only by design. Taking money, confirming a transfer and refusing one all
 * live in إدارة الرسوم next to the balance they change; duplicating them here
 * would put two screens in a position to disagree about the same row. The one
 * action that is not a mutation — reprinting a وصل — is here, because looking
 * up a past transaction is exactly when a citizen asks for one.
 */
export default function PaymentsPage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const router = useRouter();
  const base = `/${tenant}/${locale}/${adminPath}`;

  const [token, setToken] = useState<string | null>(null);
  const [items, setItems] = useState<AdminPaymentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<string>('');
  /**
   * `search` is what the box shows; `appliedSearch` is what the server was
   * asked for. Kept apart so typing does not fire a request per keystroke —
   * the load effect keys off the debounced one only.
   */
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [receiptBusyId, setReceiptBusyId] = useState<string | null>(null);

  const [settings, setSettings] = useState<MunicipalitySettings | null>(null);
  const [municipalityName, setMunicipalityName] = useState('');
  const [receipt, setReceipt] = useState<{
    citizen: CitizenProfile;
    payment: CitizenProfilePayment;
    received: number;
  } | null>(null);

  useEffect(() => {
    const session = loadSession(tenant);
    if (!session || session.user.kind !== 'STAFF') {
      router.replace(`${base}/login`);
      return;
    }
    setToken(session.accessToken);
  }, [tenant, base, router]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [paymentsResult, settingsResult, configResult] = await Promise.all([
        getAllPayments(tenant, token, {
          transactionsOnly: true,
          method: method || undefined,
          search: appliedSearch || undefined,
        }),
        // Both only so a reprinted وصل carries the same office numbers the
        // original did — neither is rendered on this page.
        getMunicipalitySettings(tenant, token),
        getTenantConfig(tenant),
      ]);
      setItems(paymentsResult.items);
      setSettings(settingsResult);
      setMunicipalityName(configResult.nameAr || configResult.name);
      setError(null);
    } catch (caught) {
      logApiError(caught);
      if (caught instanceof ApiRequestError && caught.status === 401) {
        clearSession(tenant);
        router.replace(`${base}/login`);
        return;
      }
      setError('تعذّر تحميل سجل العمليات.');
    } finally {
      setLoading(false);
    }
  }, [tenant, token, base, router, method, appliedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  // 300ms: long enough that a name typed at speed is one request, short enough
  // that the table has moved by the time the clerk looks up from the keyboard.
  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  /** Reprints the وصل for one transaction, exactly as إدارة الرسوم does. */
  const openReceipt = useCallback(
    async (payment: AdminPaymentItem) => {
      if (!token) return;
      setReceiptBusyId(payment.id);
      try {
        const profile = await getCitizenProfile(tenant, token, payment.citizenId);
        const row = profile.payments.find((entry) => entry.id === payment.id);
        if (!row) return;
        setReceipt({ citizen: profile, payment: row, received: payment.paidAmount });
      } catch (caught) {
        logApiError(caught);
        setError('تعذّر فتح الوصل — يمكن إصداره من ملف المواطن.');
      } finally {
        setReceiptBusyId(null);
      }
    },
    [tenant, token],
  );

  const copyId = useCallback((id: string) => {
    void navigator.clipboard?.writeText(id);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
  }, []);

  const totals = useMemo(() => {
    const confirmed = items.filter((item) => item.paidAmount > 0);
    return {
      count: items.length,
      collected: confirmed.reduce((sum, item) => sum + item.paidAmount, 0),
      cash: confirmed.filter((item) => item.paymentMethod === 'CASH').length,
      whish: confirmed.filter((item) => item.paymentMethod === 'WHISH_MONEY').length,
      collector: confirmed.filter((item) => item.paymentMethod === 'COLLECTOR').length,
      awaiting: items.filter((item) => item.paymentStatus === 'PENDING_REVIEW').length,
    };
  }, [items]);

  const columns = useMemo<ColumnDef<AdminPaymentItem>[]>(
    () => [
      {
        id: 'reference',
        accessorFn: (row) => row.id,
        header: 'رقم العملية',
        enableSorting: false,
        cell: ({ row }) => {
          const payment = row.original;
          // A UUID is unreadable and unquotable in full. The last segment is
          // what a clerk reads back over the phone; the copy button is what
          // gets the whole thing into a message or a ticket.
          const short = payment.id.split('-').at(-1) ?? payment.id;
          return (
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs uppercase text-muted-foreground" dir="ltr">
                {short}
              </span>
              <ActionTooltip label={copiedId === payment.id ? 'تم النسخ' : 'نسخ الرقم الكامل'}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => copyId(payment.id)}
                  aria-label="نسخ رقم العملية"
                >
                  {copiedId === payment.id ? (
                    <CheckCircle2 className="size-3.5 text-success" aria-hidden />
                  ) : (
                    <Copy className="size-3.5" aria-hidden />
                  )}
                </Button>
              </ActionTooltip>
            </div>
          );
        },
      },
      {
        accessorKey: 'citizenName',
        header: 'الدافع',
        cell: ({ row }) => {
          const payment = row.original;
          return (
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
              >
                <UserRound className="size-4" />
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="truncate font-medium">{payment.citizenName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {payment.citizenReference ? (
                    <span className="font-mono" dir="ltr">
                      {payment.citizenReference}
                    </span>
                  ) : null}
                  {payment.citizenReference ? ' · ' : ''}
                  {payment.title}
                </p>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'paidAmount',
        header: 'المبلغ',
        cell: ({ row }) => {
          const payment = row.original;
          // A claimed transfer has moved nothing yet, so the figure shown is
          // the invoice's — labelled, so it is not mistaken for money in hand.
          const claimed = payment.paidAmount === 0;
          const partial = payment.paidAmount > 0 && payment.remaining > 0;
          return (
            <div className="space-y-0.5 text-end">
              <p className="font-semibold tabular-nums">
                {formatLbp(claimed ? payment.amount : payment.paidAmount)}
              </p>
              {claimed ? (
                <p className="text-xs text-muted-foreground">مبلغ المطالبة</p>
              ) : partial ? (
                <p className="text-xs text-warning">
                  دفعة جزئية · متبقٍ {formatLbp(payment.remaining)}
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: 'paymentMethod',
        header: 'طريقة الدفع',
        cell: ({ row }) => {
          const payment = row.original;
          if (!payment.paymentMethod) return <span className="text-muted-foreground">—</span>;
          const style =
            METHOD_STYLE[payment.paymentMethod as keyof typeof METHOD_STYLE] ??
            METHOD_STYLE.CASH;
          const Icon = style.icon;
          return (
            <div className="space-y-1">
              <Badge variant="outline" className={cn('gap-1.5', style.className)}>
                <Icon className="size-3" aria-hidden />
                {ar.paymentMethod[payment.paymentMethod as never] ?? payment.paymentMethod}
              </Badge>
              {payment.whishTransactionRef ? (
                <p className="font-mono text-[11px] text-muted-foreground" dir="ltr">
                  {payment.whishTransactionRef}
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        id: 'receipt',
        accessorFn: (row) => (row.paidAmount > 0 ? 1 : 0),
        header: 'الوصل',
        cell: ({ row }) => {
          const payment = row.original;
          // There is no stored "receipt was printed" flag anywhere in this
          // system — a وصل is rendered on demand from the committed figures.
          // So the honest status is whether one *can* be issued, which is true
          // exactly when money has been received against the row.
          if (payment.paidAmount <= 0) {
            return (
              <Badge variant="outline" className="gap-1.5 text-muted-foreground">
                <Clock className="size-3" aria-hidden />
                بانتظار التأكيد
              </Badge>
            );
          }
          return (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={receiptBusyId === payment.id}
              onClick={() => void openReceipt(payment)}
            >
              {receiptBusyId === payment.id ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Receipt className="size-3.5" aria-hidden />
              )}
              إصدار الوصل
            </Button>
          );
        },
      },
      {
        id: 'stamp',
        accessorFn: (row) => row.paidAt ?? row.updatedAt,
        header: 'التاريخ والوقت',
        cell: ({ row }) => {
          const payment = row.original;
          const exact = payment.paidAt !== null;
          const { date, time } = formatStamp(payment.paidAt ?? payment.updatedAt);
          const stamp = (
            <div className="space-y-0.5" dir="ltr">
              <p className="text-sm tabular-nums">{date}</p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {exact ? time : `~ ${time}`}
              </p>
            </div>
          );

          // A part-payment never gets a `paidAt` — the server only stamps one
          // on full settlement — so this falls back to the row's last write.
          // It is marked rather than presented as the payment time, because a
          // figure a clerk might reconcile against a cash drawer has to say
          // when it is an approximation.
          return exact ? (
            stamp
          ) : (
            <ActionTooltip label="وقت آخر تحديث للسجل — لا يُسجَّل وقت دقيق للدفعات الجزئية">
              <span className="cursor-help border-b border-dashed border-muted-foreground/40">
                {stamp}
              </span>
            </ActionTooltip>
          );
        },
      },
    ],
    [copiedId, copyId, openReceipt, receiptBusyId],
  );

  if (!token) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        icon={ArrowLeftRight}
        title="سجل العمليات"
        subtitle="كل عملية دفع في البلدية — من دفع، وبأي طريقة، ومتى"
      />

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryTile label="عدد العمليات" value={totals.count.toLocaleString('en-US')} />
        <SummaryTile label="إجمالي المحصّل" value={formatLbp(totals.collected)} />
        <SummaryTile
          label="نقداً / Whish / محصّل"
          value={`${totals.cash} / ${totals.whish} / ${totals.collector}`}
          hint="عمليات مؤكّدة"
        />
        <SummaryTile
          label="بانتظار التأكيد"
          value={totals.awaiting.toLocaleString('en-US')}
          tone={totals.awaiting > 0 ? 'warning' : undefined}
        />
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-6">
          <DataTable
            columns={columns}
            data={items}
            labels={TABLE_LABELS}
            getRowId={(row) => row.id}
            loading={loading}
            error={error}
            onRetry={() => void load()}
            emptyIcon={<ArrowLeftRight className="h-10 w-10 text-muted-foreground/60" />}
            /*
              The built-in search box is off, and the one in the toolbar
              replaces it, because search here has to be the server's: it
              matches the citizen's phone and رقم مرجعي, neither of which is a
              column, so the client's row filter would drop rows the server
              correctly found.

              `manual` would have been the obvious way to say that, and is the
              wrong lever — it also switches off the sorted and paginated row
              models, leaving every row on one unsortable page unless the
              caller drives pagination too. Turning off only the search keeps
              client sorting and paging over whatever the server returned.
            */
            searchable={false}
            toolbar={
              <div className="flex w-full flex-wrap items-center gap-2 sm:justify-between">
                <div className="relative w-full sm:max-w-xs">
                  <Search
                    className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    type="search"
                    aria-label={TABLE_LABELS.searchAriaLabel}
                    className="h-10 ps-9"
                    placeholder={TABLE_LABELS.searchPlaceholder}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>

                <div
                  role="group"
                  aria-label="تصفية بطريقة الدفع"
                  className="inline-flex items-center gap-0.5 rounded-lg border bg-muted/60 p-0.5"
                >
                  {METHOD_FILTERS.map((filter) => {
                    const Icon = filter.icon;
                    const selected = method === filter.id;
                    return (
                      <button
                        key={filter.id || 'all'}
                        type="button"
                        onClick={() => setMethod(filter.id)}
                        aria-pressed={selected}
                        className={cn(
                          'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                          selected
                            ? 'bg-background font-medium text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Icon className="size-3.5 shrink-0" aria-hidden />
                        {filter.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            }
          />
        </CardContent>
      </Card>

      {receipt ? (
        <PaymentReceipt
          open
          onOpenChange={(next) => {
            if (!next) setReceipt(null);
          }}
          citizen={receipt.citizen}
          payment={receipt.payment}
          receivedAmount={receipt.received}
          municipalityName={municipalityName}
          contactPhone={settings?.contactPhone}
          officeWhatsapp={settings?.whatsappNumber}
        />
      ) : null}
    </div>
  );
}

/** A compact figure above the table — no icon chip, so the table stays the page. */
function SummaryTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'warning';
}) {
  return (
    <Card className={cn(tone === 'warning' && 'border-warning/50 ring-1 ring-warning/20')}>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-xl font-bold tabular-nums">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
