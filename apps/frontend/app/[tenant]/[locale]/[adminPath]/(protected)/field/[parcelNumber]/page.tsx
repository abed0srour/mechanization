'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Plus,
  Trash2,
  Users,
  WifiOff,
} from 'lucide-react';
import {
  OUTCOME_DISPOSITION,
  ar,
  discardDraftSchema,
  draftGaps,
  type FieldDraftPayload,
  type VisitOutcome,
} from '@mechanization/shared-schemas';
import type { PublicTenantConfig } from '@/lib/api-client';
import {
  discardDraftLocally,
  loadWorklist,
  readMeta,
  saveDraftAndVisitLocally,
  saveDraftLocally,
  visitStateChanged,
  type CachedDraft,
} from '@/lib/field-db';
import {
  OUTCOME_GROUPS,
  defaultReturnDate,
  outcomeLabel,
  outcomesFor,
  requiresNote,
  takesProxy,
  takesReturnDate,
  validateVisit,
} from '@/lib/field-outcomes';
import { Textarea } from '@/components/ui/textarea';
import {
  CitizenForm,
  EMPTY_CITIZEN,
  toPayloadProperty,
  toPropertyDraft,
  text,
  type CitizenFormValues,
} from '@/components/admin/citizen-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

/**
 * ──────────────────────  The doorstep record, offline  ───────────────────────
 *
 * The register's own form — literally `CitizenForm`, the same component
 * «تسجيل مواطن جديد» renders — on a page of its own, reading and writing
 * IndexedDB instead of the API.
 *
 * The same component, not a copy of it, and that is the whole point. Every
 * conditional rule in this form is a rule about the municipality's records, not
 * about who is holding the keyboard: رقم السجل only for a Lebanese citizen, a
 * landlord block only for a tenant, a units editor only for a مبنى, خيمة only
 * for a لاجئ. A second, simplified field form would have started as a subset and
 * drifted into a different set of questions — and the worker would have
 * collected the wrong ones, for weeks, before anyone noticed at promotion.
 *
 * So a household with a four-unit building is entered here exactly as it would
 * be at the counter, with as many properties and as many units as it really
 * has.
 *
 * Two things differ, and only two:
 *
 *  1. `allowIncomplete` — «حفظ» never refuses. A worker with three of the nine
 *     answers keeps those three; the gap list below the form says what to ask
 *     for next time rather than blocking the save.
 *  2. It saves to the device, not the server. Promotion into a real citizen
 *     record happens later, through the identical validator, so nothing about
 *     the register's guarantees is loosened by this screen existing.
 *
 * A page rather than the sheet this used to be: the form is three sections tall
 * with a repeatable property card inside the third, and on a phone a sheet that
 * scrolls internally puts «حفظ» and the field being typed in two different
 * scroll contexts.
 *
 * ─────────────────────────────  And now, several  ────────────────────────────
 *
 * One thing was added: the page is scoped to *one household*, chosen by
 * `?draftId=`, because a cadastral number is a building. `?draftId=new` starts
 * another. The form itself did not change — the switcher above it decides which
 * of the parcel's drafts it is editing, and everything in the paragraphs above
 * still holds for each one of them separately.
 */

/**
 * A visit rule the worker can fix, as opposed to a device failure they cannot.
 *
 * Thrown from the save so the same `validateVisit` that guards the quick sheet
 * guards this screen, and caught in `onError` to be shown next to the outcome
 * grid rather than as a generic "could not save".
 */
class VisitRuleError extends Error {}

/**
 * Read off `discardDraftSchema` rather than written down again here.
 *
 * The counter under the reason box and the rule the server enforces are then
 * the same number by construction. A hand-copied `10` is the kind of thing that
 * survives a change to the schema and starts letting through a reason the sync
 * rejects hours later, on a screen the worker has already left.
 */
const DISCARD_REASON_MIN = discardDraftSchema.shape.reason.minLength ?? 10;

