'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  CloudOff,
  DoorClosed,
  Loader2,
  RefreshCw,
  Search,
  WifiOff,
} from 'lucide-react';
import { ar, draftGaps, parcelCaseState } from '@mechanization/shared-schemas';
import { loadSession } from '@/lib/session';
import { logApiError } from '@/lib/api-client';
import {
  applyVisitLocally,
  dropQueued,
  enqueue,
  isFieldStorageAvailable,
  loadWorklist,
  readMeta,
  readOutbox,
  type CachedParcel,
} from '@/lib/field-db';
import { stuckRecords, type StuckRecord } from '@/lib/field-stuck';
import { syncNow, type SyncReport } from '@/lib/field-sync';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/states';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { RecordVisitSheet, type VisitDraftResult } from '@/components/field/record-visit-sheet';
import { cn } from '@/lib/utils';

/**
 * ────────────────────────────  The field screen  ─────────────────────────────
 *
 * The one screen in this system designed to be used standing up, outdoors, on a
 * phone, with no signal. `FIELD_INSPECTOR` only — it is "the doors assigned to
 * you", which is not a thing the supervising roles have.
 *
 * Everything it shows comes from IndexedDB, never from a fetch. That inversion
 * is the whole design: a page that reads from the network and falls back to a
 * cache behaves differently depending on the connection, and "behaves
 * differently" is the last thing you want from the tool someone is holding at a
 * stranger's door. The network only ever moves data in and out of the local
 * store, in one visible operation the worker triggers and can watch.
 *
 * React Query still earns its place with no server on the read path: the local
 * store is an async source with three writers — two sheets and the sync — and
 * one invalidated key refreshing every reader is what keeps the list, the
 * filter counts and the pending badge from disagreeing after a save.
 */

/**
 * Four states plus two lenses.
 *
 * `todo` / `due` / `waiting` / `done` come from `parcelCaseState` and partition
 * the list exactly — their counts sum to it. `drafts` and `all` cut across
 * them and are shown after a separator so the difference is visible rather
 * than merely documented.
 */
type Filter = 'todo' | 'due' | 'waiting' | 'done' | 'drafts' | 'all';

const FILTERS: Array<{ value: Filter; label: string; lens?: true }> = [
  { value: 'todo', label: 'لم تُزَر' },
  { value: 'due', label: 'مستحقة' },
  { value: 'waiting', label: 'بانتظار' },
  { value: 'done', label: 'منجزة' },
  { value: 'drafts', label: 'قيد الاستمارة', lens: true },
  { value: 'all', label: 'الكل', lens: true },
];

/**
 * Two orders, because the two ways this screen is used want opposite ones.
 *
 * `route` is parcel number, which broadly follows the street: the sequence
 * someone covering a sector on foot moves in, and the original — and still
 * correct — default. `recent` puts whatever was last touched at the top, which
 * is what you want while working several apartments in one building.
 *
 * The list used to be `route` and was changed to `recent`. Neither is wrong;
 * having only one of them is.
 */
type SortOrder = 'route' | 'recent';

/**
 * Who asked for this sync.
 *
 * The distinction decides whether a failure is worth saying out loud. A person
 * who pressed the button is waiting for an answer and gets one either way; the
 * app deciding to try in the background gets to fail silently, because the
 * offline banner is already saying the same thing, permanently, without needing
 * to interrupt anyone.
 */
type SyncTrigger = 'manual' | 'auto';

const SORTS: Array<{ value: SortOrder; label: string; hint: string }> = [
  { value: 'route', label: 'ترتيب المسار', hint: 'حسب رقم العقار — يتبع الشارع' },
  { value: 'recent', label: 'الأحدث', hint: 'آخر ما عملت عليه في الأعلى' },
];

/** Everything the local store answers, under one key so one write refreshes all. */
const LOCAL_KEY = 'field-local';

