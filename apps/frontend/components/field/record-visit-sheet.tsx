'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, MapPin } from 'lucide-react';
import { OUTCOME_DISPOSITION, draftGaps, type VisitOutcome } from '@mechanization/shared-schemas';
import type { CachedDraft, CachedParcel } from '@/lib/field-db';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Sheet } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Recording what happened at one door.
 *
 * The outcome vocabulary — the groups, the default return dates, the note rule
 * — lives in `@/lib/field-outcomes`, shared with the doorstep form page. Two
 * screens offering different answers to "what happened here" is how a worker
 * learns not to trust either.
 */

/**
 * What the sheet hands back.
 *
 * `draftClientId` is `string | null`, not optional. The visit is either about a
 * household or about the building, the caller must handle both, and `undefined`
 * meaning "the caller will guess" is precisely how «المبنى مقفل بالكامل» came
 * to be filed against apartment 1.
 */
export interface VisitDraftResult {
  outcome: VisitOutcome;
  note: string | null;
  nextVisitAt: string | null;
  proxyName: string | null;
  proxyPhone: string | null;
  latitude?: number;
  longitude?: number;
  draftClientId: string | null;
}

export function RecordVisitSheet({
  parcel,
  open,
  captureLocation,
  onClose,
  onSubmit,
  onOpenDraft,
}: {
  parcel: CachedParcel | null;
  open: boolean;
  /** Whether this municipality has turned on location capture. See below. */
  captureLocation: boolean;
  onClose: () => void;
  onSubmit: (result: VisitDraftResult) => void;
  onOpenDraft: (parcel: CachedParcel, draftId?: string) => void;
}) {
  const [outcome, setOutcome] = useState<VisitOutcome | null>(null);
  const [note, setNote] = useState('');
  const [nextVisitAt, setNextVisitAt] = useState('');
  const [proxyName, setProxyName] = useState('');
  const [proxyPhone, setProxyPhone] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * What this visit is *about*, and there is no default when it is ambiguous.
   *
   * `null` means nothing is chosen yet, and the save button stays disabled.
   * The earlier version silently aimed at the newest draft — the first card
   * rendered as «محدد للتسجيل ✓» without anyone having touched it — so a
   * worker on a four-apartment building could file COMPLETED against a
   * household they never looked at, and the register would gain a citizen from
   * somebody else's data.
   *
   * A single household is auto-selected, because with one option there is no
   * ambiguity to resolve and making someone tap to confirm the only answer is
   * friction that buys nothing.
   */
  const [target, setTarget] = useState<{ kind: 'draft'; clientId: string } | { kind: 'parcel' } | null>(
    null,
  );

  const draftsList = useMemo(() => parcel?.drafts ?? [], [parcel]);

  const activeDraft = useMemo(() => {
    if (target?.kind !== 'draft') return null;
    return draftsList.find((d) => d.clientId === target.clientId) ?? null;
  }, [draftsList, target]);

  /**
   * Recomputed from the payload, never read from the stored `gaps`.
   *
   * `draftGaps` is the same validator that promotion runs on the server, so
   * this is the only number that predicts whether COMPLETED will actually
   * produce a citizen record. The stored array is a render cache that a stale
   * pull can contradict, and the two disagreeing is how a worker gets told
   * «مكتملة» about a household the register will refuse.
   */
  const gaps = useMemo(
    () => (activeDraft ? draftGaps(activeDraft.payload) : []),
    [activeDraft],
  );

  const hasDraft = target?.kind === 'draft' && Boolean(activeDraft);
  const draftIsFilable = hasDraft && gaps.length === 0;

  /*
   * A new door starts blank.
   *
   * The sheet is a single instance reused for every parcel, so without this a
   * household selected at number 412 stays selected when 414 opens — pointing
   * at a `clientId` that is not on this parcel at all. Keyed on the number
   * rather than the object: the worklist is replaced wholesale on every pull,
   * so identity changes constantly while the door does not.
   */
  const parcelNumber = parcel?.parcelNumber ?? null;
  useEffect(() => {
    reset();
  }, [parcelNumber]);

  // One household, no ambiguity — select it. Two or more, or none, and the
  // worker says which before anything can be saved.
  useEffect(() => {
    if (!open) return;
    if (target === null && draftsList.length === 1) {
      selectDraft(draftsList[0]!);
    }
  }, [open, draftsList, target]);

  /** Load a household's current case so the sheet edits it rather than replacing it. */
  function selectDraft(d: CachedDraft) {
    setTarget({ kind: 'draft', clientId: d.clientId });
    setOutcome(d.lastOutcome ?? null);
    setNote(d.note ?? '');
    setNextVisitAt(d.nextVisitAt ? d.nextVisitAt.slice(0, 10) : '');
    setProxyName(d.proxyName ?? '');
    setProxyPhone(d.proxyPhone ?? '');
    setError(null);
  }

  function selectParcel() {
    setTarget({ kind: 'parcel' });
    setOutcome(parcel?.lastOutcome ?? null);
    setNote('');
    setNextVisitAt(parcel?.nextVisitAt ? parcel.nextVisitAt.slice(0, 10) : '');
    setProxyName('');
    setProxyPhone('');
    setError(null);
  }

  function reset() {
    setOutcome(null);
    setNote('');
    setNextVisitAt('');
    setProxyName('');
    setProxyPhone('');
    setCoords(null);
    setError(null);
    setTarget(null);
  }

  /**
   * Changing the outcome replaces every field that belongs to it.
   *
   * Including clearing them. A case moved from «بانتظار مستندات» to «منجز» has
   * no return date and no وكيل any more, and leaving the old ones in the boxes
   * is how they got saved: the parcel then sat in «مستحقة» forever, owed on a
   * date that had already passed, for a household that was finished.
   */
  function choose(next: VisitOutcome) {
    setOutcome(next);
    setNextVisitAt(takesReturnDate(next) ? defaultReturnDate(next) : '');
    if (!takesProxy(next)) {
      setProxyName('');
      setProxyPhone('');
    }
    setError(null);
  }

  /**
   * Location is requested only when the worker taps for it, and only when the
   * municipality has enabled it. Silently stamping coordinates on every visit
   * would be surveillance of staff dressed up as a feature — a decision for the
   * municipality to take openly with the people it affects, not for this
   * component to take on their behalf.
   */
  function takeLocation() {
    if (!navigator.geolocation) {
      setError('الجهاز لا يدعم تحديد الموقع');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        setCoords({ lat: position.coords.latitude, lon: position.coords.longitude }),
      () => setError('تعذّر تحديد الموقع'),
      { timeout: 8000 },
    );
  }

  function submit() {
    if (!outcome) {
      setError('اختر نتيجة الزيارة');
      return;
    }
    if (!target) {
      setError('اختر أولاً: أي مواطن/شقة تسجّل نتيجتها، أو العقار بالكامل');
      return;
    }

    // Every rule the server enforces, enforced here first. A visit rejected at
    // sync sits in the outbox for good — the worker is hours away from the door
    // by then and there is no screen that can edit it.
    const problem = validateVisit({
      outcome,
      note,
      hasDraft,
      draftIsComplete: draftIsFilable,
      citizenName: activeDraft?.citizenName,
      gapCount: gaps.length,
    });
    if (problem) {
      setError(problem);
      return;
    }

    onSubmit({
      outcome,
      note: note.trim() || null,
      // Cleared, not carried: an outcome that takes no return date has none,
      // and one that takes no وكيل has none either.
      nextVisitAt: takesReturnDate(outcome) ? nextVisitAt || null : null,
      proxyName: takesProxy(outcome) ? proxyName.trim() || null : null,
      proxyPhone: takesProxy(outcome) ? proxyPhone.trim() || null : null,
      latitude: coords?.lat,
      longitude: coords?.lon,
      draftClientId: target.kind === 'draft' ? target.clientId : null,
    });
    reset();
  }

  if (!parcel) return null;

  const disposition = outcome ? OUTCOME_DISPOSITION[outcome] : null;
  const needsProxy = outcome ? takesProxy(outcome) : false;
  const targetLabel =
    target?.kind === 'parcel'
      ? `العقار ${parcel.parcelNumber} بالكامل`
      : (activeDraft?.citizenName ?? (target ? 'المواطن / الشقة المحددة' : null));

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={`العقار ${parcel.parcelNumber}`}
      description={`القطاع ${parcel.zoneCode}${parcel.visitCount > 0 ? ` — ${parcel.visitCount} زيارة سابقة` : ''}${parcel.registered ? ' • مسجّل' : ''}`}
      footer={
        <div>
          {error && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <Button className="w-full" onClick={submit} disabled={!outcome || !target}>
            {target ? `حفظ الحالة لـ ${targetLabel}` : 'اختر المواطن أو العقار أولاً'}
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            يُحفظ على الجهاز فوراً ويُرسل عند توفّر الاتصال
          </p>
        </div>
      }
    >
      <div className="space-y-6">
        {/*
          Who the register already holds here.

          First thing on the sheet, above everything, because it answers the
          question that decides whether this door is worth ten minutes at all —
          and because collecting a household the municipality already has is
          both the commonest wasted visit and the commonest source of duplicate
          citizen records.
        */}
        {parcel.registeredCitizens.length > 0 && (
          <div className="space-y-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden />
              مسجّلون رسمياً في هذا العقار ({parcel.registeredCitizens.length})
            </h4>
            <ul className="mt-2 space-y-1.5">
              {parcel.registeredCitizens.map((citizen) => (
                <li
                  key={citizen.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/20 bg-background/80 p-2 text-xs"
                >
                  <span className="truncate font-medium text-foreground">{citizen.name}</span>
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
          The households on this parcel, and the choice of which one this visit
          is about.

          Nothing is pre-selected when there is more than one. A cadastral
          number is a building; recording an outcome without saying which
          apartment it happened at is not a shortcut, it is a wrong answer.
        */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              المواطنون والقاطنون ({draftsList.length})
            </h3>
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={() => onOpenDraft(parcel, 'new')}
            >
              + إضافة مواطن آخر
            </Button>
          </div>

          {draftsList.length > 1 && !target && (
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              في هذا العقار أكثر من مواطن — اختر أيّهم تسجّل نتيجة زيارته.
            </p>
          )}

          {draftsList.map((d, idx) => {
            // Recomputed, not read from `d.gaps`: the badge must agree with the
            // rule that decides whether COMPLETED will actually file a record.
            const dGaps = draftGaps(d.payload);
            const isSelected = target?.kind === 'draft' && target.clientId === d.clientId;
            const isFilable = dGaps.length === 0;
            const label = d.citizenName ?? `المواطن / الشقة ${idx + 1}`;

            return (
              /*
                Two real buttons side by side, not a clickable card wrapping
                them. A `role="button"` container with buttons inside it is
                unreachable by keyboard in a sensible order and ambiguous to a
                screen reader — and this is a government tool, where that is a
                requirement rather than a nicety. The whole card is still a
                comfortable tap target: «تحديد» spans its full height.
              */
              <Card
                key={d.clientId}
                className={cn(
                  'border shadow-none transition-all',
                  isSelected
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/60'
                    : 'hover:bg-muted/40',
                )}
              >
                <CardContent className="flex items-center justify-between gap-2 p-3.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{label}</span>
                      <Badge
                        variant={isFilable ? 'soft-success' : 'soft-warning'}
                        className="px-1.5 py-0 text-[11px]"
                      >
                        {isFilable ? 'مكتملة' : `ناقص ${dGaps.length}`}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {d.lastOutcome ? (
                        <span className="font-medium text-primary">
                          {outcomeLabel(d.lastOutcome)}
                          {d.nextVisitAt ? ` — العودة ${d.nextVisitAt.slice(0, 10)}` : ''}
                        </span>
                      ) : (
                        'لم تُسجّل نتيجة زيارة بعد'
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="sm"
                      variant={isSelected ? 'default' : 'outline'}
                      aria-pressed={isSelected}
                      className="h-9 text-xs"
                      onClick={() => selectDraft(d)}
                    >
                      {isSelected ? 'محدَّد ✓' : 'تحديد'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-9 text-xs"
                      onClick={() => onOpenDraft(parcel, d.clientId)}
                    >
                      الاستمارة
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {draftsList.length === 0 && (
            <Button
              variant="outline"
              className="w-full border-dashed"
              onClick={() => onOpenDraft(parcel, 'new')}
            >
              تسجيل بيانات مواطن / عائلة على هذا العقار
            </Button>
          )}

          {/*
            A statement about the building rather than about anyone in it.
            Kept visibly separate from the household cards — it is a different
            kind of fact, and the sync treats it as one.
          */}
          <button
            type="button"
            aria-pressed={target?.kind === 'parcel'}
            onClick={selectParcel}
            className={cn(
              'mt-2 w-full rounded-xl border p-3 text-start text-xs transition-colors',
              target?.kind === 'parcel'
                ? 'border-primary bg-primary/5 font-semibold text-primary ring-2 ring-primary/60'
                : 'border-dashed border-border text-muted-foreground hover:bg-muted/40',
            )}
          >
            🏢 أو حالة للعقار بالكامل — المبنى مقفل، تعذّر الوصول، هُدم، رقم غير صحيح
          </button>
        </div>

        <div className="border-t pt-4">
          <h3 className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
            <span>نتيجة الزيارة لـ:</span>
            <span className="text-primary underline">{targetLabel ?? '— لم تُحدَّد بعد —'}</span>
          </h3>
          <p className="text-xs text-muted-foreground">
            {target?.kind === 'parcel'
              ? 'تسري على العقار ككل ولا تغيّر حالة أي مواطن مسجَّل فيه.'
              : 'تُسجَّل لهذا المواطن/الشقة وحدها، ولا تؤثر على بقية القاطنين.'}
          </p>
        </div>

        {OUTCOME_GROUPS.map((group) => {
          const options = outcomesFor(group.disposition);
          return (
            <div key={group.disposition}>
              <div className="mb-2">
                <h3 className="text-sm font-semibold">{group.title}</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">{group.hint}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {options.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => choose(value)}
                    aria-pressed={outcome === value}
                    className={cn(
                      'min-h-[3rem] rounded-lg border px-3 py-3 text-start text-sm transition',
                      outcome === value
                        ? 'border-primary bg-primary/10 font-semibold text-primary ring-1 ring-primary'
                        : 'border-border hover:border-primary/40 hover:bg-muted/50',
                    )}
                  >
                    {outcomeLabel(value)}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {outcome && (
          <Card className="space-y-4 p-4 shadow-none">
            <div>
              <Label htmlFor="visit-note">
                ملاحظة
                {requiresNote(outcome) && <span className="text-destructive"> (مطلوبة)</span>}
              </Label>
              <Textarea
                id="visit-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                rows={3}
                placeholder="ما يخصّ الزيارة فقط"
              />
              {/*
                Said plainly rather than buried in a policy document. The people
                typing here are the ones who decide what ends up in the record,
                and a note about the household rather than the visit is the
                thing this feature could most easily get wrong.
              */}
              <p className="mt-1 text-xs text-muted-foreground">
                لا تُدوَّن هنا معلومات عن الأسرة أو آراء شخصية — فقط ما يوضّح سبب عدم اكتمال
                الزيارة.
              </p>
            </div>

            {/*
              Only where a return date means something. Rendering it for
              COMPLETED or DEMOLISHED invites a value that then has to be
              ignored — and the version that did not ignore it is why finished
              households kept reappearing as due.
            */}
            {takesReturnDate(outcome) && disposition !== 'CLOSED' && disposition !== 'DONE' && (
              <div>
                <Label htmlFor="next-visit">موعد الزيارة القادمة</Label>
                <Input
                  id="next-visit"
                  type="date"
                  value={nextVisitAt}
                  onChange={(event) => setNextVisitAt(event.target.value)}
                />
              </div>
            )}

            {needsProxy && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="proxy-name">من يمكنه تقديم البيانات</Label>
                  <Input
                    id="proxy-name"
                    value={proxyName}
                    onChange={(event) => setProxyName(event.target.value)}
                    placeholder="قريب، وكيل، حارس"
                  />
                </div>
                <div>
                  <Label htmlFor="proxy-phone">رقم هاتفه</Label>
                  <Input
                    id="proxy-phone"
                    value={proxyPhone}
                    onChange={(event) => setProxyPhone(event.target.value)}
                    dir="ltr"
                    placeholder="+961 أو رقم دولي"
                  />
                </div>
              </div>
            )}

            {captureLocation && (
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={takeLocation}>
                  <MapPin className="size-4" aria-hidden />
                  {coords ? 'تم تسجيل الموقع' : 'تسجيل الموقع الحالي'}
                </Button>
                {coords && (
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {coords.lat.toFixed(5)}, {coords.lon.toFixed(5)}
                  </span>
                )}
              </div>
            )}
          </Card>
        )}

        {error && (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
      </div>

    </Sheet>
  );
}
