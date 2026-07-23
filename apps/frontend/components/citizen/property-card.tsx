'use client';

import { useState } from 'react';
import { ar, PROPERTY_FIELD_MAP } from '@mechanization/shared-schemas';
import type { LandType, OccupancyType, PropertyType, UnitType } from '@mechanization/shared-schemas';
import { checkPropertyNumber } from '@/lib/api-client';
import { ChoiceCard, Field, inputClass } from '@/components/ui/field';

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
  const [numberStatus, setNumberStatus] = useState<'idle' | 'checking' | 'taken' | 'free'>('idle');
  const visible: readonly string[] = draft.propertyType
    ? PROPERTY_FIELD_MAP[draft.propertyType]
    : [];

  const set = (patch: Partial<PropertyDraft>) => onChange({ ...draft, ...patch });

  /** Blur-check, not keystroke-check: fewer requests and no jitter while typing. */
  const verifyNumber = async (value: string) => {
    if (!value.trim()) return setNumberStatus('idle');
    setNumberStatus('checking');
    try {
      const result = await checkPropertyNumber(tenant, value);
      setNumberStatus(result.available ? 'free' : 'taken');
    } catch {
      setNumberStatus('idle'); // Never block submission on a failed check.
    }
  };

  return (
    <section className="space-y-6 rounded-card border-2 border-rule bg-card p-5">
      <header className="flex items-center justify-between gap-4 border-b border-rule pb-3">
        <h3 className="font-display text-lg font-bold">العقار {index + 1}</h3>
        {canRemove ? (
          <button
            type="button"
            onClick={() => {
              if (confirm('هل أنت متأكد من حذف هذا العقار؟')) onRemove();
            }}
            className="min-h-touch px-3 text-seal underline"
          >
            حذف
          </button>
        ) : null}
      </header>

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
        <div className="grid gap-5 border-s-4 border-cedar-soft ps-4 sm:grid-cols-2">
          <Field label="اسم المالك" htmlFor={`ln-${index}`} required>
            <input
              id={`ln-${index}`}
              className={inputClass()}
              value={draft.landlordName ?? ''}
              onChange={(e) => set({ landlordName: e.target.value })}
            />
          </Field>
          <Field label="رقم هاتف المالك" htmlFor={`lp-${index}`} required>
            <input
              id={`lp-${index}`}
              type="tel"
              inputMode="tel"
              dir="ltr"
              className={inputClass()}
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
        <Field
          label="رقم العقار"
          htmlFor={`pn-${index}`}
          required
          hint="يتم التحقق تلقائياً بعد الانتهاء من الكتابة"
          error={numberStatus === 'taken' ? 'رقم العقار مسجّل مسبقاً في هذه البلدية' : undefined}
        >
          <input
            id={`pn-${index}`}
            inputMode="numeric"
            className={inputClass(numberStatus === 'taken')}
            value={draft.propertyNumber ?? ''}
            onChange={(e) => set({ propertyNumber: e.target.value })}
            onBlur={(e) => verifyNumber(e.target.value)}
          />
          {numberStatus === 'checking' ? (
            <p className="text-sm text-muted">جارٍ التحقق…</p>
          ) : null}
          {numberStatus === 'free' ? (
            <p className="text-sm text-cedar">الرقم متاح</p>
          ) : null}
        </Field>
      ) : null}

      {visible.includes('unitType') ? (
        <Field label="نوع الوحدة" htmlFor={`ut-${index}`} required>
          <select
            id={`ut-${index}`}
            className={inputClass()}
            value={draft.unitType ?? ''}
            onChange={(e) => set({ unitType: e.target.value as UnitType })}
          >
            <option value="">اختر…</option>
            {(['APARTMENT', 'CLINIC', 'SHOP'] as const).map((o) => (
              <option key={o} value={o}>{ar.unitType[o]}</option>
            ))}
          </select>
        </Field>
      ) : null}

      {visible.includes('landType') ? (
        <Field label="نوع الأرض" htmlFor={`lt-${index}`} required>
          <select
            id={`lt-${index}`}
            className={inputClass()}
            value={draft.landType ?? ''}
            onChange={(e) => set({ landType: e.target.value as LandType })}
          >
            <option value="">اختر…</option>
            {(['AGRICULTURAL', 'INDUSTRIAL'] as const).map((o) => (
              <option key={o} value={o}>{ar.landType[o]}</option>
            ))}
          </select>
        </Field>
      ) : null}

      {visible.includes('buildingName') ? (
        <Field label="اسم المبنى" htmlFor={`bn-${index}`} required>
          <input
            id={`bn-${index}`}
            className={inputClass()}
            value={draft.buildingName ?? ''}
            onChange={(e) => set({ buildingName: e.target.value })}
          />
        </Field>
      ) : null}

      {visible.includes('floor') ? (
        <Field label="الطابق" htmlFor={`fl-${index}`} required>
          <input
            id={`fl-${index}`}
            className={inputClass()}
            value={draft.floor ?? ''}
            onChange={(e) => set({ floor: e.target.value })}
          />
        </Field>
      ) : null}

      {visible.includes('side') ? (
        <Field label="الجهة" htmlFor={`sd-${index}`} hint="مثال: شمالي، جنوبي">
          <input
            id={`sd-${index}`}
            className={inputClass()}
            value={draft.side ?? ''}
            onChange={(e) => set({ side: e.target.value })}
          />
        </Field>
      ) : null}

      {visible.includes('tentLocation') ? (
        <Field label="موقع الخيمة" htmlFor={`tl-${index}`} required hint="مثال: المخيم الشمالي — قطعة ٤">
          <input
            id={`tl-${index}`}
            className={inputClass()}
            value={draft.tentLocation ?? ''}
            onChange={(e) => set({ tentLocation: e.target.value })}
          />
        </Field>
      ) : null}

      {visible.includes('unitArea') ? (
        <Field label="مساحة الوحدة (متر مربع)" htmlFor={`ua-${index}`} required>
          <input
            id={`ua-${index}`}
            inputMode="decimal"
            className={inputClass()}
            value={draft.unitArea ?? ''}
            onChange={(e) => set({ unitArea: e.target.value })}
          />
        </Field>
      ) : null}

      {visible.includes('sharedRights') ? (
        <Field label="حقوق مشتركة" htmlFor={`sr-${index}`} hint="حدد ما ينطبق">
          <div className="space-y-2">
            {['موقف سيارات', 'مدخل مشترك', 'سطح مشترك', 'حديقة مشتركة'].map((right) => {
              const selected = draft.sharedRights?.includes(right) ?? false;
              return (
                <label key={right} className="flex min-h-touch items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-6 w-6 accent-[var(--cedar)]"
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
    </section>
  );
}