export default function FieldDraftPage({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; adminPath: string; parcelNumber: string }>;
}) {
  const { tenant, locale, adminPath, parcelNumber } = use(params);
  const parcel = decodeURIComponent(parcelNumber);
  const base = `/${tenant}/${locale}/${adminPath}`;
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedDraftId = searchParams.get('draftId');
  const toast = useToast();
  const queryClient = useQueryClient();

  /** Everything this screen needs, all of it from the device. */
  const local = useQuery({
    queryKey: ['field-draft', tenant, parcel],
    queryFn: async () => {
      const [parcels, meta] = await Promise.all([loadWorklist(), readMeta()]);
      return {
        parcel: parcels.find((row) => row.parcelNumber === parcel) ?? null,
        config: (meta.config as PublicTenantConfig | null) ?? null,
      };
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const cached = local.data?.parcel ?? null;
  const config = local.data?.config ?? null;

  const draftsList = useMemo(() => cached?.drafts ?? [], [cached]);

  const activeDraft = useMemo(() => {
    if (requestedDraftId === 'new') return null;
    if (requestedDraftId) {
      return draftsList.find((d) => d.clientId === requestedDraftId) ?? null;
    }
    return draftsList[0] ?? null;
  }, [draftsList, requestedDraftId]);

  /**
   * The stored draft as the form's own shape.
   */
  const initial = useMemo<CitizenFormValues>(() => {
    const payload = activeDraft?.payload;
    if (!payload) {
      return {
        ...EMPTY_CITIZEN,
        properties: [{ propertyNumber: parcel }],
      };
    }
    const properties = Array.isArray(payload.properties) ? payload.properties : [];
    return {
      personal: { isLebanese: true, ...(payload.personal ?? {}) },
      contact: {
        whatsappSameAsPhone: true,
        ...(payload.contact ?? {}),
        ...(payload.contact?.familySize !== undefined
          ? { familySize: text(payload.contact.familySize) ?? '' }
          : {}),
      },
      properties:
        properties.length > 0
          ? properties.map((row) => toPropertyDraft(row as Record<string, unknown>))
          : [{ propertyNumber: parcel }],
    };
  }, [activeDraft, parcel]);

  /*
   * Recomputed from the payload, never read from `activeDraft.gaps`.
   *
   * This screen used to consult both — `draftGaps(payload)` to decide whether
   * to offer COMPLETED, and the stored `gaps` array to pick the default
   * outcome — so a stale pull could offer the button and then default away
   * from it. `draftGaps` is the validator promotion runs; the stored array is
   * a render cache.
   */
  const gaps = useMemo(() => (activeDraft ? draftGaps(activeDraft.payload) : []), [activeDraft]);
  const complete = Boolean(activeDraft) && gaps.length === 0;

  const [selectedOutcome, setSelectedOutcome] = useState<VisitOutcome>('PARTIAL');
  const [note, setNote] = useState('');
  const [nextVisitAt, setNextVisitAt] = useState('');
  const [proxyName, setProxyName] = useState('');
  const [proxyPhone, setProxyPhone] = useState('');
  const [visitError, setVisitError] = useState<string | null>(null);
  const [discardReason, setDiscardReason] = useState('');
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  useEffect(() => {
    if (activeDraft) {
      setSelectedOutcome(
        activeDraft.lastOutcome ??
          (draftGaps(activeDraft.payload).length === 0 ? 'COMPLETED' : 'PARTIAL'),
      );
      setNote(activeDraft.note ?? '');
      setNextVisitAt(activeDraft.nextVisitAt ? activeDraft.nextVisitAt.slice(0, 10) : '');
      setProxyName(activeDraft.proxyName ?? '');
      setProxyPhone(activeDraft.proxyPhone ?? '');
    } else {
      setSelectedOutcome('PARTIAL');
      setNote('');
      setNextVisitAt('');
      setProxyName('');
      setProxyPhone('');
    }
    setVisitError(null);
    // A reason typed against one household must never be carried to another.
    setDiscardReason('');
    setConfirmingDiscard(false);
  }, [activeDraft]);

  /** Same clearing rule as the quick sheet — see `field-outcomes`. */
  function chooseOutcome(next: VisitOutcome) {
    setSelectedOutcome(next);
    setNextVisitAt(takesReturnDate(next) ? defaultReturnDate(next) : '');
    if (!takesProxy(next)) {
      setProxyName('');
      setProxyPhone('');
    }
    setVisitError(null);
  }

  /**
   * Save this household, in one place, whichever button asked for it.
   *
   * Two callers with one body: «حفظ الحالة» in the visit section, which reuses
   * the payload already stored, and the form's own submit, which supplies a new
   * one. They were going to be two copies of the same twenty lines, and two
   * copies of a save is two chances for one of them to skip the note rule.
   */
  async function persist(payload: FieldDraftPayload) {
    const clientId = activeDraft?.clientId ?? crypto.randomUUID();
    const personal = (payload.personal ?? {}) as Record<string, unknown>;
    const citizenName =
      [personal.firstName, personal.middleName, personal.lastName]
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .join(' ')
        .trim() || null;

    const now = new Date().toISOString();
    const gapsList = draftGaps(payload).map((gap) => gap.path);
    const isComplete = gapsList.length === 0;

    // COMPLETED on a record that is not complete is downgraded rather than
    // refused: the worker still gets to keep what they collected, and the
    // gap list below the form says what is missing.
    const outcome: VisitOutcome =
      selectedOutcome === 'COMPLETED' && !isComplete ? 'PARTIAL' : selectedOutcome;

    const problem = validateVisit({
      outcome,
      note,
      hasDraft: true,
      draftIsComplete: isComplete,
      citizenName,
      gapCount: gapsList.length,
    });
    if (problem) throw new VisitRuleError(problem);

    const visit = {
      lastOutcome: outcome,
      lastVisitedAt: now,
      nextVisitAt: takesReturnDate(outcome) ? nextVisitAt || null : null,
      note: note.trim() || null,
      proxyName: takesProxy(outcome) ? proxyName.trim() || null : null,
      proxyPhone: takesProxy(outcome) ? proxyPhone.trim() || null : null,
    };

    const draft: CachedDraft = {
      clientId,
      payload,
      gaps: gapsList,
      citizenName,
      updatedAt: now,
      ...visit,
      lastDisposition: OUTCOME_DISPOSITION[outcome],
    };

    /*
     * A visit is recorded only when something about the visit changed.
     *
     * Every save used to file one, so reopening a finished household to fix a
     * misspelt street added a second knock to `field_visits`, bumped «عدد
     * الزيارات السابقة», and made another attempt to promote a citizen that
     * was already on the register. Correcting a form is not a visit; going
     * back to the door is.
     */
    const recordVisit = visitStateChanged(activeDraft, visit);
    if (recordVisit) {
      await saveDraftAndVisitLocally(parcel, draft, visit);
    } else {
      await saveDraftLocally(parcel, draft);
    }

    return { outcome, citizenName, recordVisit, remaining: gapsList.length };
  }

  function announceSaved(result: {
    outcome: VisitOutcome;
    citizenName: string | null;
    recordVisit: boolean;
    remaining: number;
  }): void {
    const who = result.citizenName ?? 'المواطن';
    if (!result.recordVisit) {
      toast.success(`حُدّثت بيانات ${who} على الجهاز`, {
        description: 'لم تُسجَّل زيارة جديدة — لم تتغيّر نتيجة الزيارة.',
      });
    } else if (result.outcome === 'COMPLETED') {
      toast.success(`اكتملت بيانات ${who}`, {
        // Says what the sync will *attempt*, not what it will achieve. The
        // register can still refuse — a duplicate identity number it alone can
        // see — and the sync reports that back by name when it happens.
        description: 'سيُحاول النظام تسجيلها رسمياً عند «مزامنة»، وسيُعلمك إن تعذّر ذلك.',
      });
    } else {
      toast.success(`حُفظت حالة ${who}: ${ar.visitOutcome[result.outcome]}`, {
        description:
          result.remaining > 0
            ? `ما زال ناقصاً ${result.remaining} حقلاً — يمكنك إكمالها في زيارة قادمة.`
            : 'محفوظة على الجهاز وستُرسل عند المزامنة.',
      });
    }
  }

  function reportSaveError(caught: unknown): void {
    if (caught instanceof VisitRuleError) {
      setVisitError(caught.message);
      toast.error(caught.message);
      return;
    }
    toast.error('تعذّر الحفظ على الجهاز');
  }

  async function afterWrite(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['field-draft', tenant, parcel] });
    await queryClient.invalidateQueries({ queryKey: ['field-local', tenant] });
  }

  /** The form's own submit: new answers plus whatever status is selected. */
  const save = useMutation({
    mutationFn: async (values: CitizenFormValues) =>
      persist({
        personal: values.personal,
        contact: values.contact,
        properties: values.properties.map(toPayloadProperty),
      }),
    onSuccess: async (result) => {
      await afterWrite();
      announceSaved(result);
      router.push(`${base}/field`);
    },
    onError: reportSaveError,
  });

  /**
   * Record the status without touching the form.
   *
   * The screen has the register's whole citizen form on it — three sections and
   * a repeatable property card — and its submit button is at the bottom of all
   * of that. So «لا أحد في المنزل» meant scrolling past every question the
   * worker had just been unable to ask, to reach a button labelled as though it
   * were saving answers they did not have.
   *
   * Nobody was home. There is nothing to fill in. This saves the visit against
   * the payload already stored, from the section where the status was chosen,
   * and stays on the page so a second household on the same parcel is one tap
   * away rather than one navigation.
   */
  const saveStatus = useMutation({
    mutationFn: async () => {
      if (!activeDraft) throw new VisitRuleError('لا توجد بيانات لهذا المواطن بعد');
      return persist(activeDraft.payload);
    },
    onSuccess: async (result) => {
      await afterWrite();
      announceSaved(result);
    },
    onError: reportSaveError,
  });

  const discard = useMutation({
    mutationFn: async () => {
      if (!activeDraft) throw new Error('no draft');
      await discardDraftLocally(parcel, activeDraft.clientId, discardReason);
      return activeDraft.citizenName;
    },
    onSuccess: async (name) => {
      await afterWrite();
      setDiscardReason('');
      setConfirmingDiscard(false);
      toast.success(`حُذف ${name ?? 'المواطن'} من هذا العقار`, {
        description: 'لن يظهر في قائمتك بعد الآن، وسيُبلَّغ الخادم عند المزامنة.',
      });
      router.push(`${base}/field`);
    },
    onError: () => toast.error('تعذّر الحذف على الجهاز'),
  });

  if (local.isPending) return <LoadingState fullHeight label="جارٍ فتح البيانات…" />;

  if (!cached) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState
          icon={ClipboardList}
          title={`العقار ${parcel} ليس ضمن قائمتك`}
          description="ربما تغيّر تكليفك منذ آخر مزامنة. ارجع إلى قائمة العمل وزامن."
          action={
            <Link
              href={`${base}/field`}
              className="text-sm font-medium text-primary hover:underline"
            >
              رجوع إلى قائمة العمل
            </Link>
          }
        />
      </div>
    );
  }

  /*
    No cached config means the device has never completed a sync, and the form
    cannot know which أنواع العقارات this municipality accepts. Rendering it
    anyway would offer every type and collect answers the register may refuse —
    worse than saying plainly that one online sync is needed first.
  */
  if (!config) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState
          icon={WifiOff}
          title="يلزم اتصال واحد قبل العمل دون شبكة"
          description="لم تكتمل أي مزامنة على هذا الجهاز بعد، ولا يمكن معرفة أنواع العقارات التي تعتمدها البلدية. اتصل بالشبكة واضغط «مزامنة» مرة واحدة."
          action={
            <Link
              href={`${base}/field`}
              className="text-sm font-medium text-primary hover:underline"
            >
              رجوع إلى قائمة العمل
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href={`${base}/field`}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
        رجوع إلى قائمة العمل
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-5 sm:gap-4 sm:pb-6">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <span
            aria-hidden
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20 sm:size-14"
          >
            <ClipboardList className="size-5 sm:size-7" />
          </span>
          <div className="min-w-0 space-y-1">
            <h1 className="truncate text-xl font-bold tracking-tight sm:text-3xl">
              بيانات العقار {parcel}
            </h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              القطاع {cached.zoneCode} — تسجيل المواطنين والقاطنين في العقار
            </p>
          </div>
        </div>

        {activeDraft ? (
          <Badge variant={complete ? 'soft-success' : 'soft-warning'} className="gap-1">
            {complete && <CheckCircle2 className="size-3" aria-hidden />}
            {complete ? 'مكتملة' : `ناقص ${gaps.length} حقلاً`}
          </Badge>
        ) : (
          <Badge variant="soft-muted">مسودة جديدة</Badge>
        )}
      </div>

      {/*
        Who the register already holds at this number.

        Above the form, not below it, because it is the thing that decides
        whether to fill the form at all — and because entering a household the
        municipality already has is how duplicate citizen records get made.

        Deduplicated by the server; keyed by `citizen.id` alone, which is
        genuinely unique. The `${id}-${idx}` key it carried was a workaround for
        a duplicate-id problem that has been fixed at the source, and a key that
        includes the index defeats React's reconciliation for no benefit.
      */}
      {cached.registeredCitizens.length > 0 && (
        <div className="space-y-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden />
            مسجّلون رسمياً في هذا العقار ({cached.registeredCitizens.length})
          </h4>
          <ul className="mt-2 space-y-1.5">
            {cached.registeredCitizens.map((citizen) => (
              <li
                key={citizen.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/20 bg-background/80 p-2.5 text-xs"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-foreground">{citizen.name}</span>
                  {citizen.phone && (
                    <span className="shrink-0 text-[11px] text-muted-foreground" dir="ltr">
                      {citizen.phone}
                    </span>
                  )}
                </div>
                {citizen.referenceNumber && (
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground" dir="ltr">
                    {citizen.referenceNumber}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        Which household this form is editing.

        The form below is scoped to exactly one of them — `key` on `CitizenForm`
        remounts it on every switch, so half-typed answers cannot leak from one
        neighbour's record into another's.
      */}
      {(draftsList.length > 0 || requestedDraftId === 'new') && (
        <div className="space-y-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Users className="size-3.5" aria-hidden />
            المواطنون على هذا العقار ({draftsList.length})
          </span>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 p-2">
            {draftsList.map((d, idx) => {
              const isSelected = activeDraft?.clientId === d.clientId;
              // Recomputed, not `d.gaps` — same reason as everywhere else.
              const isFilable = draftGaps(d.payload).length === 0;
              return (
                <Button
                  key={d.clientId}
                  type="button"
                  variant={isSelected ? 'default' : 'outline'}
                  size="sm"
                  aria-current={isSelected ? 'page' : undefined}
                  className="h-8 gap-2 text-xs"
                  onClick={() =>
                    router.push(`${base}/field/${encodeURIComponent(parcel)}?draftId=${d.clientId}`)
                  }
                >
                  <span className="max-w-[140px] truncate">
                    {d.citizenName ?? `المواطن / الشقة ${idx + 1}`}
                  </span>
                  <span
                    aria-label={isFilable ? 'مكتملة' : 'ناقصة'}
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      isFilable ? 'bg-emerald-400' : 'bg-amber-400',
                    )}
                  />
                </Button>
              );
            })}
            <Button
              type="button"
              variant={requestedDraftId === 'new' ? 'default' : 'outline'}
              size="sm"
              className="h-8 gap-1 border-dashed text-xs"
              onClick={() => router.push(`${base}/field/${encodeURIComponent(parcel)}?draftId=new`)}
            >
              <Plus className="size-3" aria-hidden />
              مواطن / مستأجر جديد
            </Button>
          </div>
        </div>
      )}

      {/*
        ──────────────────────────  Two sections, folded  ─────────────────────

        This page carries the register's entire citizen form — three sections
        and a repeatable property card — under a fifteen-option status grid.
        Flat, that is a screen you scroll for ten seconds to reach a save
        button, on a phone, standing at somebody's door.

        So the two jobs are separated, and each finishes where it starts:
        «حالة الزيارة» saves the status by itself, «بيانات المواطن» saves the
        answers. The commonest doorstep outcome by far is that nobody was home
        and there are no answers to give — that now takes one tap without ever
        opening the form.

        `defaultOpen` follows from that: status open, form closed for a
        household that already exists, open for one being created. The closed
        section still says how many fields are missing, which is the whole
        reason `CollapsibleSection` takes a `summary`.
      */}
      <CollapsibleSection
        title="حالة الزيارة"
        icon={ClipboardList}
        defaultOpen
        summary={
          <Badge variant="outline" className="font-semibold text-primary">
            {outcomeLabel(selectedOutcome)}
          </Badge>
        }
      >
        <div className="space-y-4 px-5 pb-5">
          <p className="text-xs text-muted-foreground">
            تُسجَّل لهذا المواطن/الشقة وحدها، ولا تؤثر على بقية القاطنين في العقار.
          </p>

          {OUTCOME_GROUPS.map((group) => {
            // COMPLETED is offered only when the record would actually survive
            // promotion — the same `draftGaps` the server runs. Offering it on
            // an incomplete draft and silently downgrading the save is how a
            // worker comes to believe a household is filed when it is not.
            const options = outcomesFor(group.disposition).filter(
              (value) => value !== 'COMPLETED' || complete,
            );
            if (options.length === 0) return null;
            return (
              <div key={group.disposition}>
                <div className="mb-1.5">
                  <h3 className="text-xs font-semibold text-foreground">{group.title}</h3>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{group.hint}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {options.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => chooseOutcome(value)}
                      aria-pressed={selectedOutcome === value}
                      className={cn(
                        'min-h-11 rounded-lg border p-2.5 text-start text-xs transition-all',
                        selectedOutcome === value
                          ? 'border-primary bg-primary/10 font-semibold text-primary ring-2 ring-primary/60'
                          : 'border-border text-foreground hover:border-primary/40 hover:bg-muted/40',
                      )}
                    >
                      {outcomeLabel(value)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          {/*
            The note field, which this screen did not have.

            `recordVisitSchema` rejects REFUSED, DISPUTED, DEMOLISHED,
            ADDRESS_INVALID and MERGED_PARCEL without one. A save that omitted
            it succeeded on the device and was rejected at every subsequent
            sync — stuck in the outbox, on a screen with no way to edit it, for
            good.
          */}
          <div className="border-t pt-3">
            <Label htmlFor="page-note" className="text-xs">
              ملاحظة
              {requiresNote(selectedOutcome) && (
                <span className="text-destructive"> (مطلوبة لهذه النتيجة)</span>
              )}
            </Label>
            <Textarea
              id="page-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="ما يخصّ الزيارة فقط"
              className="text-xs"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              لا تُدوَّن هنا معلومات عن الأسرة أو آراء شخصية — فقط ما يوضّح سبب عدم اكتمال الزيارة.
            </p>
          </div>

          {takesProxy(selectedOutcome) && (
            <div className="grid gap-3 border-t pt-3 text-xs sm:grid-cols-2">
              <div>
                <Label htmlFor="page-proxy-name" className="text-xs">
                  من يمكنه تقديم البيانات
                </Label>
                <Input
                  id="page-proxy-name"
                  value={proxyName}
                  onChange={(e) => setProxyName(e.target.value)}
                  placeholder="قريب، وكيل، حارس"
                  className="h-9 text-xs"
                />
              </div>
              <div>
                <Label htmlFor="page-proxy-phone" className="text-xs">
                  رقم هاتفه
                </Label>
                <Input
                  id="page-proxy-phone"
                  value={proxyPhone}
                  onChange={(e) => setProxyPhone(e.target.value)}
                  dir="ltr"
                  placeholder="+961 أو رقم دولي"
                  className="h-9 max-w-xs text-xs"
                />
              </div>
            </div>
          )}

          {takesReturnDate(selectedOutcome) && (
            <div className="border-t pt-3">
              <Label htmlFor="page-next-visit" className="text-xs">
                موعد الزيارة القادمة
              </Label>
              <Input
                id="page-next-visit"
                type="date"
                value={nextVisitAt}
                onChange={(e) => setNextVisitAt(e.target.value)}
                className="h-9 max-w-xs text-xs"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                عند حلول هذا التاريخ ينتقل العقار تلقائياً إلى «مستحقة».
              </p>
            </div>
          )}

          {visitError && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
              {visitError}
            </p>
          )}

          {/*
            The save the page did not have.

            Present only once the household exists — there is nothing to record
            a visit against otherwise, and the form below is the way to create
            one. For everyone else this is the end of the job: choose, save,
            done, without the form ever being opened.
          */}
          <div className="border-t pt-3">
            {activeDraft ? (
              <>
                <Button
                  className="w-full"
                  onClick={() => saveStatus.mutate()}
                  disabled={saveStatus.isPending || save.isPending}
                >
                  {saveStatus.isPending
                    ? 'جارٍ الحفظ…'
                    : `حفظ الحالة لـ ${activeDraft.citizenName ?? 'هذا المواطن'}`}
                </Button>
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  يحفظ النتيجة وحدها — لا حاجة لفتح الاستمارة أو تعديل أي حقل.
                </p>
              </>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                أدخل بيانات هذا المواطن أولاً في القسم أدناه، ثم يمكنك حفظ الحالة من هنا.
              </p>
            )}
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="بيانات المواطن"
        icon={Users}
        defaultOpen={!activeDraft}
        summary={
          activeDraft ? (
            <Badge variant={complete ? 'soft-success' : 'soft-warning'} className="gap-1">
              {complete && <CheckCircle2 className="size-3" aria-hidden />}
              {complete ? 'مكتملة' : `ناقص ${gaps.length} حقلاً`}
            </Badge>
          ) : (
            <Badge variant="soft-muted">جديدة</Badge>
          )
        }
      >
        <div className="space-y-4 px-5 pb-5">
          {/* Said once, at the top, rather than on every save: this screen never
              reaches the network, and a worker should know that before they
              start typing rather than wonder why nothing uploaded. */}
          <Card className="border-dashed shadow-none">
            <CardContent className="flex items-start gap-3 p-4 text-xs leading-relaxed text-muted-foreground">
              <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                يُحفظ كل شيء على الجهاز فوراً ويُرسل عند المزامنة. لا حاجة لاتصال الآن، ولا يُشترط
                إكمال كل الحقول — احفظ ما لديك وأكمل الباقي في زيارة قادمة.
              </span>
            </CardContent>
          </Card>

          {activeDraft && !complete && gaps.length > 0 && (
            <Card className="border-warning/40 bg-warning/5 shadow-none">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <span className="inline-block size-2 rounded-full bg-amber-500" aria-hidden />
                  <span className="text-sm font-medium text-amber-900 dark:text-amber-300">
                    ما زال ناقصاً {gaps.length} حقلاً
                    {activeDraft.citizenName ? ` لـ ${activeDraft.citizenName}` : ''}:
                  </span>
                </div>
                <ul className="mt-2.5 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  {gaps.map((gap) => (
                    <li key={gap.path} className="flex items-center gap-1.5">
                      <span className="size-1 rounded-full bg-amber-500/60" aria-hidden />
                      <span>{gap.message}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {activeDraft && complete && (
            <Card className="border-emerald-500/40 bg-emerald-500/5 shadow-none">
              <CardContent className="flex items-center gap-2 p-4">
                <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
                <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                  البيانات مستوفاة
                  {activeDraft.citizenName ? ` لـ ${activeDraft.citizenName}` : ''} — يمكن اختيار
                  «منجز» أعلاه لتسجيلها رسمياً.
                </span>
              </CardContent>
            </Card>
          )}

          <CitizenForm
            key={activeDraft?.clientId ?? 'new'}
            tenant={tenant}
            config={config}
            mode="create"
            initial={initial}
            submitting={save.isPending}
            error={null}
            onSubmit={(values) => save.mutate(values)}
            onCancel={() => router.push(`${base}/field`)}
            locale={locale}
            allowIncomplete
            // Names what the button does, not what the record is. «حفظ وإتمام»
            // read as a promise that the household was filed; the filing
            // happens at the next sync and can still be refused.
            submitLabel={
              selectedOutcome === 'COMPLETED' && complete
                ? 'حفظ البيانات وإنهاء هذا المواطن'
                : 'حفظ البيانات على الجهاز'
            }
          />
        </div>
      </CollapsibleSection>

      {/*
        ────────────────────────  Taking back a mistake  ──────────────────────

        Closed by default and last on the page, because it is the one action
        here that removes work rather than recording it.

        It exists because the mistake it undoes is easy and was previously
        permanent: «مواطن جديد» tapped twice leaves a second, empty household
        on the parcel — and since an open draft counts as unfinished work, that
        empty household kept its whole building in «مستحقة», sending the worker
        back to a real door indefinitely for a record that was a mis-tap.

        A reason is required, for the same reason `OUTCOME_REQUIRES_NOTE`
        exists: this is the only thing a field worker can do that takes a
        household off the list without visiting anybody, and a supervisor
        eventually asks why. Ten characters is no bar to anyone with an answer.
      */}
      {activeDraft && (
        <CollapsibleSection
          title="حذف هذا المواطن من العقار"
          icon={Trash2}
          defaultOpen={false}
          summary={<span className="text-xs text-muted-foreground">إن أُضيف بالخطأ</span>}
        >
          <div className="space-y-3 px-5 pb-5">
            <p className="text-xs leading-relaxed text-muted-foreground">
              يُستخدم فقط إذا أُضيف هذا المواطن بالخطأ — ضغطة مكرّرة على «مواطن جديد»، أو تسجيل على
              العقار الخطأ. الزيارات التي سُجّلت فعلاً تبقى محفوظة كسجل للعمل المنجز.
            </p>

            <div>
              <Label htmlFor="discard-reason" className="text-xs">
                سبب الحذف <span className="text-destructive">(مطلوب)</span>
              </Label>
              <Textarea
                id="discard-reason"
                value={discardReason}
                onChange={(e) => setDiscardReason(e.target.value)}
                maxLength={300}
                rows={2}
                placeholder="مثال: أُضيف بالخطأ — نفس العائلة مسجّلة في البطاقة الأولى"
                className="text-xs"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {discardReason.trim().length < DISCARD_REASON_MIN
                  ? `اذكر السبب بجملة قصيرة (${discardReason.trim().length}/${DISCARD_REASON_MIN} حرفاً على الأقل)`
                  : 'يُحفظ السبب مع السجل ويظهر للبلدية.'}
              </p>
            </div>

            <Button
              variant="outline"
              className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
              disabled={discardReason.trim().length < DISCARD_REASON_MIN || discard.isPending}
              onClick={() => setConfirmingDiscard(true)}
            >
              <Trash2 className="size-4" aria-hidden />
              حذف {activeDraft.citizenName ?? 'هذا المواطن'} من العقار
            </Button>
          </div>
        </CollapsibleSection>
      )}

      <ConfirmDialog
        open={confirmingDiscard}
        onOpenChange={setConfirmingDiscard}
        title={`حذف ${activeDraft?.citizenName ?? 'هذا المواطن'} من العقار ${parcel}؟`}
        description={
          <span>
            سيختفي من قائمتك ولن يُطلب منك زيارته مجدداً. الزيارات المسجّلة له تبقى محفوظة.
            <br />
            السبب المُسجَّل: «{discardReason.trim()}»
          </span>
        }
        confirmLabel="نعم، احذفه"
        onConfirm={() => discard.mutateAsync().then(() => undefined)}
      />
    </div>
  );
}