export default function FieldPage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string }>;
}) {
  const { tenant, locale, adminPath } = use(params);
  const base = `/${tenant}/${locale}/${adminPath}`;
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  const session = useMemo(() => loadSession(tenant), [tenant]);
  const [online, setOnline] = useState(true);
  /**
   * Whether the server has actually answered, as opposed to whether the phone
   * thinks it has a network.
   *
   * `navigator.onLine` is true for a device attached to a village wifi with
   * nothing behind it — the exact case this whole feature exists for — so it
   * cannot be the thing that decides whether to keep trying. A failed attempt
   * sets this false and the device stops, silently, until the browser's own
   * `online` event fires or the worker presses «مزامنة».
   */
  const [reachable, setReachable] = useState(true);
  const [storageBroken, setStorageBroken] = useState(false);
  const [filter, setFilter] = useState<Filter>('todo');
  const [sort, setSort] = useState<SortOrder>('route');
  const [query, setQuery] = useState('');
  const [visitTarget, setVisitTarget] = useState<CachedParcel | null>(null);

  /** The doorstep form is a page of its own — see `field/[parcelNumber]`. */
  const openDraft = (parcel: CachedParcel, draftId?: string) =>
    router.push(
      `${base}/field/${encodeURIComponent(parcel.parcelNumber)}${draftId ? `?draftId=${draftId}` : ''}`,
    );

  const storageUsable = !storageBroken;

  /*
    One query over the device's own store. `staleTime: Infinity` and no
    refetch-on-focus, because nothing changes it but the mutations below —
    there is no remote writer to poll for, and re-reading IndexedDB every time
    the tab regains focus would be work for nothing.
  */
  const local = useQuery({
    queryKey: [LOCAL_KEY, tenant],
    queryFn: async () => {
      // The outbox itself, not just its size: a stuck record has to be named,
      // explained and acted on, and none of that is possible from a count.
      const [parcels, outbox, meta] = await Promise.all([loadWorklist(), readOutbox(), readMeta()]);
      return {
        parcels,
        outbox,
        // What is waiting to go, excluding what is stuck — see `stuck` below.
        pending: outbox.filter((entry) => !entry.lastError).length,
        lastPulledAt: meta.lastPulledAt,
      };
    },
    enabled: storageUsable,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const refreshLocal = () => queryClient.invalidateQueries({ queryKey: [LOCAL_KEY, tenant] });

  useEffect(() => {
    setOnline(navigator.onLine);
    if (!isFieldStorageAvailable()) setStorageBroken(true);
  }, []);

  useEffect(() => {
    if (!local.error) return;
    logApiError(local.error);
    setStorageBroken(true);
  }, [local.error]);

  /*
    ─────────────────────────  Two ways to ask for a sync  ─────────────────────

    `manual` is a person pressing the button; it always reports what happened,
    success or failure, because they asked and are waiting for an answer.

    `auto` is the app deciding; it reports only what the worker must act on, and
    it says **nothing at all** when it fails. A failed automatic sync is not
    news — the connection being down is already on the screen, permanently, in
    the offline banner. Toasting it once per attempt is how a worker learns to
    dismiss the toast that eventually matters.
  */
  const syncMutation = useMutation({
    mutationFn: async (trigger: SyncTrigger) => {
      if (!session) throw new Error('الجلسة منتهية');
      const report = await syncNow(tenant, session.accessToken, session.user.id);
      return { report, trigger };
    },
    onSuccess: async ({ report, trigger }) => {
      await refreshLocal();

      /*
        `syncNow` reports a failed cycle in the report rather than by throwing,
        so this is the branch a dead connection actually lands in.

        Whether the network is reachable is not something `navigator.onLine`
        can answer — it says "true" for a phone attached to a village wifi with
        nothing behind it, which is the exact situation this feature exists
        for. An attempt that failed is the only reliable evidence, so it is
        what stops the next one.
      */
      if (report.error) {
        setReachable(false);
        if (trigger === 'manual') {
          toast.error('تعذّرت المزامنة', { description: report.error });
        }
        return;
      }

      setReachable(true);
      if (trigger === 'manual') {
        announce(report, toast);
        return;
      }
      // Automatic: only things that need a decision.
      if (
        report.conflicted.length > 0 ||
        report.rejected > 0 ||
        report.promotionFailures.length > 0
      ) {
        announce(report, toast);
      }
    },
    onError: (error: unknown, trigger) => {
      logApiError(error);
      setReachable(false);
      if (trigger === 'manual') toast.error('تعذّرت المزامنة');
    },
  });

  /*
    Sync on mount, and when the connection comes back. Never otherwise.

    `online` alone was not enough of a gate. `navigator.onLine` reports true on
    any attached network, so a worker in a village with wifi and no upstream was
    "online" — every save fired a sync, every sync failed, and every failure
    toasted. `reachable` is the second half: set false by a failed attempt, and
    cleared only by the browser's own `online` event or by the worker pressing
    the button. Between those two, the device stops trying and says nothing.

    Not on a timer either. A background poll on a metered village connection is
    not a favour, and the button is always there.
  */
  useEffect(() => {
    if (!storageUsable || !session) return;

    const goOnline = () => {
      setOnline(true);
      // The one signal that genuinely means "something changed out there".
      setReachable(true);
      syncMutation.mutate('auto');
    };
    const goOffline = () => {
      setOnline(false);
      setReachable(false);
    };

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    if (navigator.onLine) syncMutation.mutate('auto');

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
    // Once per mount: re-subscribing whenever the mutation object changes
    // identity would fire a sync on every render pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageUsable, Boolean(session)]);

  const saveVisit = useMutation({
    mutationFn: async ({ parcel, result }: { parcel: CachedParcel; result: VisitDraftResult }) => {
      const now = new Date().toISOString();
      /*
       * The same `draftClientId` goes to the server and to the device — no
       * fallback, on either side.
       *
       * It used to be `result.draftClientId ?? parcel.draft?.clientId` here and
       * the bare `result.draftClientId` two lines down, so a whole-building
       * outcome was filed against the first household on the server and against
       * nobody locally: one visit, two meanings, and no error anywhere.
       */
      const draftClientId = result.draftClientId;

      await enqueue({
        kind: 'visit',
        clientId: crypto.randomUUID(),
        parcelNumber: parcel.parcelNumber,
        outcome: result.outcome,
        visitedAt: now,
        ...(result.note ? { note: result.note } : {}),
        ...(result.nextVisitAt ? { nextVisitAt: result.nextVisitAt } : {}),
        ...(result.proxyName ? { proxyName: result.proxyName } : {}),
        ...(result.proxyPhone ? { proxyPhone: result.proxyPhone } : {}),
        ...(result.latitude !== undefined ? { latitude: result.latitude } : {}),
        ...(result.longitude !== undefined ? { longitude: result.longitude } : {}),
        ...(draftClientId ? { draftClientId } : {}),
      });

      // Reflected in the list at once. Waiting for a sync that may be hours away
      // would leave the worker unable to tell which doors they had already done.
      await applyVisitLocally(parcel.parcelNumber, {
        draftClientId,
        lastOutcome: result.outcome,
        lastVisitedAt: now,
        nextVisitAt: result.nextVisitAt,
        note: result.note,
        proxyName: result.proxyName,
        proxyPhone: result.proxyPhone,
      });
    },
    onSuccess: async () => {
      setVisitTarget(null);
      await refreshLocal();
      toast.success('حُفظت الزيارة على الجهاز');
      /*
        Gated on `reachable`, not just on `navigator.onLine`.

        This was the loudest of the offline problems: every save fired a sync,
        and because the mutation's own `onSuccess` announced unconditionally,
        every one of those failures produced a «تعذّرت المزامنة» toast. Forty
        doors in a village with no signal was forty error toasts about a
        connection the worker already knew was down — on top of the forty
        success toasts they did want.

        Now a failed attempt stops the next one, and an automatic attempt never
        reports failure at all.
      */
      if (online && reachable) syncMutation.mutate('auto');
    },
    onError: () => toast.error('تعذّر الحفظ على الجهاز'),
  });

  const parcels = useMemo(() => local.data?.parcels ?? [], [local.data]);
  const pending = local.data?.pending ?? 0;

  /**
   * The queued records the server has refused.
   *
   * Kept out of `pending` on purpose: the badge counts work waiting to go, and
   * these are not waiting — they are stuck, and no amount of pressing «مزامنة»
   * will move them until something changes. Conflating the two is what let a
   * permanently rejected record hide inside a growing number for weeks.
   */
  const stuck = useMemo(
    () => stuckRecords(local.data?.outbox ?? [], parcels),
    [local.data?.outbox, parcels],
  );

  const dropStuck = useMutation({
    mutationFn: (clientId: string) => dropQueued(clientId),
    onSuccess: async () => {
      await refreshLocal();
      toast.success('أُزيل السجل من قائمة الإرسال');
    },
    onError: () => toast.error('تعذّرت الإزالة'),
  });

  /*
   * Every count comes from the same `parcelCaseState`, so `todo + due +
   * waiting + done` is exactly the number of doors on the list.
   *
   * It stopped adding up the moment a parcel could hold several households:
   * "done" was asked of the parcel while "waiting" was asked of its drafts, so
   * a building whose apartments were all finished landed in neither, and a tab
   * strip whose numbers do not sum to the list is a tab strip nobody trusts.
   *
   * `drafts` is deliberately *not* part of that sum. It is a lens — "where is
   * there half-finished paperwork" — that cuts across all four states, and it
   * is labelled as one.
   */
  const counts = useMemo(() => {
    const now = new Date();
    const tally = { todo: 0, due: 0, waiting: 0, done: 0, drafts: 0 };
    for (const parcel of parcels) {
      const state = parcelCaseState(parcel, now);
      tally[state === 'closed' ? 'done' : state] += 1;
      if (parcel.drafts.length > 0) tally.drafts += 1;
    }
    return tally;
  }, [parcels]);

  const visible = useMemo(
    () => filterParcels(parcels, filter, query, sort),
    [parcels, filter, query, sort],
  );

  if (storageBroken) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 lg:px-8">
        {/*
          Said up front rather than discovered after forty visits. A browser with
          site data blocked cannot hold a worklist, and pretending otherwise
          would lose a day of someone's work.
        */}
        <EmptyState
          icon={CloudOff}
          title="لا يمكن استخدام العمل الميداني على هذا الجهاز"
          description="المتصفح يمنع التخزين المحلي، ولا يمكن حفظ الزيارات دون اتصال. جرّب متصفحاً آخر أو أوقف وضع التصفح الخاص."
        />
      </div>
    );
  }

  return (
    /*
      The same frame as «المواطنون», «الرسوم» and «سجل العمليات»:
      `mx-auto max-w-* px-4 py-8 sm:px-6 lg:px-8`.

      `AdminShell` renders `<main>` with no padding of its own, deliberately —
      the map and the zones screen fill it edge to edge — so a page that does
      not set its own inset sits flat against the sidebar, which is what this
      one did. `max-w-5xl` rather than the register's `max-w-7xl`: this is one
      column of short rows, and at 1280px a parcel number and its badge end up
      at opposite ends of the screen with nothing between them.
    */
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        icon={ClipboardList}
        title="العمل الميداني"
        subtitle={
          local.data?.lastPulledAt
            ? `آخر مزامنة: ${new Date(local.data.lastPulledAt).toLocaleString('ar-LB')}`
            : 'لم تتم المزامنة بعد'
        }
        actions={
          <Button
            /*
              Always enabled while a session exists, even when the device
              believes it is offline.

              `navigator.onLine` is a guess, and disabling the only manual
              escape hatch on the strength of a guess is how a worker with a
              full queue and a working connection ends up unable to send
              anything. Pressing it is also the deliberate way to clear
              `reachable` and let automatic syncs resume.
            */
            onClick={() => syncMutation.mutate('manual')}
            disabled={syncMutation.isPending}
          >
            {syncMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-4" aria-hidden />
            )}
            مزامنة
            {pending > 0 && (
              <Badge variant="secondary" className="ms-1 tabular-nums">
                {pending}
              </Badge>
            )}
          </Button>
        }
      />

      {/*
        Connection state is shown, never acted on silently. A worker who can see
        they are offline understands why the list is not changing; one who
        cannot assumes the app is broken.

        This banner is also *why* the automatic syncs are allowed to fail
        without a word: the same fact is already on the screen, permanently, at
        no cost to anyone's attention. A toast per attempt says nothing this
        does not, forty times a morning.

        The same shape the register and the ledger raise their notices in —
        `rounded-xl border` over a wash of the semantic token, not a `Card`
        with its shadow switched off. `--warning` rather than a raw amber,
        because that token is contrast-measured against both grounds and a
        literal `amber-500` is not.
      */}
      {(!online || !reachable) && (
        <p
          role="status"
          className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm leading-relaxed text-warning"
        >
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {online
              ? // The nastier of the two, and the one that used to toast on
                // every save: a network the phone is attached to but cannot
                // reach the municipality through.
                'تعذّر الوصول إلى الخادم رغم وجود شبكة.'
              : 'لا يوجد اتصال.'}{' '}
            كل ما تسجّله محفوظ على الجهاز
            {pending > 0 && ` (${pending} بانتظار الإرسال)`} — لن تتكرر المحاولة تلقائياً حتى تعود
            الشبكة، ويمكنك المحاولة الآن بزر «مزامنة».
          </span>
        </p>
      )}

      {stuck.length > 0 && <StuckPanel records={stuck} base={base} onDrop={dropStuck.mutate} />}

      {/*
        One card holding the filters, the search and the list — the structure
        «سجل العمليات» and «سجل الرسوم» already use. Loose rows floating on the
        page background is what made this screen read as a different product.
      */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              <ClipboardList className="size-5 text-primary" aria-hidden />
              قائمة العمل
            </CardTitle>

            {/*
              The ledger's segmented control, not pills: a track of `--muted`
              with the active tab lifted onto `--card`. Five Arabic labels do
              not fit one phone row, so the track wraps rather than scrolling
              sideways — a horizontally-scrolled filter bar hides the filters
              nobody thinks to swipe for.

              `min-h-10` where the ledger runs `py-1`, and only below `sm`.
              This is the one screen used standing up outdoors with a thumb,
              and a 24px tab is not a target that survives that.
            */}
            <div className="flex flex-wrap items-center gap-1 rounded-xl bg-muted p-1">
              {FILTERS.map((option) => {
                const count = option.value === 'all' ? parcels.length : counts[option.value];
                return (
                  <span key={option.value} className="contents">
                    {/*
                      A hairline before the lenses. The four before it partition
                      the list and their counts sum to it; the two after cut
                      across all four. Same row, because they are all "narrow
                      the list", but not the same kind of thing.
                    */}
                    {option.lens && option.value === 'drafts' && (
                      <span
                        aria-hidden
                        className="mx-1 hidden h-5 w-px self-center bg-border sm:block"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setFilter(option.value)}
                      aria-pressed={filter === option.value}
                      className={cn(
                        'inline-flex min-h-10 items-center rounded-lg px-3 text-xs font-semibold transition-all sm:min-h-0 sm:py-1.5',
                        filter === option.value
                          ? 'bg-card text-foreground shadow-xs'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {option.label}
                      {count > 0 && <span className="ms-1.5 tabular-nums opacity-70">{count}</span>}
                    </button>
                  </span>
                );
              })}
            </div>

            {/*
              Route order or newest-first. Small, because it is a preference
              rather than a filter — but present, because the two ways this
              screen is used want opposite answers and one of them was silently
              taken away.
            */}
            <div
              className="flex items-center gap-1 self-start text-xs"
              role="group"
              aria-label="ترتيب القائمة"
            >
              <span className="text-muted-foreground">الترتيب:</span>
              {SORTS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  title={option.hint}
                  onClick={() => setSort(option.value)}
                  aria-pressed={sort === option.value}
                  className={cn(
                    'rounded-lg px-2 py-1 font-semibold transition-colors',
                    sort === option.value
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>

        {/*
          `p-0`, so the rows below can run the full width of the card and take
          their own padding — a hover that stops short of the card edge reads
          as a misaligned row rather than as a target.
        */}
        <CardContent className="p-0">
          <div className="border-b p-4 sm:px-6">
            <div className="relative">
              <Search
                className="pointer-events-none absolute inset-inline-start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ابحث برقم العقار"
                inputMode="numeric"
                className="ps-9"
              />
            </div>
          </div>

          {local.isPending ? (
            /* Rows, not a spinner: the list is about to occupy this space, and
               a placeholder shaped like it is what keeps the card from jumping
               when it arrives. */
            <ul className="divide-y divide-border">
              {[0, 1, 2, 3].map((row) => (
                <li key={row} className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
                  <div className="min-w-0 space-y-2">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-3 w-36" />
                  </div>
                  <Skeleton className="h-6 w-16 rounded-full" />
                </li>
              ))}
            </ul>
          ) : visible.length === 0 ? (
            <EmptyState
              compact
              icon={parcels.length === 0 ? DoorClosed : Search}
              title={parcels.length === 0 ? 'لا يوجد قطاع مكلَّف لك بعد' : 'لا نتائج ضمن هذا التصنيف'}
              description={
                parcels.length === 0
                  ? 'راجع البلدية لتُسنَد إليك حصّة من قطاع، ثم اضغط «مزامنة».'
                  : undefined
              }
              action={
                parcels.length === 0 ? (
                  <Button variant="outline" onClick={() => syncMutation.mutate('manual')}>
                    <RefreshCw className="size-4" aria-hidden />
                    مزامنة
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((parcel) => (
                <li key={parcel.parcelNumber}>
                  <button
                    type="button"
                    onClick={() => setVisitTarget(parcel)}
                    className="flex min-h-16 w-full items-center justify-between gap-3 px-4 py-3.5 text-start transition-colors hover:bg-muted/50 active:bg-muted sm:px-6"
                  >
                    <div className="min-w-0">
                      <p className="text-base font-semibold tabular-nums">{parcel.parcelNumber}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        القطاع {parcel.zoneCode}
                        {parcel.lastOutcome && ` — ${ar.visitOutcome[parcel.lastOutcome]}`}
                        {parcel.visitCount > 1 && ` (${parcel.visitCount} زيارات)`}
                      </p>
                    </div>
                    <StatusBadge parcel={parcel} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <RecordVisitSheet
        parcel={visitTarget}
        open={Boolean(visitTarget)}
        // Off until the municipality decides. See the note in the sheet: a
        // default-on location stamp is staff surveillance nobody agreed to.
        captureLocation={false}
        onClose={() => setVisitTarget(null)}
        onSubmit={(result) => {
          if (visitTarget) saveVisit.mutate({ parcel: visitTarget, result });
        }}
        onOpenDraft={(parcel, draftId) => {
          setVisitTarget(null);
          openDraft(parcel, draftId);
        }}
      />
    </div>
  );
}

/**
 * What this door is showing, in one badge.
 *
 * Registered households and open ones are both facts about the same building
 * and the badge says both: a block with five names on the register and one
 * apartment still being chased is neither «مسجّل» nor «ناقص», it is both, and
 * showing only the first is what sends a worker past a door they still owe.
 */
/**
 * ─────────────────────  The records that will not go through  ────────────────
 *
 * A rejected record is never dropped from the outbox — throwing away a worker's
 * morning because the server disliked it would be worse than a queue that will
 * not drain. But until this panel existed, "never dropped" was the whole of the
 * design: the reason was written onto the row and rendered nowhere, so what a
 * worker actually saw was a badge counting up and a sync reporting «رُفض ٣»
 * every time, with no way to learn which three, why, or what to do.
 *
 * Three things per row, because those are the three a person needs before they
 * can act: **what** it is (a household and a door, by name and number, never a
 * uuid), **why** it was refused (the server's own sentence), and **how** it gets
 * fixed — including, crucially, whether they can fix it at all or whether this
 * one belongs to a supervisor.
 *
 * Above the list rather than behind a tab. This is the only thing on the screen
 * that is silently not working, and a worker who cannot see it assumes the sync
 * is fine.
 */
function StuckPanel({
  records,
  base,
  onDrop,
}: {
  records: readonly StuckRecord[];
  base: string;
  onDrop: (clientId: string) => void;
}) {
  const [confirming, setConfirming] = useState<StuckRecord | null>(null);

  return (
    <>
      <Card className="border-destructive/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-destructive" aria-hidden />
            {records.length === 1 ? 'سجل لم يُرسل' : `${records.length} سجلات لم تُرسل`}
          </CardTitle>
          <p className="text-xs leading-relaxed text-muted-foreground">
            محفوظة على جهازك ولن تُفقد. رفضها الخادم للأسباب أدناه — وستُرسل تلقائياً بمجرد معالجة
            السبب.
          </p>
        </CardHeader>

        <CardContent className="space-y-3 pt-0">
          {records.map((record) => (
            <div
              key={record.clientId}
              className="rounded-xl border border-destructive/20 bg-destructive/5 p-3.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  {/* What. A door and a person, never an id. */}
                  <p className="text-sm font-semibold text-foreground">
                    {record.what} — العقار {record.parcelNumber}
                    {record.citizenName ? ` · ${record.citizenName}` : ''}
                  </p>
                  {/* Why, in the server's own words. */}
                  <p className="mt-1 text-xs font-medium text-destructive">
                    {record.guidance.title}
                  </p>
                  {record.serverMessage && record.serverMessage !== record.guidance.title && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {record.serverMessage}
                    </p>
                  )}
                </div>
                <Badge
                  variant={record.guidance.actor === 'worker' ? 'soft-warning' : 'soft-info'}
                  className="shrink-0 text-[11px]"
                >
                  {/*
                    The distinction that decides whether anything happens. Told
                    to "fix" something only a supervisor can change, a worker
                    retries it for a fortnight; told whose it is, they raise it
                    once.
                  */}
                  {record.guidance.actor === 'worker' ? 'يمكنك إصلاحه' : 'يحتاج المشرف'}
                </Badge>
              </div>

              {/* How. */}
              <p className="mt-2 rounded-lg bg-background/70 p-2 text-xs leading-relaxed text-foreground">
                {record.guidance.resolution}
              </p>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {record.guidance.actor === 'worker' && (
                  <Button size="sm" variant="outline" className="h-8 text-xs" asChild>
                    <Link
                      href={`${base}/field/${encodeURIComponent(record.parcelNumber)}${
                        record.draftClientId ? `?draftId=${record.draftClientId}` : ''
                      }`}
                    >
                      افتح السجل وأصلحه
                    </Link>
                  </Button>
                )}
                {record.guidance.droppable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-muted-foreground"
                    onClick={() => setConfirming(record)}
                  >
                    إزالة من قائمة الإرسال
                  </Button>
                )}
                {record.failedAt && (
                  <span className="text-[11px] text-muted-foreground">
                    آخر محاولة: {new Date(record.failedAt).toLocaleString('ar-LB')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/*
        Dropping is the last resort and says exactly what is being given up.
        Offered only where `SYNC_FAILURE_GUIDANCE` marks the failure as one a
        phone genuinely cannot resolve — otherwise the escape hatch becomes the
        way people deal with every rejection.
      */}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(next) => !next && setConfirming(null)}
        title="إزالة هذا السجل من قائمة الإرسال؟"
        description={
          confirming ? (
            <span>
              «{confirming.what} — العقار {confirming.parcelNumber}» لن يُرسل إلى البلدية ولن يبقى
              على الجهاز. لا يمكن التراجع.
            </span>
          ) : null
        }
        confirmLabel="نعم، أزِلْه"
        onConfirm={() => {
          if (confirming) onDrop(confirming.clientId);
          setConfirming(null);
        }}
      />
    </>
  );
}

function StatusBadge({ parcel }: { parcel: CachedParcel }) {
  const registeredCount = parcel.registeredCitizens.length;
  const drafts = parcel.drafts;

  if (registeredCount > 0) {
    return (
      <div className="flex shrink-0 items-center gap-1.5">
        <Badge variant="soft-success" className="gap-1">
          <CheckCircle2 className="size-3" aria-hidden />
          {registeredCount > 1 ? `${registeredCount} مسجّلين` : 'مسجّل'}
        </Badge>
        {drafts.length > 0 && (
          <Badge variant="soft-warning" className="text-xs">
            +{drafts.length} قيد المتابعة
          </Badge>
        )}
      </div>
    );
  }

  if (drafts.length > 0) {
    // Recomputed from the payload, like everywhere else that decides whether a
    // household is filable. `d.gaps` is a cache the server may not have
    // refreshed, and a badge saying «مكتملة» about a record the register will
    // refuse is worse than no badge.
    const complete = drafts.filter((d) => draftGaps(d.payload).length === 0).length;
    if (complete === drafts.length) {
      return (
        <Badge variant="soft-success" className="shrink-0 gap-1">
          <CheckCircle2 className="size-3" aria-hidden />
          {drafts.length > 1 ? `${drafts.length} مسودات مكتملة` : 'مسودة مكتملة'}
        </Badge>
      );
    }
    return (
      <Badge variant="soft-warning" className="shrink-0">
        {complete > 0 ? `${complete}/${drafts.length} مكتملة` : `${drafts.length} ناقصة`}
      </Badge>
    );
  }

  if (!parcel.lastOutcome) {
    return (
      <Badge variant="soft-muted" className="shrink-0">
        لم تُزَر
      </Badge>
    );
  }
  if (parcel.lastDisposition === 'WAITING') {
    return (
      <Badge variant="soft-info" className="shrink-0">
        بانتظار
      </Badge>
    );
  }
  if (parcel.lastDisposition === 'CLOSED') {
    return (
      <Badge variant="soft-muted" className="shrink-0">
        مغلق
      </Badge>
    );
  }
  return (
    <Badge variant="soft-warning" className="shrink-0">
      زيارة أخرى
    </Badge>
  );
}

/**
 * The newest thing that happened here — a visit, or an edit to any household.
 *
 * Only used for the «الأحدث» ordering.
 */
function latestActivity(parcel: CachedParcel): number {
  const times = [
    parcel.lastVisitedAt,
    ...parcel.drafts.map((d) => d.updatedAt),
    ...parcel.drafts.map((d) => d.lastVisitedAt),
  ];
  let latest = 0;
  for (const value of times) {
    if (!value) continue;
    const at = new Date(value).getTime();
    if (!Number.isNaN(at)) latest = Math.max(latest, at);
  }
  return latest;
}

function matchesQuery(parcel: CachedParcel, term: string): boolean {
  if (parcel.parcelNumber.toLowerCase().includes(term)) return true;
  if (parcel.zoneCode.toLowerCase().includes(term)) return true;
  if (
    parcel.registeredCitizens.some(
      (c) => c.name.toLowerCase().includes(term) || (c.phone ?? '').includes(term),
    )
  ) {
    return true;
  }
  return parcel.drafts.some((d) => (d.citizenName ?? '').toLowerCase().includes(term));
}

function filterParcels(
  parcels: readonly CachedParcel[],
  filter: Filter,
  query: string,
  sort: SortOrder,
): CachedParcel[] {
  const term = query.trim().toLowerCase();
  const matched = term ? parcels.filter((parcel) => matchesQuery(parcel, term)) : [...parcels];

  const now = new Date();
  const byFilter = matched.filter((parcel) => {
    if (filter === 'all') return true;
    // A lens across the other four, not a fifth state — see `counts`.
    if (filter === 'drafts') return parcel.drafts.length > 0;
    const state = parcelCaseState(parcel, now);
    return filter === 'done' ? state === 'closed' : state === filter;
  });

  return byFilter.sort((a, b) => {
    if (sort === 'recent') {
      const diff = latestActivity(b) - latestActivity(a);
      if (diff !== 0) return diff;
    }
    /*
     * Parcel number, always, as the tie-break and as the whole of «ترتيب
     * المسار».
     *
     * Cadastral numbering broadly follows the street, so this is a walkable
     * order: it is the sequence someone covering a sector on foot actually
     * moves in. «الأحدث» is the better answer while working one building —
     * whatever you just touched stays at the top — and the worse one while
     * covering a street, which is why both exist rather than one replacing
     * the other.
     */
    return a.parcelNumber.localeCompare(b.parcelNumber, 'en', { numeric: true });
  });
}

type Toaster = ReturnType<typeof useToast>;

function announce(report: SyncReport, toast: Toaster): void {
  if (report.error) {
    toast.error('تعذّرت المزامنة', { description: report.error });
    return;
  }

  /*
    A household that was reported «منجز» at the door and did not reach the
    register outranks everything else here.

    The worker was told, in a toast, that this record would be filed on the next
    sync. If it was not — a duplicate national id, a rule the doorstep validator
    cannot see — they are the only person who can still do anything about it,
    and they can only do it while they remember the house. Silence here is the
    failure mode this whole path was rebuilt to remove.
  */
  if (report.promotionFailures.length > 0) {
    const parcels = [...new Set(report.promotionFailures.map((f) => f.parcelNumber))];
    toast.error('تعذّر تسجيل بعض المواطنين رسمياً', {
      description: `${parcels.slice(0, 3).join('، ')}${parcels.length > 3 ? ` و${parcels.length - 3} غيرها` : ''} — ${report.promotionFailures[0]!.error}`,
    });
    return;
  }

  /*
    A collision means two people collected the same household — the one outcome
    the parcel partition exists to prevent — so it outranks the summary rather
    than being appended to it.
  */
  if (report.conflicted.length > 0) {
    toast.warning('عقارات سجّلها موظف آخر', {
      description: `${report.conflicted.slice(0, 5).join('، ')} — راجع البلدية قبل متابعة العمل عليها.`,
    });
    return;
  }

  const parts: string[] = [];
  if (report.pushed > 0) parts.push(`أُرسل ${report.pushed}`);
  if (report.rejected > 0) parts.push(`رُفض ${report.rejected}`);
  if (report.discarded > 0) parts.push(`حُذف ${report.discarded}`);
  if (report.superseded.length > 0) parts.push(`${report.superseded.length} سُجّل من جهة أخرى`);
  const description = parts.length > 0 ? parts.join(' — ') : `${report.pulled} عقاراً في قائمتك`;

  if (report.rejected > 0) {
    toast.warning('تمت المزامنة مع رفض بعض السجلات', { description });
    return;
  }

  // Named, not counted. "3 records filed" is a number; «سُجّل أحمد خليل رسمياً»
  // is the moment a morning of knocking became rows on the municipality's
  // register, and it is the only confirmation the worker ever gets.
  if (report.promoted.length > 0) {
    const first = report.promoted[0]!;
    const rest = report.promoted.length - 1;
    toast.success('تم التسجيل الرسمي', {
      description:
        `سُجّل ${first.citizenName ?? `العقار ${first.parcelNumber}`}` +
        (first.referenceNumber ? ` — رقم المرجع ${first.referenceNumber}` : '') +
        (rest > 0 ? ` و${rest} غيره` : ''),
    });
    return;
  }

  toast.success('تمت المزامنة', { description });
}
