'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  Banknote,
  CheckCircle2,
  ChevronUp,
  Clock,
  Eye,
  Loader2,
  PauseCircle,
  PlayCircle,
  Receipt,
  RefreshCw,
  Save,
  Search,
  UserPlus,
  Wallet,
  XCircle,
} from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import {
  ApiRequestError,
  chargeCitizen,
  getAllPayments,
  getFeeNotices,
  getFeeSummary,
  getMunicipalitySettings,
  getPendingPayments,
  issueFeeNotice,
  listCitizens,
  logApiError,
  reviewPayment,
  runRecurringBilling,
  setNoticeActive,
  settlePayment,
  updateMunicipalitySettings,
} from '@/lib/api-client';
import type {
  AdminPaymentItem,
  CitizenListItem,
  FeeNoticeSummary,
  FeeSummary,
  MunicipalitySettings,
  PendingPayment,
} from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { formatLbp } from '@/lib/currency';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { IssueFeeDialog, type IssueFeeValues } from '@/components/admin/issue-fee-dialog';
import {
  ChargeCitizenDialog,
  type ChargeValues,
} from '@/components/admin/charge-citizen-dialog';
import {
  SettlePaymentDialog,
  type SettleValues,
} from '@/components/admin/settle-payment-dialog';

/**
 * LBP has no minor unit in practice — whole pounds, grouped.
 *
 * Kept as a local alias rather than three call sites reaching for the shared
 * name: this screen prints exact figures throughout (it is the ledger), so it
 * deliberately does not use the compacting `Money` the citizens registry does.
 */
const lbp = formatLbp;

