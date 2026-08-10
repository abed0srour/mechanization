'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  Banknote,
  CheckCircle2,
  ChevronUp,
  Clock,
  Eye,
  Inbox,
  Loader2,
  PauseCircle,
  PlayCircle,
  Receipt,
  RefreshCw,
  Search,
  Settings2,
  UserPlus,
  Wallet,
  X,
  XCircle,
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
  getPendingPayments,
  getTenantConfig,
  issueFeeNotice,
  listCitizens,
  logApiError,
  reviewPayment,
  runRecurringBilling,
  setNoticeActive,
  settlePayment,
} from '@/lib/api-client';
import type {
  AdminPaymentItem,
  CitizenListItem,
  CitizenProfile,
  CitizenProfilePayment,
  MunicipalitySettings,
  FeeNoticeSummary,
  FeeSummary,
  PendingPayment,
} from '@/lib/api-client';
import { clearSession, loadSession } from '@/lib/session';
import { formatLbp } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { useSectionNav } from '@/lib/use-section-nav';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import {
  WorkflowEmpty,
  WorkflowRail,
  WorkflowSection,
  type WorkflowStep,
} from '@/components/admin/workflow';
import { IssueFeeDialog, type IssueFeeValues } from '@/components/admin/issue-fee-dialog';
import {
  ChargeCitizenDialog,
  type ChargeValues,
} from '@/components/admin/charge-citizen-dialog';
import {
  SettlePaymentDialog,
  type SettleValues,
} from '@/components/admin/settle-payment-dialog';
import { PaymentReceipt } from '@/components/admin/payment-receipt';

/**
 * LBP has no minor unit in practice — whole pounds, grouped.
 *
 * Kept as a local alias rather than three call sites reaching for the shared
 * name: this screen prints exact figures throughout (it is the ledger), so it
 * deliberately does not use the compacting `Money` the citizens registry does.
 */
const lbp = formatLbp;

type StageId = 'issue' | 'ledger' | 'verify' | 'closing';

