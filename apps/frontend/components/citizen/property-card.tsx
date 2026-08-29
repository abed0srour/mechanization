'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Loader2, MapPin, Plus, Trash2, Users } from 'lucide-react';
import { ar, PROPERTY_FIELD_MAP } from '@mechanization/shared-schemas';
import type { LandType, OccupancyType, PropertyType, UnitType } from '@mechanization/shared-schemas';
import { checkPropertyNumber, type PropertyNumberCheck } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { ChoiceCard, Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn, scopeErrors } from '@/lib/utils';

/** One unit inside a building — شقة, عيادة or محل. */
export interface UnitDraft {
  unitType?: UnitType;
  floor?: string;
  side?: string;
  unitArea?: string;
  sharedRights?: string[];
}

export interface PropertyDraft {
  /**
   * The stored row this card is editing, when there is one.
   *
   * Never set by the citizen wizard — a submission has nothing to identify
   * yet. The staff editor sets it so an edited card updates its own row
   * instead of being deleted and recreated, which would take the deed attached
   * to it (`Document.propertyEntryId` cascades) down with it.
   */
  id?: string;
  occupancyType?: OccupancyType;
  landlordName?: string;
  landlordPhone?: string;
  propertyType?: PropertyType;
  neighborhood?: string;
  propertyNumber?: string;
  landType?: LandType;
  buildingName?: string;
  side?: string;
  tentLocation?: string;
  unitArea?: string;
  sharedRights?: string[];
  /** BUILDING only. Every other type is a single unit described inline. */
  units?: UnitDraft[];
}

/** Long enough that a slow typist is not queried mid-number. */
const CHECK_DEBOUNCE_MS = 500;

const SHARED_RIGHTS = ['موقف سيارات', 'مدخل مشترك', 'سطح مشترك', 'حديقة مشتركة'];

/**
 * One property card. Which fields render is read from PROPERTY_FIELD_MAP in the
 * shared package rather than re-derived here, so the form and the server-side
 * validator can never disagree about what a "land" entry requires.
 *
 * Field order is deliberate and not the schema's: رقم العقار comes first because
 * it is the one answer that identifies the property, it is the only field
 * checked against the cadastre while typing, and a citizen who gets it wrong
 * should find that out before filling in anything else.
 */