/**
 * إدارة الرسوم والمدفوعات.
 *
 * Three jobs on one screen because they are one job in practice: issue what
 * the municipality is owed, confirm what has arrived, and keep the transfer
 * details the citizen portal quotes correct.
 */
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
  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const [notices, setNotices] = useState<FeeNoticeSummary[]>([]);
  const [pending, setPending] = useState<PendingPayment[]>([]);
  const [citizens, setCitizens] = useState<CitizenListItem[]>([]);
  const [settings, setSettings] = useState<MunicipalitySettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState({
    whishMoneyNumber: '',
    cashOfficeHours: '',
    cashOfficeAddress: '',
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [ledger, setLedger] = useState<AdminPaymentItem[]>([]);
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [chargeOpen, setChargeOpen] = useState(false);
  const [charging, setCharging] = useState(false);
  const [chargeError, setChargeError] = useState<string | null>(null);
  const [runningBilling, setRunningBilling] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [busyPaymentId, setBusyPaymentId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Which citizen's itemised breakdown is open, if any. */
  const [expandedCitizen, setExpandedCitizen] = useState<string | null>(null);
  const [settling, setSettling] = useState<AdminPaymentItem | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);

  /**
   * The ledger, one row per citizen.
   *
   * Grouped in the browser rather than by a second endpoint because the flat
   * list is already loaded and already scoped by the same search — a grouped
   * query would be a second round trip that could disagree with the rows it
   * summarises. `outstanding` sums the *balance* of each unsettled invoice,
   * which is what makes a part-payment visible here at all.
   */
  const byCitizen = useMemo(() => {
    const groups = new Map<
      string,
      {
        citizenId: string;
        citizenName: string;
        citizenReference: string | null;
        items: AdminPaymentItem[];
        billed: number;
        outstanding: number;
        overdueCount: number;
      }
    >();

    for (const payment of ledger) {
      const group = groups.get(payment.citizenId) ?? {
        citizenId: payment.citizenId,
        citizenName: payment.citizenName,
        citizenReference: payment.citizenReference,
        items: [],
        billed: 0,
        outstanding: 0,
        overdueCount: 0,
      };
      group.items.push(payment);
      group.billed += payment.amount;
      if (payment.paymentStatus !== 'PAID') group.outstanding += payment.remaining;
      if (payment.paymentStatus === 'OVERDUE') group.overdueCount += 1;
      groups.set(payment.citizenId, group);
    }

    // Most owed first: the point of this screen is who to chase.
    return [...groups.values()].sort((a, b) => b.outstanding - a.outstanding);
  }, [ledger]);

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
      const [
        summaryResult,
        noticesResult,
        pendingResult,
        settingsResult,
        registryResult,
        ledgerResult,
      ] = await Promise.all([
        getFeeSummary(tenant, token),
        getFeeNotices(tenant, token),
        getPendingPayments(tenant, token),
        getMunicipalitySettings(tenant, token),
        listCitizens(tenant, token, { limit: 200 }),
        getAllPayments(tenant, token, { search: ledgerSearch || undefined }),
      ]);

      setSummary(summaryResult);
      setNotices(noticesResult.items);
      setPending(pendingResult.items);
      setLedger(ledgerResult.items);
      setSettings(settingsResult);
      setSettingsDraft({
        whishMoneyNumber: settingsResult.whishMoneyNumber ?? '',
        cashOfficeHours: settingsResult.cashOfficeHours ?? '',
        cashOfficeAddress: settingsResult.cashOfficeAddress ?? '',
      });
      setCitizens(registryResult.items);
      setError(null);
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
    }
  }, [tenant, token, base, router, ledgerSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitFee = useCallback(
    async (values: IssueFeeValues) => {
      if (!token) return;
      setIssuing(true);
      setIssueError(null);
      try {
        const result = await issueFeeNotice(tenant, token, {
          title: values.title.trim(),
          amount: Number(values.amount.replace(/\D/g, '')),
          frequency: values.frequency,
          targetType: values.targetType,
          ...(values.targetType === 'BUILDING_CATEGORY'
            ? { targetCategory: values.targetCategory }
            : {}),
          ...(values.targetType === 'INDIVIDUAL_CITIZEN'
            ? { targetCitizenId: values.targetCitizenId }
            : {}),
          dueDate: new Date(values.dueDate).toISOString(),
          ...(values.instructions.trim() ? { instructions: values.instructions.trim() } : {}),
        });

        setIssueOpen(false);
        setNotice(`تم إصدار ${result.issued} مطالبة.`);
        await load();
      } catch (caught) {
        logApiError(caught);
        setIssueError(
          caught instanceof ApiRequestError ? caught.message : 'تعذّر إصدار الرسم.',
        );
      } finally {
        setIssuing(false);
      }
    },
    [tenant, token, load],
  );

  const submitCharge = useCallback(
    async (values: ChargeValues) => {
      if (!token) return;
      setCharging(true);
      setChargeError(null);
      try {
        await chargeCitizen(tenant, token, {
          citizenId: values.citizenId,
          title: values.title.trim(),
          amount: Number(values.amount.replace(/\D/g, '')),
          dueDate: new Date(values.dueDate).toISOString(),
        });
        setChargeOpen(false);
        setNotice('تمت إضافة المطالبة.');
        await load();
      } catch (caught) {
        logApiError(caught);
        setChargeError(
          caught instanceof ApiRequestError ? caught.message : 'تعذّر إضافة المطالبة.',
        );
      } finally {
        setCharging(false);
      }
    },
    [tenant, token, load],
  );

  /** Money handed over at the counter — straight to PAID, no review step. */
  /**
   * Records a payment — full or partial — against one invoice.
   *
   * The `confirm()` that used to gate this is gone: it asked "settle the full
   * amount?" with no way to say "half", which is the whole thing partial
   * payments exist to allow. The dialog that replaced it *is* the confirmation,
   * and it shows the balance being paid down rather than a figure the clerk
   * cannot change.
   */
  const recordCash = useCallback(
    async ({ amount, note }: SettleValues) => {
      const target = settling;
      if (!token || !target) return;

      setBusyPaymentId(target.id);
      setSettleError(null);
      try {
        await settlePayment(tenant, token, target.id, { method: 'CASH', amount, note });
        setSettling(null);
        setNotice(
          amount < target.remaining
            ? `تم تسجيل دفعة جزئية بقيمة ${lbp(amount)} — متبقٍ ${lbp(target.remaining - amount)}.`
            : 'تم تسجيل الدفعة بالكامل.',
        );
        await load();
      } catch (caught) {
        logApiError(caught);
        setSettleError(
          caught instanceof ApiRequestError ? caught.message : 'تعذّر تسجيل الدفعة.',
        );
      } finally {
        setBusyPaymentId(null);
      }
    },
    [tenant, token, load, settling],
  );

  /**
   * Runs tonight's biller now. Safe to press twice — the job is idempotent
   * within a period, so a second click reports zero new invoices.
   */
  const runBillingNow = useCallback(async () => {
    if (!token) return;
    setRunningBilling(true);
    try {
      const result = await runRecurringBilling(tenant, token);
      setNotice(
        result.invoicesCreated > 0
          ? `تم إصدار ${result.invoicesCreated} مطالبة للدورة الحالية.`
          : 'لا توجد مطالبات جديدة — الدورة الحالية مُصدرة بالفعل.',
      );
      await load();
    } catch (caught) {
      logApiError(caught);
      setError(caught instanceof ApiRequestError ? caught.message : 'تعذّر تشغيل الإصدار.');
    } finally {
      setRunningBilling(false);
    }
  }, [tenant, token, load]);

  const toggleNotice = useCallback(
    async (id: string, next: boolean) => {
      if (!token) return;
      try {
        await setNoticeActive(tenant, token, id, next);
        await load();
      } catch (caught) {
        logApiError(caught);
        setError(caught instanceof ApiRequestError ? caught.message : 'تعذّر تحديث الرسم.');
      }
    },
    [tenant, token, load],
  );

  const saveSettings = useCallback(async () => {
    if (!token) return;
    setSavingSettings(true);
    try {
      const saved = await updateMunicipalitySettings(tenant, token, settingsDraft);
      setSettings(saved);
      setNotice('تم حفظ إعدادات الدفع.');
    } catch (caught) {
      logApiError(caught);
      setError(caught instanceof ApiRequestError ? caught.message : 'تعذّر حفظ الإعدادات.');
    } finally {
      setSavingSettings(false);
    }
  }, [tenant, token, settingsDraft]);

  const decide = useCallback(
    async (payment: PendingPayment, confirmed: boolean) => {
      if (!token) return;
      // A refusal has to say why — the citizen sees this note next to a bill
      // they believed was settled.
      const note = confirmed
        ? undefined
        : (prompt(`سبب رفض دفعة ${payment.citizenName} *:`) ?? '').trim();
      if (!confirmed && !note) return;

      setBusyPaymentId(payment.id);
      try {
        await reviewPayment(tenant, token, payment.id, { confirmed, note });
        await load();
      } catch (caught) {
        logApiError(caught);
        setError(caught instanceof ApiRequestError ? caught.message : 'تعذّر تحديث الدفعة.');
      } finally {
        setBusyPaymentId(null);
      }
    },
    [tenant, token, load],
  );

  if (!token) return null;

  const canManage = role === 'SUPER_ADMIN';

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col items-start justify-between gap-4 border-b pb-6 md:flex-row md:items-center">
        <div className="space-y-2">
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
            <Receipt className="size-7 text-primary" aria-hidden />
            إدارة الرسوم والمدفوعات
          </h1>
          <p className="text-sm text-muted-foreground">
            إصدار الرسوم على المواطنين، وتأكيد الدفعات الواردة
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setChargeError(null);
                setChargeOpen(true);
              }}
            >
              <UserPlus className="size-4" aria-hidden />
              إضافة مطالبة لمواطن
            </Button>
            <Button
              onClick={() => {
                setIssueError(null);
                setIssueOpen(true);
              }}
            >
              <Receipt className="size-4" aria-hidden />
              إصدار رسم جديد
            </Button>
          </div>
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
      {notice ? (
        <p className="rounded-lg border border-success/40 bg-success/5 p-4 text-sm">{notice}</p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="إجمالي المستحقات"
          value={summary ? lbp(summary.unpaidTotal) : '—'}
          hint={summary ? `${summary.unpaidCount} مطالبة` : ''}
          icon={<Wallet className="size-6 text-destructive" aria-hidden />}
          accent="bg-destructive/10"
          loading={loading}
        />
        <MetricCard
          label="قيد المراجعة"
          value={summary ? String(summary.pendingReviewCount) : '—'}
          hint="دفعات بانتظار التأكيد"
          icon={<Clock className="size-6 text-warning" aria-hidden />}
          accent="bg-warning/10"
          loading={loading}
        />
        <MetricCard
          label="إجمالي المحصّل"
          value={summary ? lbp(summary.paidTotal) : '—'}
          hint={summary ? `${summary.paidCount} دفعة` : ''}
          icon={<BadgeCheck className="size-6 text-success" aria-hidden />}
          accent="bg-success/10"
          loading={loading}
        />
        <MetricCard
          label="الرسوم المُصدرة"
          value={String(notices.length)}
          hint="إشعارات فعّالة"
          icon={<Banknote className="size-6 text-primary" aria-hidden />}
          loading={loading}
        />
      </div>

      {/* The verification queue leads, because it is the only part of this
          screen where someone is waiting on the municipality. */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="size-5" aria-hidden />
            دفعات بانتظار التأكيد {pending.length > 0 ? `(${pending.length})` : ''}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            أكّد وصول المبلغ إلى حساب البلدية قبل اعتماد الدفعة.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {pending.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">لا توجد دفعات بانتظار المراجعة.</p>
          ) : (
            <ul className="divide-y">
              {pending.map((payment) => (
                <li
                  key={payment.id}
                  className="flex flex-wrap items-center justify-between gap-4 p-4"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">{payment.citizenName}</p>
                    <p className="text-sm text-muted-foreground">
                      {payment.title} · {lbp(payment.amount)} ·{' '}
                      {ar.paymentMethod[payment.paymentMethod as never] ?? '—'}
                    </p>
                    {payment.whishTransactionRef ? (
                      <p className="text-xs text-muted-foreground">
                        رقم العملية:{' '}
                        <span className="font-mono" dir="ltr">
                          {payment.whishTransactionRef}
                        </span>
                      </p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyPaymentId === payment.id}
                        onClick={() => void decide(payment, false)}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <XCircle className="size-4" aria-hidden />
                        رفض
                      </Button>
                      <Button
                        size="sm"
                        disabled={busyPaymentId === payment.id}
                        onClick={() => void decide(payment, true)}
                      >
                        {busyPaymentId === payment.id ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <CheckCircle2 className="size-4" aria-hidden />
                        )}
                        تأكيد الاستلام
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* The ledger: every invoice in the municipality, and where a clerk
          records cash taken over the counter. */}
      <Card>
        <CardHeader className="flex-col gap-4 border-b md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wallet className="size-5" aria-hidden />
              سجل المطالبات
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              كل المطالبات الصادرة. سجّل الدفعات النقدية من هنا.
            </p>
          </div>
          <div className="relative w-full md:w-72">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="h-10 ps-9"
              placeholder="ابحث باسم المواطن أو رقمه المرجعي…"
              value={ledgerSearch}
              onChange={(event) => setLedgerSearch(event.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {byCitizen.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">لا توجد مطالبات مطابقة.</p>
          ) : (
            /*
              One row per citizen, not per invoice.
              A resident billed monthly accumulates a row a month, and the flat
              list repeated their name down the whole page — three postings of
              500,000 and 5,000,000 read as three separate people owing three
              separate debts, with no total anywhere. Grouping puts the
              accumulated balance on one line and moves the individual charges
              behind «عرض», which is also where they get cleared one by one.
            */
            <ul className="divide-y">
              {byCitizen.map((group) => {
                const expanded = expandedCitizen === group.citizenId;
                return (
                  <li key={group.citizenId}>
                    <div className="flex flex-wrap items-center justify-between gap-4 p-4">
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium">{group.citizenName}</p>
                        <p className="text-sm text-muted-foreground">
                          <span className="font-mono" dir="ltr">
                            {group.citizenReference ?? '—'}
                          </span>{' '}
                          · {group.items.length} مطالبة
                          {group.overdueCount > 0 ? (
                            <span className="text-destructive">
                              {' '}
                              · {group.overdueCount} متأخرة
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="text-end">
                          <p className="font-semibold tabular-nums">
                            {lbp(group.outstanding)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            من أصل {lbp(group.billed)}
                          </p>
                        </div>
                        {group.outstanding === 0 ? (
                          <Badge
                            variant="outline"
                            className="border-success/40 bg-success/10 text-success"
                          >
                            مسدَّد بالكامل
                          </Badge>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          aria-expanded={expanded}
                          onClick={() =>
                            setExpandedCitizen(expanded ? null : group.citizenId)
                          }
                        >
                          {expanded ? (
                            <ChevronUp className="size-4" aria-hidden />
                          ) : (
                            <Eye className="size-4" aria-hidden />
                          )}
                          {expanded ? 'إخفاء' : 'عرض'}
                        </Button>
                      </div>
                    </div>

                    {/* The itemised breakdown: every posting on its own line,
                        each settleable on its own. */}
                    {expanded ? (
                      <ul className="divide-y border-t bg-muted/20">
                        {group.items.map((payment) => {
                          const settled = payment.paymentStatus === 'PAID';
                          const partly = !settled && payment.paidAmount > 0;
                          return (
                            <li
                              key={payment.id}
                              className="flex flex-wrap items-center justify-between gap-3 py-3 pe-4 ps-10"
                            >
                              <div className="min-w-0 space-y-0.5">
                                <p className="text-sm font-medium">{payment.title}</p>
                                <p className="text-xs text-muted-foreground">
                                  استحقاق{' '}
                                  {new Date(payment.dueDate).toLocaleDateString('ar-LB')}
                                  {partly
                                    ? ` · مسدَّد ${lbp(payment.paidAmount)} من ${lbp(payment.amount)}`
                                    : ''}
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold tabular-nums">
                                  {lbp(settled ? payment.amount : payment.remaining)}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={
                                    payment.paymentStatus === 'PAID'
                                      ? 'border-success/40 bg-success/10 text-success'
                                      : payment.paymentStatus === 'OVERDUE'
                                        ? 'border-destructive/40 bg-destructive/10 text-destructive'
                                        : 'border-warning/40 bg-warning/10 text-warning'
                                  }
                                >
                                  {ar.paymentStatus[payment.paymentStatus as never] ??
                                    payment.paymentStatus}
                                </Badge>
                                {canManage && !settled ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={busyPaymentId === payment.id}
                                    onClick={() => {
                                      setSettleError(null);
                                      setSettling(payment);
                                    }}
                                  >
                                    {busyPaymentId === payment.id ? (
                                      <Loader2 className="size-4 animate-spin" aria-hidden />
                                    ) : (
                                      <Banknote className="size-4" aria-hidden />
                                    )}
                                    تسجيل دفعة
                                  </Button>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-col gap-3 border-b md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Banknote className="size-5" aria-hidden />
              الرسوم المُصدرة
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              تُصدر الرسوم المتكرّرة تلقائياً كل دورة. يمكنك تشغيل الإصدار الآن بدل
              انتظار التشغيل الليلي.
            </p>
          </div>
          {canManage ? (
            <Button variant="outline" onClick={() => void runBillingNow()} disabled={runningBilling}>
              {runningBilling ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-4" aria-hidden />
              )}
              إصدار الدورة الحالية
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {notices.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">لم يتم إصدار أي رسم بعد.</p>
          ) : (
            <ul className="divide-y">
              {notices.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">{item.title}</p>
                    <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                      <Badge variant="secondary">
                        {ar.feeFrequency[item.frequency as never] ?? item.frequency}
                      </Badge>
                      {item.frequency !== 'ONCE' && !item.isActive ? (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          <PauseCircle className="size-3" aria-hidden />
                          متوقّف
                        </Badge>
                      ) : null}
                      <Badge variant="outline">
                        {item.targetCitizenName ??
                          (item.targetCategory
                            ? (ar.feeTargetCategory[item.targetCategory as never] ??
                              item.targetCategory)
                            : (ar.feeTargetType[item.targetType as never] ?? item.targetType))}
                      </Badge>
                      <span>
                        استحقاق {new Date(item.dueDate).toLocaleDateString('ar-LB')}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-end">
                      <p className="font-semibold">{lbp(item.amount)}</p>
                      <p className="text-xs text-muted-foreground">{item.issuedCount} مطالبة</p>
                    </div>
                    {/* Only recurring notices have anything to stop — a
                        one-off fee has already done all it will ever do. */}
                    {canManage && item.frequency !== 'ONCE' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void toggleNotice(item.id, !item.isActive)}
                        title={
                          item.isActive
                            ? 'إيقاف الإصدار التلقائي للدورات القادمة'
                            : 'استئناف الإصدار التلقائي'
                        }
                      >
                        {item.isActive ? (
                          <>
                            <PauseCircle className="size-4" aria-hidden />
                            إيقاف التكرار
                          </>
                        ) : (
                          <>
                            <PlayCircle className="size-4" aria-hidden />
                            استئناف
                          </>
                        )}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Settings live beside the fees rather than on a separate page: the
          Whish number only exists to be printed on these invoices. */}
      {canManage ? (
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wallet className="size-5" aria-hidden />
              إعدادات الدفع
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              تظهر هذه المعلومات للمواطن عند الدفع. اتركها فارغة لإخفاء الخيار.
            </p>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <Field
              label="رقم حساب تحويل Whish Money"
              htmlFor="whish"
              hint="يظهر للمواطن لينسخه في تطبيق Whish."
            >
              <Input
                id="whish"
                dir="ltr"
                className="text-start"
                placeholder="+961 71 234 567"
                value={settingsDraft.whishMoneyNumber}
                onChange={(event) =>
                  setSettingsDraft((prev) => ({ ...prev, whishMoneyNumber: event.target.value }))
                }
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="أوقات دوام المالية" htmlFor="hours">
                <Input
                  id="hours"
                  placeholder="الإثنين–الجمعة، ٨:٠٠ – ١٤:٠٠"
                  value={settingsDraft.cashOfficeHours}
                  onChange={(event) =>
                    setSettingsDraft((prev) => ({ ...prev, cashOfficeHours: event.target.value }))
                  }
                />
              </Field>
              <Field label="عنوان مكتب الاستقبال" htmlFor="address">
                <Input
                  id="address"
                  placeholder="مبنى البلدية، الطابق الأول"
                  value={settingsDraft.cashOfficeAddress}
                  onChange={(event) =>
                    setSettingsDraft((prev) => ({
                      ...prev,
                      cashOfficeAddress: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {settings?.updatedAt
                  ? `آخر تحديث: ${new Date(settings.updatedAt).toLocaleString('ar-LB')}`
                  : 'لم تُضبط بعد'}
              </p>
              <Button onClick={() => void saveSettings()} disabled={savingSettings}>
                {savingSettings ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="size-4" aria-hidden />
                )}
                حفظ الإعدادات
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <IssueFeeDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        citizens={citizens}
        submitting={issuing}
        error={issueError}
        onSubmit={(values) => void submitFee(values)}
      />

      <SettlePaymentDialog
        open={settling !== null}
        onOpenChange={(next) => {
          if (!next) setSettling(null);
        }}
        payment={settling}
        submitting={busyPaymentId !== null}
        error={settleError}
        onSubmit={(values) => void recordCash(values)}
      />

      <ChargeCitizenDialog
        open={chargeOpen}
        onOpenChange={setChargeOpen}
        citizens={citizens}
        submitting={charging}
        error={chargeError}
        onSubmit={(values) => void submitCharge(values)}
      />
    </div>
  );
}

/** A headline figure with an accent icon chip. */
function MetricCard({
  label,
  value,
  hint,
  icon,
  accent = 'bg-accent',
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  accent?: string;
  loading: boolean;
}) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex items-center justify-between gap-3 p-5">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="truncate text-2xl font-bold">{loading ? '—' : value}</p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <div className={`rounded-lg p-3 ${accent}`}>{icon}</div>
      </CardContent>
    </Card>
  );
}
