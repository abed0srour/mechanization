'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, MapPin } from 'lucide-react';
import {
  OUTCOME_DISPOSITION,
  OUTCOME_REQUIRES_NOTE,
  ar,
  draftGaps,
  type FieldDraftPayload,
  type VisitDisposition,
  type VisitOutcome,
} from '@mechanization/shared-schemas';
import type { CachedParcel } from '@/lib/field-db';
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
 * The outcome list is grouped by disposition rather than shown flat, because
 * the grouping *is* the mental model: "I'll come back", "someone else has to
 * act", "this door is finished". Fifteen options in one list is a scroll on a
 * phone in the sun; three short groups is a glance.
 */

const GROUPS: Array<{ disposition: VisitDisposition; title: string; hint: string }> = [
  { disposition: 'DONE', title: 'منجز', hint: 'اكتمل التسجيل' },
  { disposition: 'RETRY', title: 'يحتاج زيارة أخرى', hint: 'سيعود إلى قائمتك' },
  {
    disposition: 'WAITING',
    title: 'بانتظار طرف آخر',
    hint: 'يحتاج وكيلاً أو مستنداً أو قراراً — لا تكفي زيارة أخرى',
  },
  {
    disposition: 'CLOSED',
    title: 'إغلاق نهائي',
    hint: 'يُرفع العقار من قائمة العمل نهائياً — يتطلب ملاحظة',
  },
];

/**
 * How long "come back later" means, per outcome.
 *
 * A seasonal resident is not worth a knock next Tuesday and a missing document
 * usually is. Defaults only — the worker can always change the date — but a
 * default that is roughly right is what stops the field turning into a wall of
 * nulls nobody schedules.
 */
const DEFAULT_RETURN_DAYS: Partial<Record<VisitOutcome, number>> = {
  NOBODY_HOME: 3,
  ACCESS_BLOCKED: 7,
  NOT_DECISION_MAKER: 3,
  PARTIAL: 7,
  DOCUMENTS_MISSING: 14,
  ABROAD: 30,
  ESTATE_UNSETTLED: 60,
  DISPUTED: 90,
  REFUSED: 30,
  SEASONAL: 180,
};

function defaultReturnDate(outcome: VisitOutcome): string {
  const days = DEFAULT_RETURN_DAYS[outcome];
  if (!days) return '';
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface VisitDraftResult {
  outcome: VisitOutcome;
  note?: string;
  nextVisitAt?: string;
  proxyName?: string;
  proxyPhone?: string;
  latitude?: number;
  longitude?: number;
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
  onOpenDraft: (parcel: CachedParcel) => void;
}) {
  const [outcome, setOutcome] = useState<VisitOutcome | null>(null);
  const [note, setNote] = useState('');
  const [nextVisitAt, setNextVisitAt] = useState('');
  const [proxyName, setProxyName] = useState('');
  const [proxyPhone, setProxyPhone] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const gaps = useMemo(() => {
    const payload = parcel?.draft?.payload as FieldDraftPayload | undefined;
    return payload ? draftGaps(payload) : [];
  }, [parcel]);
  const hasDraft = Boolean(parcel?.draft);
  const draftIsFilable = hasDraft && gaps.length === 0;

  function reset() {
    setOutcome(null);
    setNote('');
    setNextVisitAt('');
    setProxyName('');
    setProxyPhone('');
    setCoords(null);
    setError(null);
  }

  function choose(next: VisitOutcome) {
    setOutcome(next);
    setNextVisitAt(defaultReturnDate(next));
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
    if (OUTCOME_REQUIRES_NOTE.includes(outcome) && !note.trim()) {
      setError('هذه النتيجة تتطلب ملاحظة توضّح السبب');
      return;
    }
    // The server rejects this too; catching it here saves the worker finding out
    // at sync time, hours later, when they are nowhere near the door.
    if (outcome === 'PARTIAL' && !hasDraft) {
      setError('لم تُسجَّل أي بيانات — اختر «لا أحد في المنزل» أو سجّل ما حصلت عليه أولاً');
      return;
    }
    if (outcome === 'COMPLETED' && !draftIsFilable) {
      setError('البيانات غير مكتملة بعد — اختر «بيانات ناقصة»');
      return;
    }

    onSubmit({
      outcome,
      note: note.trim() || undefined,
      nextVisitAt: nextVisitAt || undefined,
      proxyName: proxyName.trim() || undefined,
      proxyPhone: proxyPhone.trim() || undefined,
      latitude: coords?.lat,
      longitude: coords?.lon,
    });
    reset();
  }

  if (!parcel) return null;

  const disposition = outcome ? OUTCOME_DISPOSITION[outcome] : null;
  const needsProxy =
    outcome === 'ABROAD' || outcome === 'ESTATE_UNSETTLED' || outcome === 'NOT_DECISION_MAKER';

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={`العقار ${parcel.parcelNumber}`}
      description={`القطاع ${parcel.zoneCode}${parcel.visitCount > 0 ? ` — ${parcel.visitCount} زيارة سابقة` : ''}`}
      footer={
        <div>
          <Button className="w-full" onClick={submit} disabled={!outcome}>
            حفظ الزيارة
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            يُحفظ على الجهاز فوراً ويُرسل عند توفّر الاتصال
          </p>
        </div>
      }
    >
      <div className="space-y-6">
        {/* What is still missing — the reason a second visit is worth making. */}
        {hasDraft && (
          <Card className="shadow-none">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-3">
                <Badge variant={draftIsFilable ? 'soft-success' : 'soft-warning'}>
                  {draftIsFilable ? 'البيانات مكتملة' : `ناقص ${gaps.length} حقلاً`}
                </Badge>
                <Button size="sm" variant="outline" onClick={() => onOpenDraft(parcel)}>
                  {draftIsFilable ? 'مراجعة' : 'استكمال'}
                </Button>
              </div>
              {gaps.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {gaps.slice(0, 6).map((gap) => (
                    <li key={gap.path}>• {gap.message}</li>
                  ))}
                  {gaps.length > 6 && <li>• و{gaps.length - 6} حقول أخرى…</li>}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {!hasDraft && (
          <Button variant="outline" className="w-full" onClick={() => onOpenDraft(parcel)}>
            تسجيل البيانات التي حصلت عليها
          </Button>
        )}

        {GROUPS.map((group) => {
          const options = (Object.keys(OUTCOME_DISPOSITION) as VisitOutcome[]).filter(
            (value) => OUTCOME_DISPOSITION[value] === group.disposition,
          );
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
                      // Generous tap target: used one-handed, outdoors, in sun.
                      'min-h-[3rem] rounded-lg border px-3 py-3 text-start text-sm transition',
                      outcome === value
                        ? 'border-primary bg-primary/10 font-semibold text-primary'
                        : 'border-border hover:border-primary/40 hover:bg-muted/50',
                    )}
                  >
                    {ar.visitOutcome[value]}
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
                {OUTCOME_REQUIRES_NOTE.includes(outcome) && (
                  <span className="text-destructive"> (مطلوبة)</span>
                )}
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

            {disposition !== 'CLOSED' && disposition !== 'DONE' && (
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
