'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ClipboardList,
  CloudOff,
  DoorClosed,
  Loader2,
  RefreshCw,
  Search,
  WifiOff,
} from 'lucide-react';
import { ar } from '@mechanization/shared-schemas';
import { loadSession } from '@/lib/session';
import { logApiError } from '@/lib/api-client';
import {
  applyVisitLocally,
  enqueue,
  isFieldStorageAvailable,
  loadWorklist,
  outboxSize,
  readMeta,
  type CachedParcel,
} from '@/lib/field-db';
import { syncNow, type SyncReport } from '@/lib/field-sync';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

type Filter = 'todo' | 'due' | 'waiting' | 'done' | 'all';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'todo', label: 'لم تُزَر' },
  { value: 'due', label: 'مستحقة' },
  { value: 'waiting', label: 'بانتظار' },
  { value: 'done', label: 'منجزة' },
  { value: 'all', label: 'الكل' },
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
  const [storageBroken, setStorageBroken] = useState(false);
  const [filter, setFilter] = useState<Filter>('todo');
  const [query, setQuery] = useState('');
  const [visitTarget, setVisitTarget] = useState<CachedParcel | null>(null);

  /** The doorstep form is a page of its own — see `field/[parcelNumber]`. */
  const openDraft = (parcel: CachedParcel) =>
    router.push(`${base}/field/${encodeURIComponent(parcel.parcelNumber)}`);

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
      const [parcels, pending, meta] = await Promise.all([
        loadWorklist(),
        outboxSize(),
        readMeta(),
      ]);
      return { parcels, pending, lastPulledAt: meta.lastPulledAt };
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

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('الجلسة منتهية');
      return syncNow(tenant, session.accessToken, session.user.id);
    },
    onSuccess: async (report) => {
      await refreshLocal();
      announce(report, toast);
    },
    onError: (error: unknown) => {
      logApiError(error);
      toast.error('تعذّرت المزامنة');
    },
  });

  /*
    Sync on mount and when the connection returns.

    Quiet: it reports only what the worker must act on — a collision or a
    rejection. Announcing "synced, nothing changed" every time a connection
    blips trains people to dismiss the toast that eventually matters.

    Not on a timer either. A background poll on a metered village connection is
    not a favour, and the button is always there.
  */
  useEffect(() => {
    if (!storageUsable || !session) return;

    const quietSync = () => {
      if (!navigator.onLine) return;
      syncMutation.mutate(undefined, {
        onSuccess: async (report) => {
          await refreshLocal();
          if (report.conflicted.length > 0 || report.rejected > 0) announce(report, toast);
        },
        onError: (error: unknown) => logApiError(error),
      });
    };

    const goOnline = () => {
      setOnline(true);
      quietSync();
    };
    const goOffline = () => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    quietSync();

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
      await enqueue({
        kind: 'visit',
        clientId: crypto.randomUUID(),
        parcelNumber: parcel.parcelNumber,
        outcome: result.outcome,
        visitedAt: now,
        note: result.note,
        nextVisitAt: result.nextVisitAt,
        proxyName: result.proxyName,
        proxyPhone: result.proxyPhone,
        latitude: result.latitude,
        longitude: result.longitude,
        draftClientId: parcel.draft?.clientId,
      });
      // Reflected in the list at once. Waiting for a sync that may be hours away
      // would leave the worker unable to tell which doors they had already done.
      await applyVisitLocally(parcel.parcelNumber, {
        lastOutcome: result.outcome,
        lastVisitedAt: now,
        nextVisitAt: result.nextVisitAt ?? null,
        visitCount: parcel.visitCount + 1,
      });
    },
    onSuccess: async () => {
      setVisitTarget(null);
      await refreshLocal();
      toast.success('حُفظت الزيارة على الجهاز');
      if (navigator.onLine) syncMutation.mutate(undefined, { onSuccess: () => refreshLocal() });
    },
    onError: () => toast.error('تعذّر الحفظ على الجهاز'),
  });

  const parcels = useMemo(() => local.data?.parcels ?? [], [local.data]);
  const pending = local.data?.pending ?? 0;

  const counts = useMemo(
    () => ({
      todo: parcels.filter((p) => !p.registered && !p.lastOutcome).length,
      due: parcels.filter(isDue).length,
      waiting: parcels.filter((p) => p.lastDisposition === 'WAITING').length,
      done: parcels.filter((p) => p.registered || p.lastDisposition === 'CLOSED').length,
    }),
    [parcels],
  );

  const visible = useMemo(() => filterParcels(parcels, filter, query), [parcels, filter, query]);

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
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || !online}
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

        The same shape the register and the ledger raise their notices in —
        `rounded-xl border` over a wash of the semantic token, not a `Card`
        with its shadow switched off. `--warning` rather than a raw amber,
        because that token is contrast-measured against both grounds and a
        literal `amber-500` is not.
      */}
      {!online && (
        <p
          role="status"
          className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm leading-relaxed text-warning"
        >
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            لا يوجد اتصال. كل ما تسجّله محفوظ على الجهاز
            {pending > 0 && ` (${pending} بانتظار الإرسال)`} وسيُرسل تلقائياً عند عودة الشبكة.
          </span>
        </p>
      )}

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
                  <button
                    key={option.value}
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
                );
              })}
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
                parcels.length === 0 && online ? (
                  <Button variant="outline" onClick={() => syncMutation.mutate()}>
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
        onOpenDraft={(parcel) => {
          setVisitTarget(null);
          openDraft(parcel);
        }}
      />
    </div>
  );
}