/**
 * إدارة الرسوم والمدفوعات.
 *
 * Three jobs on one screen because they are one job in practice: issue what
 * the municipality is owed, confirm what has arrived, and keep the transfer
 * details the citizen portal quotes correct.
 *
 * They are now laid out in the order money actually moves — إصدار، تحصيل،
 * تأكيد، وصل — with a sticky rail across the top. The previous layout led with
 * the review queue on the grounds that it is the only part where someone is
 * waiting; that reasoning was sound but the fix was in the wrong place. A queue
 * placed out of sequence teaches nobody the sequence, whereas a counted, raised
 * pill on the rail says "three people are waiting" from anywhere on the page —
 * which is what leading with it was trying to achieve.
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

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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
  const [busyPaymentId, setBusyPaymentId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Which citizen's itemised breakdown is open, if any. */
  const [expandedCitizen, setExpandedCitizen] = useState<string | null>(null);
  const [settling, setSettling] = useState<AdminPaymentItem | null>(null);
  const [recordingCash, setRecordingCash] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);
  /**
   * The receipt shown after money is taken.
   *
   * Holds the full citizen profile rather than the ledger row, because the
   * printed وصل carries the property, the units and the household size — none
   * of which the payment row knows about.
   */
  const [receipt, setReceipt] = useState<{
    citizen: CitizenProfile;
    payment: CitizenProfilePayment;
    received: number;
  } | null>(null);
  const [settings, setSettings] = useState<MunicipalitySettings | null>(null);
  const [municipalityName, setMunicipalityName] = useState('');

  const canManage = role === 'SUPER_ADMIN';

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

  /**
   * The four stages, declared once.
   *
   * Read by both the rail and the section headings, so a rail entry can never
   * point at an anchor that is not rendered. الوصولات is dropped entirely for a
   * clerk who cannot manage: the card behind it is a link to settings they
   * cannot open, and a rail step leading to a locked door is worse than a rail
   * with three steps.
   */
  const stages = useMemo<WorkflowStep<StageId>[]>(
    () => [
      {
        id: 'issue',
        step: '١',
        title: 'إصدار الرسوم',
        icon: Banknote,
        count: notices.length,
      },
      {
        id: 'ledger',
        step: '٢',
        title: 'تحصيل المطالبات',
        icon: Wallet,
        count: byCitizen.length,
      },
      {
        id: 'verify',
        step: '٣',
        title: 'تأكيد الدفعات',
        icon: Clock,
        count: pending.length,
        urgent: true,
      },
      ...(canManage
        ? [
            {
              id: 'closing' as const,
              step: '٤',
              title: 'الوصولات والإعدادات',
              icon: Settings2,
            },
          ]
        : []),
    ],
    [notices.length, byCitizen.length, pending.length, canManage],
  );

  const stageIds = useMemo(() => stages.map((stage) => stage.id), [stages]);

  // The lists' lengths change the page height enough to invalidate the
  // observer, so they are what the hook re-measures on.
  const { active, jumpTo } = useSectionNav(stageIds, [
    notices.length,
    byCitizen.length,
    pending.length,
    expandedCitizen,
  ]);

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
        configResult,
        registryResult,
        ledgerResult,
      ] = await Promise.all([
        getFeeSummary(tenant, token),
        getFeeNotices(tenant, token),
        getPendingPayments(tenant, token),
        // Read, not edited, here: the receipt prints the office numbers and the
        // municipality name. The form for them lives in إعدادات البلدية.
        getMunicipalitySettings(tenant, token),
        getTenantConfig(tenant),
        listCitizens(tenant, token, { limit: 200 }),
        getAllPayments(tenant, token, { search: ledgerSearch || undefined }),
      ]);

      setSummary(summaryResult);
      setNotices(noticesResult.items);
      setPending(pendingResult.items);
      setLedger(ledgerResult.items);
      setCitizens(registryResult.items);
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
      setError('تعذّر تحميل بيانات الرسوم.');
    } finally {
      setLoading(false);
    }
  }, [tenant, token, base, router, ledgerSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Manual reload — spins its own flag so the page does not blank out. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
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

  /**
   * Opens the وصل for one invoice.
   *
   * Fetches the citizen's profile on demand rather than holding every
   * profile in state: the receipt needs the property, the unit counts and the
   * household size, and loading all of that for a ledger of two hundred rows
   * to serve the one receipt a clerk actually prints would be absurd.
   *
   * The payment is then taken *from the profile* rather than from the ledger
   * row, so the printed figures are the committed ones and carry the fields
   * (`reviewNote`, `frequency`) the ledger row does not.
   */
  const openReceipt = useCallback(
    async (citizenId: string, paymentId: string, received: number) => {
      if (!token) return;
      try {
        const profile = await getCitizenProfile(tenant, token, citizenId);
        const payment = profile.payments.find((row) => row.id === paymentId);
        if (!payment) return;
        setReceipt({ citizen: profile, payment, received });
      } catch (caught) {
        logApiError(caught);
        setError('تعذّر فتح الوصل — يمكن إصداره من ملف المواطن.');
      }
    },
    [tenant, token],
  );

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
    async ({ method, amount, whishTransactionRef, note }: SettleValues) => {
      const target = settling;
      if (!token || !target || recordingCash) return;

      setRecordingCash(true);
      setSettleError(null);
      try {
        await settlePayment(tenant, token, target.id, {
          method,
          amount,
          whishTransactionRef,
          note,
        });
        setSettling(null);
        const how =
          method === 'WHISH_MONEY'
            ? 'تحويلاً'
            : method === 'COLLECTOR'
              ? 'عبر المحصّل'
              : 'نقداً';
        setNotice(
          amount < target.remaining
            ? `تم تسجيل دفعة جزئية ${how} بقيمة ${lbp(amount)} — متبقٍ ${lbp(target.remaining - amount)}.`
            : `تم تسجيل الدفعة بالكامل ${how}.`,
        );
        await load();
        // Straight into the receipt, so the citizen leaves the counter with
        // one. It is opened after `load()` so the figures on it are the
        // committed ones rather than an optimistic guess.
        await openReceipt(target.citizenId, target.id, amount);
      } catch (caught) {
        logApiError(caught);
        setSettleError(
          caught instanceof ApiRequestError ? caught.message : 'تعذّر تسجيل الدفعة.',
        );
      } finally {
        setRecordingCash(false);
      }
    },
    // `openReceipt` belongs here even though its own deps are a subset of
    // these: leaving it out is the kind of omission that stays harmless until
    // someone widens its dependencies and the receipt starts opening against
    // a stale token.
    [tenant, token, load, settling, recordingCash, openReceipt],
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

  const collected = summary?.paidTotal ?? 0;
  const outstanding = summary?.unpaidTotal ?? 0;
  const billedTotal = collected + outstanding;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        icon={Receipt}
        title="إدارة الرسوم والمدفوعات"
        subtitle="من إصدار الرسم إلى الوصل — أربع مراحل على صفحة واحدة"
        actions={
          <>
            <Button variant="ghost" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw
                className={cn('size-4', refreshing && 'animate-spin')}
                aria-hidden
              />
              تحديث
            </Button>
            {canManage ? (
              <>
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
              </>
            ) : null}
          </>
        }
      />

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive"
        >
          <XCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span className="flex-1">{error}</span>
        </p>
      ) : null}
      {notice ? (
        <div className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/5 p-4 text-sm">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <p className="flex-1">{notice}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
            <span className="sr-only">إخفاء الإشعار</span>
          </button>
        </div>
      ) : null}

      {/* The four figures, each a jump into the stage that would change it —
          «قيد المراجعة» is not a statistic, it is a queue with a door. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="إجمالي المستحقات"
          value={summary ? lbp(summary.unpaidTotal) : '—'}
          hint={summary ? `${summary.unpaidCount} مطالبة` : ''}
          icon={<Wallet className="size-6 text-destructive" aria-hidden />}
          accent="bg-destructive/10"
          loading={loading}
          onClick={() => jumpTo('ledger')}
        />
        <MetricCard
          label="قيد المراجعة"
          value={summary ? String(summary.pendingReviewCount) : '—'}
          hint="دفعات بانتظار التأكيد"
          icon={<Clock className="size-6 text-warning" aria-hidden />}
          accent="bg-warning/10"
          loading={loading}
          attention={pending.length > 0}
          onClick={() => jumpTo('verify')}
        />
        <MetricCard
          label="إجمالي المحصّل"
          value={summary ? lbp(summary.paidTotal) : '—'}
          hint={summary ? `${summary.paidCount} دفعة` : ''}
          icon={<BadgeCheck className="size-6 text-success" aria-hidden />}
          accent="bg-success/10"
          loading={loading}
          onClick={() => jumpTo('ledger')}
        />
        <MetricCard
          label="الرسوم المُصدرة"
          value={String(notices.length)}
          hint="إشعارات فعّالة"
          icon={<Banknote className="size-6 text-primary" aria-hidden />}
          loading={loading}
          onClick={() => jumpTo('issue')}
        />
      </div>

      {/* Collected against billed. Two totals sitting in separate tiles are
          two numbers; one bar is a ratio, which is the thing anyone actually
          wants to know from a fees screen. */}
      {billedTotal > 0 ? (
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium">نسبة التحصيل</p>
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground tabular-nums">
                  {Math.round((collected / billedTotal) * 100)}%
                </span>{' '}
                — {lbp(collected)} من {lbp(billedTotal)}
              </p>
            </div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={`محصّل ${lbp(collected)} من أصل ${lbp(billedTotal)}`}
            >
              <div
                className="h-full rounded-full bg-success transition-[width] duration-500"
                style={{ width: `${(collected / billedTotal) * 100}%` }}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <WorkflowRail steps={stages} active={active} onJump={jumpTo} label="مراحل الرسوم" />

      {/* ─── ١ ─── The rules. One notice here can be a thousand invoices below. */}
      <WorkflowSection
        id="issue"
        step="١"
        icon={Banknote}
        title="إصدار الرسوم"
        description="الإشعارات التي تولّد المطالبات. المتكرّرة منها تُصدر دورتها تلقائياً كل ليلة."
        contentClassName="p-0"
        actions={
          canManage ? (
            <Button
              variant="outline"
              onClick={() => void runBillingNow()}
              disabled={runningBilling}
            >
              {runningBilling ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-4" aria-hidden />
              )}
              إصدار الدورة الحالية
            </Button>
          ) : null
        }
      >
        {notices.length === 0 ? (
          <WorkflowEmpty
            icon={Banknote}
            title="لم يتم إصدار أي رسم بعد"
            hint={
              canManage
                ? 'ابدأ من «إصدار رسم جديد» في أعلى الصفحة — ثلاث خطوات ومراجعة قبل الاعتماد.'
                : undefined
            }
          />
        ) : (
          <ul className="divide-y">
            {notices.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
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
                    <span>استحقاق {new Date(item.dueDate).toLocaleDateString('ar-LB')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-end">
                    <p className="font-semibold tabular-nums">{lbp(item.amount)}</p>
                    <p className="text-xs text-muted-foreground">{item.issuedCount} مطالبة</p>
                  </div>
                  {/* Only recurring notices have anything to stop — a one-off
                      fee has already done all it will ever do. */}
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
      </WorkflowSection>

      {/* ─── ٢ ─── The ledger, and where cash over the counter is recorded. */}
      <WorkflowSection
        id="ledger"
        step="٢"
        icon={Wallet}
        title="تحصيل المطالبات"
        description="كل المطالبات الصادرة، مجمّعة بالمواطن ومرتّبة بالأكثر استحقاقاً. سجّل الدفعات النقدية من هنا."
        contentClassName="p-0"
        actions={
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
        }
      >
        {byCitizen.length === 0 ? (
          <WorkflowEmpty
            icon={ledgerSearch ? Search : Inbox}
            title={ledgerSearch ? 'لا توجد مطالبات مطابقة' : 'لا توجد مطالبات بعد'}
            hint={
              ledgerSearch
                ? 'جرّب الاسم كاملاً أو الرقم المرجعي.'
                : 'تظهر هنا فور إصدار أول رسم في المرحلة السابقة.'
            }
          />
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
              const settled = group.billed - group.outstanding;
              const share = group.billed > 0 ? settled / group.billed : 1;

              return (
                <li key={group.citizenId}>
                  <div
                    className={cn(
                      'flex flex-wrap items-center justify-between gap-4 p-4 transition-colors',
                      expanded && 'bg-accent/40',
                    )}
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
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
                      {/* How far down the balance has been paid, without
                          opening the breakdown to find out. */}
                      <div
                        className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted"
                        role="img"
                        aria-label={`سُدّد ${lbp(settled)} من أصل ${lbp(group.billed)}`}
                      >
                        <div
                          className={cn(
                            'h-full rounded-full',
                            group.overdueCount > 0 ? 'bg-destructive' : 'bg-success',
                          )}
                          style={{ width: `${share * 100}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <div className="text-end">
                        <p className="font-semibold tabular-nums">{lbp(group.outstanding)}</p>
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
                        onClick={() => setExpandedCitizen(expanded ? null : group.citizenId)}
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
                        const paid = payment.paymentStatus === 'PAID';
                        const partly = !paid && payment.paidAmount > 0;
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
                                {lbp(paid ? payment.amount : payment.remaining)}
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
                              {canManage && !paid ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  // `recordingCash`, not `busyPaymentId`: that
                                  // one belongs to the review queue below, and
                                  // sharing it made confirming a transfer grey
                                  // out an unrelated invoice's «تسجيل دفعة».
                                  disabled={recordingCash && settling?.id === payment.id}
                                  onClick={() => {
                                    setSettleError(null);
                                    setSettling(payment);
                                  }}
                                >
                                  {recordingCash && settling?.id === payment.id ? (
                                    <Loader2 className="size-4 animate-spin" aria-hidden />
                                  ) : (
                                    <Banknote className="size-4" aria-hidden />
                                  )}
                                  تسجيل دفعة
                                </Button>
                              ) : null}

                              {/* Any invoice that has received money can be
                                  receipted again — a citizen who lost the
                                  first copy should not need a second payment
                                  to get one. */}
                              {canManage && payment.paidAmount > 0 ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    void openReceipt(
                                      payment.citizenId,
                                      payment.id,
                                      payment.paidAmount,
                                    )
                                  }
                                >
                                  <Receipt className="size-4" aria-hidden />
                                  الوصل
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
      </WorkflowSection>

      {/* ─── ٣ ─── The only stage where someone outside the building is
          waiting on the municipality. */}
      <WorkflowSection
        id="verify"
        step="٣"
        icon={Clock}
        title="تأكيد الدفعات الواردة"
        description="دفعات أعلن المواطنون تحويلها. أكّد وصول المبلغ إلى حساب البلدية قبل اعتمادها."
        contentClassName="p-0"
        attention={pending.length > 0}
      >
        {pending.length === 0 ? (
          <WorkflowEmpty
            icon={CheckCircle2}
            title="لا توجد دفعات بانتظار المراجعة"
            hint="كل ما أعلنه المواطنون تمّت معالجته."
          />
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
                    {payment.title} · <span className="tabular-nums">{lbp(payment.amount)}</span>{' '}
                    · {ar.paymentMethod[payment.paymentMethod as never] ?? '—'}
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
      </WorkflowSection>

      {/*
        ─── ٤ ───
        The settings themselves moved to إعدادات البلدية.
        They were edited here but read everywhere — the office WhatsApp number
        is printed on every receipt, the opening hours appear on the citizen's
        pay dialog — so they belong to the municipality rather than to this
        ledger. What stays is a pointer, so nobody hunts for a form that has
        moved; it sits at the end because that is where the money's journey
        ends, on a printed وصل carrying those numbers.
      */}
      {canManage ? (
        <WorkflowSection
          id="closing"
          step="٤"
          icon={Settings2}
          title="الوصولات وإعدادات الدفع"
          description="ما يُطبع على الوصل، وما يراه المواطن حين يختار طريقة الدفع."
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <ul className="min-w-0 space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <Receipt className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>
                  الوصل يُطبع من زر «الوصل» بجانب أي مطالبة استُلم عليها مبلغ، في المرحلة
                  الثانية.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Wallet className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>
                  رقم Whish، أوقات الدوام، وأرقام هاتف وواتساب البلدية المطبوعة على
                  الوصولات.
                </span>
              </li>
            </ul>
            <Link
              href={`${base}/settings`}
              className={buttonVariants({ variant: 'outline' })}
            >
              <Settings2 className="size-4" aria-hidden />
              فتح الإعدادات
            </Link>
          </div>
        </WorkflowSection>
      ) : null}

      <IssueFeeDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        citizens={citizens}
        submitting={issuing}
        error={issueError}
        onSubmit={(values) => void submitFee(values)}
      />

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

      <SettlePaymentDialog
        open={settling !== null}
        onOpenChange={(next) => {
          if (!next) setSettling(null);
        }}
        payment={settling}
        submitting={recordingCash}
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

/**
 * A headline figure with an accent icon chip.
 *
 * Clickable, because every one of these four numbers is answered by exactly one
 * stage further down the page — a total with no way to reach what it counts is
 * a dead end, and «قيد المراجعة» in particular is a queue rather than a fact.
 */
function MetricCard({
  label,
  value,
  hint,
  icon,
  accent = 'bg-accent',
  loading,
  attention,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  accent?: string;
  loading: boolean;
  attention?: boolean;
  onClick?: () => void;
}) {
  return (
    <Card
      className={cn(
        'transition-shadow hover:shadow-md',
        attention && 'border-warning/50 ring-1 ring-warning/20',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between gap-3 rounded-lg p-5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="truncate text-2xl font-bold tabular-nums">{loading ? '—' : value}</p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <div className={`rounded-lg p-3 ${accent}`}>{icon}</div>
      </button>
    </Card>
  );
}
