'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, MapPin } from 'lucide-react';
import { ar, PROPERTY_FIELD_MAP } from '@mechanization/shared-schemas';
import type { LandType, OccupancyType, PropertyType, UnitType } from '@mechanization/shared-schemas';
import { checkPropertyNumber, type PropertyNumberCheck } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChoiceCard, Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';

export interface PropertyDraft {
  occupancyType?: OccupancyType;
  landlordName?: string;
  landlordPhone?: string;
  propertyType?: PropertyType;
  propertyNumber?: string;
  unitType?: UnitType;
  landType?: LandType;
  buildingName?: string;
  floor?: string;
  side?: string;
  tentLocation?: string;
  unitArea?: string;
  sharedRights?: string[];
}

/** Long enough that a slow typist is not queried mid-number. */
const CHECK_DEBOUNCE_MS = 500;

/**
 * One property card. Which fields render is read from PROPERTY_FIELD_MAP in the
 * shared package rather than re-derived here, so the form and the server-side
 * validator can never disagree about what a "land" entry requires.
 */
export function PropertyCard({
  tenant,
  index,
  draft,
  onChange,
  onRemove,
  canRemove,
}: {
  tenant: string;
  index: number;
  draft: PropertyDraft;
  onChange: (next: PropertyDraft) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const visible: readonly string[] = draft.propertyType
    ? PROPERTY_FIELD_MAP[draft.propertyType]
    : [];

  const set = (patch: Partial<PropertyDraft>) => onChange({ ...draft, ...patch });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 border-b">
        <CardTitle className="text-xl">العقار {index + 1}</CardTitle>
        {canRemove ? (
          <Button
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              if (confirm('هل أنت متأكد من حذف هذا العقار؟')) onRemove();
            }}
          >
            حذف
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-6 pt-6">
        <Field label="نوع الإشغال" htmlFor={`occ-${index}`} required>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['OWNER', 'TENANT'] as const).map((option) => (
              <ChoiceCard
                key={option}
                name={`occupancy-${index}`}
                value={option}
                checked={draft.occupancyType === option}
                onChange={(v) => set({ occupancyType: v as OccupancyType })}
                title={ar.occupancyType[option]}
                description={option === 'OWNER' ? 'العقار مسجّل باسمك' : 'تستأجر من مالك آخر'}
              />
            ))}
          </div>
        </Field>

        {draft.occupancyType === 'TENANT' ? (
          <div className="grid gap-5 border-s-2 border-primary/20 ps-4 sm:grid-cols-2">
            <Field label="اسم المالك" htmlFor={`ln-${index}`} required>
              <Input
                id={`ln-${index}`}
                value={draft.landlordName ?? ''}
                onChange={(e) => set({ landlordName: e.target.value })}
              />
            </Field>
            <Field label="رقم هاتف المالك" htmlFor={`lp-${index}`} required>
              <Input
                id={`lp-${index}`}
                type="tel"
                inputMode="tel"
                dir="ltr"
                value={draft.landlordPhone ?? ''}
                onChange={(e) => set({ landlordPhone: e.target.value })}
              />
            </Field>
          </div>
        ) : null}

        <Field label="نوع العقار" htmlFor={`pt-${index}`} required>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['BUILDING', 'HOUSE', 'LAND', 'TENT'] as const).map((option) => (
              <ChoiceCard
                key={option}
                name={`propertyType-${index}`}
                value={option}
                checked={draft.propertyType === option}
                onChange={(v) => set({ propertyType: v as PropertyType })}
                title={ar.propertyType[option]}
              />
            ))}
          </div>
        </Field>

        {visible.includes('propertyNumber') ? (
          <PropertyNumberField
            tenant={tenant}
            index={index}
            value={draft.propertyNumber ?? ''}
            onChange={(propertyNumber) => set({ propertyNumber })}
          />
        ) : null}

        {visible.includes('unitType') ? (
          <Field label="نوع الوحدة" htmlFor={`ut-${index}`} required>
            <Select
              id={`ut-${index}`}
              value={draft.unitType ?? ''}
              onChange={(e) => set({ unitType: e.target.value as UnitType })}
            >
              <option value="">اختر…</option>
              {(['APARTMENT', 'CLINIC', 'SHOP'] as const).map((o) => (
                <option key={o} value={o}>
                  {ar.unitType[o]}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {visible.includes('landType') ? (
          <Field label="نوع الأرض" htmlFor={`lt-${index}`} required>
            <Select
              id={`lt-${index}`}
              value={draft.landType ?? ''}
              onChange={(e) => set({ landType: e.target.value as LandType })}
            >
              <option value="">اختر…</option>
              {(['AGRICULTURAL', 'INDUSTRIAL'] as const).map((o) => (
                <option key={o} value={o}>
                  {ar.landType[o]}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {visible.includes('buildingName') ? (
          <Field label="اسم المبنى" htmlFor={`bn-${index}`} required>
            <Input
              id={`bn-${index}`}
              value={draft.buildingName ?? ''}
              onChange={(e) => set({ buildingName: e.target.value })}
            />
          </Field>
        ) : null}

        {visible.includes('floor') ? (
          <Field label="الطابق" htmlFor={`fl-${index}`} required>
            <Input
              id={`fl-${index}`}
              value={draft.floor ?? ''}
              onChange={(e) => set({ floor: e.target.value })}
            />
          </Field>
        ) : null}

        {visible.includes('side') ? (
          <Field label="الجهة" htmlFor={`sd-${index}`} hint="مثال: شمالي، جنوبي">
            <Input
              id={`sd-${index}`}
              value={draft.side ?? ''}
              onChange={(e) => set({ side: e.target.value })}
            />
          </Field>
        ) : null}

        {visible.includes('tentLocation') ? (
          <Field
            label="وصف موقع الخيمة"
            htmlFor={`tl-${index}`}
            required
            hint="مثال: المخيم الشمالي — قطعة ٤"
          >
            <Input
              id={`tl-${index}`}
              value={draft.tentLocation ?? ''}
              onChange={(e) => set({ tentLocation: e.target.value })}
            />
          </Field>
        ) : null}

        {visible.includes('unitArea') ? (
          <Field label="مساحة الوحدة (متر مربع)" htmlFor={`ua-${index}`} required>
            <Input
              id={`ua-${index}`}
              inputMode="decimal"
              value={draft.unitArea ?? ''}
              onChange={(e) => set({ unitArea: e.target.value })}
            />
          </Field>
        ) : null}

        {visible.includes('sharedRights') ? (
          <Field label="حقوق مشتركة" htmlFor={`sr-${index}`} hint="حدد ما ينطبق">
            <div className="space-y-1">
              {['موقف سيارات', 'مدخل مشترك', 'سطح مشترك', 'حديقة مشتركة'].map((right) => {
                const selected = draft.sharedRights?.includes(right) ?? false;
                return (
                  <label key={right} className="flex min-h-touch items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-[hsl(var(--primary))]"
                      checked={selected}
                      onChange={() =>
                        set({
                          sharedRights: selected
                            ? (draft.sharedRights ?? []).filter((r) => r !== right)
                            : [...(draft.sharedRights ?? []), right],
                        })
                      }
                    />
                    <span>{right}</span>
                  </label>
                );
              })}
            </div>
          </Field>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * رقم العقار, checked against the municipality's cadastre as the citizen types.
 *
 * This field carries more weight than it used to. It is now the *only* thing
 * that locates the property — the wizard no longer asks anyone to drop a pin —
 * so a wrong number is no longer a cosmetic error that a clerk fixes later, and
 * it has to be caught here, while the person who knows the answer is still on
 * the page. When it fails, the nearest real parcel numbers are offered as
 * one-tap corrections rather than leaving them to guess again.
 */
function PropertyNumberField({
  tenant,
  index,
  value,
  onChange,
}: {
  tenant: string;
  index: number;
  value: string;
  onChange: (value: string) => void;
}) {
  const [result, setResult] = useState<PropertyNumberCheck | null>(null);
  const [checking, setChecking] = useState(false);

  // Guards against an earlier, slower response overwriting a later one — the
  // classic way a debounced lookup ends up showing the wrong answer.
  const requestId = useRef(0);

  const verify = useCallback(
    async (candidate: string) => {
      const id = ++requestId.current;
      setChecking(true);
      try {
        const next = await checkPropertyNumber(tenant, candidate);
        if (id === requestId.current) setResult(next);
      } catch {
        // Never block a submission on a failed check: the server validates the
        // same rule again, and a citizen on a dropping connection must still be
        // able to finish.
        if (id === requestId.current) setResult(null);
      } finally {
        if (id === requestId.current) setChecking(false);
      }
    },
    [tenant],
  );

  useEffect(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      requestId.current += 1;
      setResult(null);
      setChecking(false);
      return;
    }

    const timer = setTimeout(() => void verify(trimmed), CHECK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, verify]);

  const stale = result !== null && result.propertyNumber !== value.trim();
  const settled = result !== null && !stale && !checking;

  const taken = settled && !result.available;
  const unknown = settled && result.inCadastre === false;
  const confirmed = settled && result.inCadastre !== false && result.available;

  const error = taken
    ? 'رقم العقار مسجّل مسبقاً في هذه البلدية'
    : unknown
      ? 'هذا الرقم غير موجود في السجل العقاري للبلدية. تأكّد من الرقم المدوّن على سند الملكية.'
      : undefined;

  return (
    <Field
      label="رقم العقار"
      htmlFor={`pn-${index}`}
      required
      hint="كما هو مدوّن على سند الملكية. يتم التحقق منه تلقائياً في سجل البلدية."
      error={error}
    >
      <Input
        id={`pn-${index}`}
        inputMode="numeric"
        dir="ltr"
        className="text-start"
        invalid={taken || unknown}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />

      {checking ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          جارٍ التحقق…
        </p>
      ) : null}

      {confirmed ? (
        <p className="flex items-center gap-2 text-sm font-medium text-success">
          <CheckCircle2 className="size-4" aria-hidden />
          {result.location
            ? 'رقم صحيح — تم تحديد موقع العقار على خريطة البلدية'
            : 'الرقم متاح'}
        </p>
      ) : null}

      {/**
       * The survey drew this parcel as more than one piece, so the point the
       * municipality will see is a centroid rather than the parcel itself.
       * Said plainly here rather than hidden, because staff will notice.
       */}
      {confirmed && result.location?.approximate ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="size-4" aria-hidden />
          هذا العقار مقسّم إلى أكثر من قطعة — الموقع تقريبي.
        </p>
      ) : null}

      {unknown && result.suggestions.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">أرقام قريبة موجودة في السجل:</p>
          <div className="flex flex-wrap gap-2">
            {result.suggestions.map((suggestion) => (
              <Button
                key={suggestion}
                variant="outline"
                size="sm"
                dir="ltr"
                onClick={() => onChange(suggestion)}
              >
                {suggestion}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </Field>
  );
}