function StatusBadge({ parcel }: { parcel: CachedParcel }) {
  if (parcel.registered) {
    return (
      <Badge variant="soft-success" className="shrink-0 gap-1">
        <CheckCircle2 className="size-3" aria-hidden />
        مسجّل
      </Badge>
    );
  }
  if (parcel.draft) {
    return (
      <Badge variant="soft-warning" className="shrink-0">
        بيانات ناقصة
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

/** Due when a return date has arrived, or when a retry has no date at all. */
function isDue(parcel: CachedParcel): boolean {
  if (parcel.registered || parcel.lastDisposition === 'CLOSED') return false;
  if (!parcel.lastOutcome) return false;
  if (!parcel.nextVisitAt) return parcel.lastDisposition === 'RETRY';
  return new Date(parcel.nextVisitAt) <= new Date();
}

function filterParcels(
  parcels: readonly CachedParcel[],
  filter: Filter,
  query: string,
): CachedParcel[] {
  const term = query.trim();
  const matched = term
    ? parcels.filter((parcel) => parcel.parcelNumber.includes(term))
    : [...parcels];

  const byFilter = matched.filter((parcel) => {
    switch (filter) {
      case 'todo':
        return !parcel.registered && !parcel.lastOutcome;
      case 'due':
        return isDue(parcel);
      case 'waiting':
        return parcel.lastDisposition === 'WAITING';
      case 'done':
        return parcel.registered || parcel.lastDisposition === 'CLOSED';
      default:
        return true;
    }
  });

  // Never-visited first, then by parcel number — a walkable order, since
  // cadastral numbering broadly follows the street.
  return byFilter.sort((a, b) => {
    const av = a.lastVisitedAt ? 1 : 0;
    const bv = b.lastVisitedAt ? 1 : 0;
    if (av !== bv) return av - bv;
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
  if (report.superseded.length > 0) parts.push(`${report.superseded.length} سُجّل من جهة أخرى`);
  const description = parts.length > 0 ? parts.join(' — ') : `${report.pulled} عقاراً في قائمتك`;

  if (report.rejected > 0) toast.warning('تمت المزامنة مع رفض بعض السجلات', { description });
  else toast.success('تمت المزامنة', { description });
}