export function PropertyCard({
  tenant,
  index,
  draft,
  allowedTypes,
  collapsed,
  onToggleCollapse,
  onChange,
  onRemove,
  canRemove,
  errors = {},
}: {
  tenant: string;
  index: number;
  draft: PropertyDraft;
  allowedTypes: readonly PropertyType[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onChange: (next: PropertyDraft) => void;
  onRemove: () => void;
  canRemove: boolean;
  /** Keyed by bare field name — the caller has already stripped `properties.N.`. */
  errors?: Record<string, string>;
}) {
  const visible: readonly string[] = draft.propertyType
    ? PROPERTY_FIELD_MAP[draft.propertyType]
    : [];

  const set = (patch: Partial<PropertyDraft>) => onChange({ ...draft, ...patch });

  /*
   * Removal is confirmed in a dialog rather than `confirm()`. A property card
   * can hold twenty filled fields and a set of units, and the browser's prompt
   * says only "OK / Cancel" over an RTL form — it neither names which of
   * several cards is about to go nor how much is in it.
   */
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const isBuilding = draft.propertyType === 'BUILDING';
  const units = draft.units ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 gap-2 border-b">
        {/**
         * The whole header is the collapse toggle, not a small chevron — on a
         * phone this is the control a citizen with several properties uses most.
         */}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          className="-m-2 flex min-w-0 flex-1 items-center gap-3 rounded-md p-2 text-start transition-colors hover:bg-accent"
        >
          <ChevronDown
            className={cn(
              'size-5 shrink-0 text-muted-foreground transition-transform',
              collapsed && '-rotate-90 rtl:rotate-90',
            )}
            aria-hidden
          />
          <span className="min-w-0">
            <CardTitle className="text-xl">العقار {index + 1}</CardTitle>
            {collapsed ? (
              <span className="mt-1 block truncate text-sm font-normal text-muted-foreground">
                {summarise(draft)}
              </span>
            ) : null}
          </span>
        </button>

        {canRemove ? (
          <Button
            variant="ghost"
            className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirmingRemove(true)}
          >
            حذف
          </Button>
        ) : null}
      </CardHeader>

      {collapsed ? null : (
        <CardContent className="space-y-6 pt-6">
          {/* الحي comes first: it is the plain-language answer ("which part of
              town"), before رقم العقار asks for the one checked against the
              cadastre. */}
          <Field
            label="الحي"
            htmlFor={`nb-${index}`}
            required
            error={errors.neighborhood}
          >
            <Input
              id={`nb-${index}`}
              invalid={Boolean(errors.neighborhood)}
              value={draft.neighborhood ?? ''}
              onChange={(e) => set({ neighborhood: e.target.value })}
            />
          </Field>

          {/* رقم العقار leads the rest: it locates the property and it is the
              only answer verified against the cadastre as it is typed. */}
          <PropertyNumberField
            tenant={tenant}
            index={index}
            value={draft.propertyNumber ?? ''}
            onChange={(propertyNumber) => set({ propertyNumber })}
          />

          <Field
            label="نوع الإشغال"
            htmlFor={`occ-${index}`}
            required
            error={errors.occupancyType}
          >
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
              <Field
                label="اسم المالك"
                htmlFor={`ln-${index}`}
                required
                error={errors.landlordName}
              >
                <Input
                  id={`ln-${index}`}
                  invalid={Boolean(errors.landlordName)}
                  value={draft.landlordName ?? ''}
                  onChange={(e) => set({ landlordName: e.target.value })}
                />
              </Field>
              <Field
                label="رقم هاتف المالك"
                htmlFor={`lp-${index}`}
                required
                error={errors.landlordPhone}
              >
                <Input
                  id={`lp-${index}`}
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  invalid={Boolean(errors.landlordPhone)}
                  value={draft.landlordPhone ?? ''}
                  onChange={(e) => set({ landlordPhone: e.target.value })}
                />
              </Field>
            </div>
          ) : null}

          <Field
            label="نوع العقار"
            htmlFor={`pt-${index}`}
            required
            error={errors.propertyType}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {allowedTypes.map((option) => (
                <ChoiceCard
                  key={option}
                  name={`propertyType-${index}`}
                  value={option}
                  checked={draft.propertyType === option}
                  // Replaces the draft rather than merging into it — `set`
                  // would spread the new shape over the old one and leave the
                  // discarded fields behind, which is the whole thing
                  // changePropertyType exists to prevent.
                  onChange={(v) => onChange(changePropertyType(draft, v as PropertyType))}
                  title={ar.propertyType[option]}
                />
              ))}
            </div>
          </Field>

          {/* اسم المبنى sits directly under the type: it is what a citizen
              names the place, and it frames every field that follows. */}
          {visible.includes('buildingName') ? (
            <Field
              label={isBuilding ? 'اسم المبنى' : 'اسم المبنى/المنزل'}
              htmlFor={`bn-${index}`}
              required
              error={errors.buildingName}
            >
              <Input
                id={`bn-${index}`}
                invalid={Boolean(errors.buildingName)}
                value={draft.buildingName ?? ''}
                onChange={(e) => set({ buildingName: e.target.value })}
              />
            </Field>
          ) : null}

          {visible.includes('landType') ? (
            <Field label="نوع الأرض" htmlFor={`lt-${index}`} required error={errors.landType}>
              <Select
                value={draft.landType ?? ''}
                onValueChange={(next) => set({ landType: next as LandType })}
              >
                <SelectTrigger id={`lt-${index}`}>
                  <SelectValue placeholder="اختر…" />
                </SelectTrigger>
                <SelectContent>
                  {(['AGRICULTURAL', 'INDUSTRIAL'] as const).map((o) => (
                    <SelectItem key={o} value={o}>
                      {ar.landType[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              error={errors.tentLocation}
            >
              <Input
                id={`tl-${index}`}
                invalid={Boolean(errors.tentLocation)}
                value={draft.tentLocation ?? ''}
                onChange={(e) => set({ tentLocation: e.target.value })}
              />
            </Field>
          ) : null}

          {visible.includes('unitArea') ? (
            <Field
              label="مساحة الوحدة (متر مربع)"
              htmlFor={`ua-${index}`}
              required
              error={errors.unitArea}
            >
              <Input
                id={`ua-${index}`}
                inputMode="decimal"
                invalid={Boolean(errors.unitArea)}
                value={draft.unitArea ?? ''}
                onChange={(e) => set({ unitArea: e.target.value })}
              />
            </Field>
          ) : null}

          {visible.includes('sharedRights') ? (
            <SharedRightsField
              idPrefix={`sr-${index}`}
              selected={draft.sharedRights ?? []}
              onChange={(sharedRights) => set({ sharedRights })}
            />
          ) : null}

          {visible.includes('units') ? (
            <UnitsEditor
              index={index}
              units={units}
              errors={scopeErrors(errors, 'units')}
              onChange={(next) => set({ units: next })}
            />
          ) : null}
        </CardContent>
      )}

      <ConfirmDialog
        open={confirmingRemove}
        onOpenChange={setConfirmingRemove}
        title={`حذف العقار ${index + 1}؟`}
        description={
          <>
            سيُحذف هذا العقار من النموذج بكل ما أُدخل فيه
            {units.length > 0 ? ` و${units.length} وحدة داخله` : ''}. لن يُحفظ شيء حتى تُرسل
            النموذج، فيمكنك إضافته من جديد.
          </>
        }
        confirmLabel="حذف العقار"
        onConfirm={() => {
          setConfirmingRemove(false);
          onRemove();
        }}
      />
    </Card>
  );
}

/**
 * Switching type has to clear the fields that belonged to the old one.
 *
 * Left behind, they reach the server inside a payload the schema no longer
 * expects — a land entry still carrying a floor is rejected outright by
 * `assertTaxonomyConsistent`, and the citizen sees an error about a field the
 * form has already stopped showing them.
 */
function changePropertyType(draft: PropertyDraft, propertyType: PropertyType): PropertyDraft {
  const keep: PropertyDraft = {
    // Identity survives a type change: this is still the same عقار, filed
    // under the wrong branch until now. Dropping it here would silently turn
    // the staff editor's update into a delete-and-recreate.
    id: draft.id,
    occupancyType: draft.occupancyType,
    landlordName: draft.landlordName,
    landlordPhone: draft.landlordPhone,
    neighborhood: draft.neighborhood,
    propertyNumber: draft.propertyNumber,
    propertyType,
  };

  // A building always opens with one empty unit — an empty units list would
  // otherwise show the citizen a heading and nothing to fill in.
  if (propertyType === 'BUILDING') {
    keep.buildingName = draft.buildingName;
    keep.units = draft.units?.length ? draft.units : [{}];
  }
  if (propertyType === 'HOUSE') {
    keep.buildingName = draft.buildingName;
    keep.side = draft.side;
    keep.unitArea = draft.unitArea;
    keep.sharedRights = draft.sharedRights;
  }
  if (propertyType === 'LAND') {
    keep.landType = draft.landType;
    keep.unitArea = draft.unitArea;
  }
  if (propertyType === 'TENT') {
    keep.tentLocation = draft.tentLocation;
  }

  return keep;
}

/** Collapsed-card summary: enough to tell two properties apart at a glance. */
function summarise(draft: PropertyDraft): string {
  const parts = [
    draft.propertyType ? ar.propertyType[draft.propertyType] : 'لم يُحدَّد النوع',
    draft.neighborhood || null,
    draft.propertyNumber ? `رقم ${draft.propertyNumber}` : null,
    draft.buildingName || null,
    draft.propertyType === 'BUILDING' && draft.units?.length
      ? `${draft.units.length} وحدة`
      : null,
  ];
  return parts.filter(Boolean).join(' — ');
}

function SharedRightsField({
  idPrefix,
  selected,
  onChange,
}: {
  idPrefix: string;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <Field label="حقوق مشتركة" htmlFor={idPrefix} hint="حدد ما ينطبق">
      <div className="space-y-1">
        {SHARED_RIGHTS.map((right, rightIndex) => {
          const checked = selected.includes(right);
          const id = `${idPrefix}-${rightIndex}`;
          return (
            <div key={right} className="flex min-h-touch items-center gap-3">
              <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={() =>
                  onChange(
                    checked ? selected.filter((r) => r !== right) : [...selected, right],
                  )
                }
              />
              <Label htmlFor={id}>{right}</Label>
            </div>
          );
        })}
      </div>
    </Field>
  );
}

/**
 * The units inside a building.
 *
 * A citizen who owns the whole building has one عقار — one رقم العقار, one
 * اسم المبنى — and several apartments or shops inside it. Filing that as one
 * property card per apartment is not possible: رقم العقار is unique per
 * municipality, so the second card would be rejected as a duplicate of the
 * first. The units therefore live inside the building rather than beside it.
 *
 * Collapsible for the same reason the property cards above it are: a citizen
 * filing a ten-unit building should not have to scroll past nine finished
 * units to reach the tenth, so adding one folds the rest shut — every unit
 * stays a tap away, because copying a floor's details from the one above it
 * is the usual reason to open an earlier one again.
 */
function UnitsEditor({
  index,
  units,
  errors,
  onChange,
}: {
  index: number;
  units: UnitDraft[];
  /** Keyed `"0.floor"` etc — the caller has stripped the `units.` prefix. */
  errors: Record<string, string>;
  onChange: (next: UnitDraft[]) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());

  const setUnit = (unitIndex: number, patch: Partial<UnitDraft>) =>
    onChange(units.map((u, i) => (i === unitIndex ? { ...u, ...patch } : u)));

  const toggleCollapsed = (unitIndex: number) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(unitIndex)) next.delete(unitIndex);
      else next.add(unitIndex);
      return next;
    });

  const addUnit = () => {
    // A new unit inherits the last one's type: a building is usually floor
    // after floor of the same thing.
    onChange([...units, { unitType: units.at(-1)?.unitType }]);
    setCollapsed(new Set(units.map((_, i) => i)));
  };

  const removeUnit = (unitIndex: number) => {
    onChange(units.filter((_, i) => i !== unitIndex));
    // Indices above the removed unit all shift down by one; rebuilding the
    // set rather than deleting from it keeps the wrong unit folding shut.
    setCollapsed((current) => {
      const next = new Set<number>();
      for (const i of current) {
        if (i < unitIndex) next.add(i);
        else if (i > unitIndex) next.add(i - 1);
      }
      return next;
    });
  };

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h3 className="text-lg font-semibold">وحدات المبنى</h3>
        <p className="text-sm text-muted-foreground">
          إذا كنت تملك المبنى بالكامل، أضف كل وحدة فيه على حدة. رقم العقار واسم المبنى
          يبقيان كما هما لجميع الوحدات.
        </p>
      </header>

      {units.map((unit, unitIndex) => {
        const unitCollapsed = collapsed.has(unitIndex);
        const unitErrors = scopeErrors(errors, String(unitIndex));

        return (
          <div
            key={unitIndex}
            className="space-y-5 rounded-lg border border-s-2 border-s-primary/40 bg-muted/20 p-4"
          >
            <div className="flex items-center justify-between gap-2">
              {/* The whole header toggles, matching the property card above it. */}
              <button
                type="button"
                onClick={() => toggleCollapsed(unitIndex)}
                aria-expanded={!unitCollapsed}
                className="-m-2 flex min-w-0 flex-1 items-center gap-2 rounded-md p-2 text-start transition-colors hover:bg-accent"
              >
                <ChevronDown
                  className={cn(
                    'size-4 shrink-0 text-muted-foreground transition-transform',
                    unitCollapsed && '-rotate-90 rtl:rotate-90',
                  )}
                  aria-hidden
                />
                <span className="min-w-0">
                  <h4 className="font-semibold">الوحدة {unitIndex + 1}</h4>
                  {unitCollapsed ? (
                    <span className="mt-0.5 block truncate text-sm font-normal text-muted-foreground">
                      {summariseUnit(unit)}
                    </span>
                  ) : null}
                </span>
              </button>

              {units.length > 1 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => removeUnit(unitIndex)}
                >
                  <Trash2 className="size-4" aria-hidden />
                  حذف
                </Button>
              ) : null}
            </div>

            {unitCollapsed ? null : (
              <>
                <Field
                  label="نوع الوحدة"
                  htmlFor={`ut-${index}-${unitIndex}`}
                  required
                  error={unitErrors.unitType}
                >
                  <Select
                    value={unit.unitType ?? ''}
                    onValueChange={(next) => setUnit(unitIndex, { unitType: next as UnitType })}
                  >
                    <SelectTrigger id={`ut-${index}-${unitIndex}`}>
                      <SelectValue placeholder="اختر…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(['APARTMENT', 'CLINIC', 'SHOP'] as const).map((o) => (
                        <SelectItem key={o} value={o}>
                          {ar.unitType[o]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    label="الطابق"
                    htmlFor={`fl-${index}-${unitIndex}`}
                    required
                    error={unitErrors.floor}
                  >
                    <Input
                      id={`fl-${index}-${unitIndex}`}
                      invalid={Boolean(unitErrors.floor)}
                      value={unit.floor ?? ''}
                      onChange={(e) => setUnit(unitIndex, { floor: e.target.value })}
                    />
                  </Field>

                  <Field
                    label="مساحة الوحدة (متر مربع)"
                    htmlFor={`ua-${index}-${unitIndex}`}
                    required
                    error={unitErrors.unitArea}
                  >
                    <Input
                      id={`ua-${index}-${unitIndex}`}
                      inputMode="decimal"
                      invalid={Boolean(unitErrors.unitArea)}
                      value={unit.unitArea ?? ''}
                      onChange={(e) => setUnit(unitIndex, { unitArea: e.target.value })}
                    />
                  </Field>
                </div>

                <Field
                  label="الجهة"
                  htmlFor={`sd-${index}-${unitIndex}`}
                  hint="مثال: شمالي، جنوبي"
                >
                  <Input
                    id={`sd-${index}-${unitIndex}`}
                    value={unit.side ?? ''}
                    onChange={(e) => setUnit(unitIndex, { side: e.target.value })}
                  />
                </Field>

                <SharedRightsField
                  idPrefix={`sr-${index}-${unitIndex}`}
                  selected={unit.sharedRights ?? []}
                  onChange={(sharedRights) => setUnit(unitIndex, { sharedRights })}
                />
              </>
            )}
          </div>
        );
      })}

      <Button variant="outline" className="w-full border-dashed" onClick={addUnit}>
        <Plus className="size-4" aria-hidden />
        إضافة وحدة أخرى
      </Button>
    </section>
  );
}

/** Collapsed-unit summary: enough to tell two units apart at a glance. */
function summariseUnit(unit: UnitDraft): string {
  const parts = [
    unit.unitType ? ar.unitType[unit.unitType] : 'لم يُحدَّد النوع',
    unit.floor ? `طابق ${unit.floor}` : null,
    unit.unitArea ? `${unit.unitArea} م²` : null,
  ];
  return parts.filter(Boolean).join(' — ');
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

  const unknown = settled && result.inCadastre === false;
  const confirmed = settled && result.inCadastre !== false;

  /**
   * Neighbours already registered on this parcel. Not an error and not a
   * warning — an apartment building is a single cadastral number, so everyone
   * inside it enters the same one. This used to be a hard block, which told
   * the second resident of a building that their own address was taken.
   */
  const neighbours = settled ? result.registeredCount : 0;

  const error = unknown
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
        invalid={unknown}
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
            : 'رقم صحيح'}
        </p>
      ) : null}

      {/**
       * Stated as reassurance, in muted text rather than as a warning: someone
       * registering an apartment expects their neighbours to already be here,
       * and anything red would read as "you have done something wrong".
       */}
      {confirmed && neighbours > 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="size-4 shrink-0" aria-hidden />
          {neighbours === 1
            ? 'مسجّل شخص آخر على هذا العقار — هذا طبيعي في المباني المشتركة.'
            : `مسجّل ${neighbours} أشخاص آخرين على هذا العقار — هذا طبيعي في المباني المشتركة.`}
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
