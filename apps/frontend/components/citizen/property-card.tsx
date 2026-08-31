'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Loader2, MapPin, Plus, Trash2, Users } from 'lucide-react';
import { getLabels, PROPERTY_FIELD_MAP } from '@mechanization/shared-schemas';
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

export interface UnitDraft {
  unitType?: UnitType;
  floor?: string;
  side?: string;
  unitArea?: string;
  sharedRights?: string[];
}

export interface PropertyDraft {
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
  units?: UnitDraft[];
}

const CHECK_DEBOUNCE_MS = 500;

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
  locale = 'ar',
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
  errors?: Record<string, string>;
  locale?: string;
}) {
  const labels = getLabels(locale);
  const visible: readonly string[] = draft.propertyType
    ? PROPERTY_FIELD_MAP[draft.propertyType]
    : [];

  const set = (patch: Partial<PropertyDraft>) => onChange({ ...draft, ...patch });

  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const isBuilding = draft.propertyType === 'BUILDING';
  const units = draft.units ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 gap-2 border-b">
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
            <CardTitle className="text-xl">
              {locale === 'en' ? `Property ${index + 1}` : `العقار ${index + 1}`}
            </CardTitle>
            {collapsed ? (
              <span className="mt-1 block truncate text-sm font-normal text-muted-foreground">
                {summarise(draft, locale)}
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
            {locale === 'en' ? 'Delete' : 'حذف'}
          </Button>
        ) : null}
      </CardHeader>

      {collapsed ? null : (
        <CardContent className="space-y-6 pt-6">
          <Field
            label={locale === 'en' ? 'Neighborhood' : 'الحي'}
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

          <PropertyNumberField
            tenant={tenant}
            index={index}
            value={draft.propertyNumber ?? ''}
            onChange={(propertyNumber) => set({ propertyNumber })}
            locale={locale}
          />

          <Field
            label={locale === 'en' ? 'Occupancy Type' : 'نوع الإشغال'}
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
                  title={labels.occupancyType[option]}
                  description={
                    locale === 'en'
                      ? (option === 'OWNER' ? 'Property registered in your name' : 'Rented from another owner')
                      : (option === 'OWNER' ? 'العقار مسجّل باسمك' : 'تستأجر من مالك آخر')
                  }
                />
              ))}
            </div>
          </Field>

          {draft.occupancyType === 'TENANT' ? (
            <div className="grid gap-5 border-s-2 border-primary/20 ps-4 sm:grid-cols-2">
              <Field
                label={locale === 'en' ? 'Landlord Name' : 'اسم المالك'}
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
                label={locale === 'en' ? 'Landlord Phone' : 'رقم هاتف المالك'}
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
            label={locale === 'en' ? 'Property Type' : 'نوع العقار'}
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
                  onChange={(v) => onChange(changePropertyType(draft, v as PropertyType))}
                  title={labels.propertyType[option]}
                />
              ))}
            </div>
          </Field>

          {visible.includes('buildingName') ? (
            <Field
              label={
                isBuilding
                  ? (locale === 'en' ? 'Building Name' : 'اسم المبنى')
                  : (locale === 'en' ? 'Building / House Name' : 'اسم المبنى/المنزل')
              }
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
            <Field
              label={locale === 'en' ? 'Land Type' : 'نوع الأرض'}
              htmlFor={`lt-${index}`}
              required
              error={errors.landType}
            >
              <Select
                value={draft.landType ?? ''}
                onValueChange={(next) => set({ landType: next as LandType })}
              >
                <SelectTrigger id={`lt-${index}`}>
                  <SelectValue placeholder={locale === 'en' ? 'Select…' : 'اختر…'} />
                </SelectTrigger>
                <SelectContent>
                  {(['AGRICULTURAL', 'INDUSTRIAL'] as const).map((o) => (
                    <SelectItem key={o} value={o}>
                      {labels.landType[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {visible.includes('side') ? (
            <Field
              label={locale === 'en' ? 'Side / Orientation' : 'الجهة'}
              htmlFor={`sd-${index}`}
              hint={locale === 'en' ? 'e.g. North, South, East, West' : 'مثال: شمالي، جنوبي'}
            >
              <Input
                id={`sd-${index}`}
                value={draft.side ?? ''}
                onChange={(e) => set({ side: e.target.value })}
              />
            </Field>
          ) : null}

          {visible.includes('tentLocation') ? (
            <Field
              label={locale === 'en' ? 'Tent Location Description' : 'وصف موقع الخيمة'}
              htmlFor={`tl-${index}`}
              required
              hint={locale === 'en' ? 'e.g. North Camp — Plot 4' : 'مثال: المخيم الشمالي — قطعة ٤'}
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
              label={locale === 'en' ? 'Unit Area (sq. meters)' : 'مساحة الوحدة (متر مربع)'}
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
              locale={locale}
            />
          ) : null}

          {visible.includes('units') ? (
            <UnitsEditor
              index={index}
              units={units}
              errors={scopeErrors(errors, 'units')}
              onChange={(next) => set({ units: next })}
              locale={locale}
            />
          ) : null}
        </CardContent>
      )}

      <ConfirmDialog
        open={confirmingRemove}
        onOpenChange={setConfirmingRemove}
        title={locale === 'en' ? `Delete Property ${index + 1}?` : `حذف العقار ${index + 1}؟`}
        description={
          locale === 'en' ? (
            <>
              This property and all entered information
              {units.length > 0 ? ` and ${units.length} unit(s) inside it` : ''} will be removed from the form.
              Nothing is saved until you submit the form.
            </>
          ) : (
            <>
              سيُحذف هذا العقار من النموذج بكل ما أُدخل فيه
              {units.length > 0 ? ` و${units.length} وحدة داخله` : ''}. لن يُحفظ شيء حتى تُرسل
              النموذج، فيمكنك إضافته من جديد.
            </>
          )
        }
        confirmLabel={locale === 'en' ? 'Delete Property' : 'حذف العقار'}
        onConfirm={() => {
          setConfirmingRemove(false);
          onRemove();
        }}
      />
    </Card>
  );
}

function changePropertyType(draft: PropertyDraft, propertyType: PropertyType): PropertyDraft {
  const keep: PropertyDraft = {
    id: draft.id,
    occupancyType: draft.occupancyType,
    landlordName: draft.landlordName,
    landlordPhone: draft.landlordPhone,
    neighborhood: draft.neighborhood,
    propertyNumber: draft.propertyNumber,
    propertyType,
  };

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

function summarise(draft: PropertyDraft, locale: string = 'ar'): string {
  const labels = getLabels(locale);
  const parts = [
    draft.propertyType
      ? (labels.propertyType[draft.propertyType] ?? draft.propertyType)
      : (locale === 'en' ? 'Unspecified type' : 'لم يُحدَّد النوع'),
    draft.neighborhood || null,
    draft.propertyNumber ? (locale === 'en' ? `#${draft.propertyNumber}` : `رقم ${draft.propertyNumber}`) : null,
    draft.buildingName || null,
    draft.propertyType === 'BUILDING' && draft.units?.length
      ? (locale === 'en' ? `${draft.units.length} units` : `${draft.units.length} وحدة`)
      : null,
  ];
  return parts.filter(Boolean).join(' — ');
}

function SharedRightsField({
  idPrefix,
  selected,
  onChange,
  locale = 'ar',
}: {
  idPrefix: string;
  selected: string[];
  onChange: (next: string[]) => void;
  locale?: string;
}) {
  const sharedRightsOptions = locale === 'en'
    ? ['Parking space', 'Shared entrance', 'Shared rooftop', 'Shared garden']
    : ['موقف سيارات', 'مدخل مشترك', 'سطح مشترك', 'حديقة مشتركة'];

  return (
    <Field
      label={locale === 'en' ? 'Shared Rights' : 'حقوق مشتركة'}
      htmlFor={idPrefix}
      hint={locale === 'en' ? 'Select applicable' : 'حدد ما ينطبق'}
    >
      <div className="space-y-1">
        {sharedRightsOptions.map((right, rightIndex) => {
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
  locale = 'ar',
}: {
  index: number;
  units: UnitDraft[];
  errors: Record<string, string>;
  onChange: (next: UnitDraft[]) => void;
  locale?: string;
}) {
  const labels = getLabels(locale);
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
    onChange([...units, { unitType: units.at(-1)?.unitType }]);
    setCollapsed(new Set(units.map((_, i) => i)));
  };

  const removeUnit = (unitIndex: number) => {
    onChange(units.filter((_, i) => i !== unitIndex));
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
        <h3 className="text-lg font-semibold">
          {locale === 'en' ? 'Building Units' : 'وحدات المبنى'}
        </h3>
        <p className="text-sm text-muted-foreground">
          {locale === 'en'
            ? 'If you own the entire building, add each unit separately. Property number and building name remain the same for all units.'
            : 'إذا كنت تملك المبنى بالكامل، أضف كل وحدة فيه على حدة. رقم العقار واسم المبنى يبقيان كما هما لجميع الوحدات.'}
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
                  <h4 className="font-semibold">
                    {locale === 'en' ? `Unit ${unitIndex + 1}` : `الوحدة ${unitIndex + 1}`}
                  </h4>
                  {unitCollapsed ? (
                    <span className="mt-0.5 block truncate text-sm font-normal text-muted-foreground">
                      {summariseUnit(unit, locale)}
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
                  {locale === 'en' ? 'Delete' : 'حذف'}
                </Button>
              ) : null}
            </div>

            {unitCollapsed ? null : (
              <>
                <Field
                  label={locale === 'en' ? 'Unit Type' : 'نوع الوحدة'}
                  htmlFor={`ut-${index}-${unitIndex}`}
                  required
                  error={unitErrors.unitType}
                >
                  <Select
                    value={unit.unitType ?? ''}
                    onValueChange={(next) => setUnit(unitIndex, { unitType: next as UnitType })}
                  >
                    <SelectTrigger id={`ut-${index}-${unitIndex}`}>
                      <SelectValue placeholder={locale === 'en' ? 'Select…' : 'اختر…'} />
                    </SelectTrigger>
                    <SelectContent>
                      {(['APARTMENT', 'CLINIC', 'SHOP'] as const).map((o) => (
                        <SelectItem key={o} value={o}>
                          {labels.unitType[o]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    label={locale === 'en' ? 'Floor' : 'الطابق'}
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
                    label={locale === 'en' ? 'Unit Area (sq. meters)' : 'مساحة الوحدة (متر مربع)'}
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
                  label={locale === 'en' ? 'Side / Orientation' : 'الجهة'}
                  htmlFor={`sd-${index}-${unitIndex}`}
                  hint={locale === 'en' ? 'e.g. North, South' : 'مثال: شمالي، جنوبي'}
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
                  locale={locale}
                />
              </>
            )}
          </div>
        );
      })}

      <Button variant="outline" className="w-full border-dashed" onClick={addUnit}>
        <Plus className="size-4" aria-hidden />
        {locale === 'en' ? 'Add Another Unit' : 'إضافة وحدة أخرى'}
      </Button>
    </section>
  );
}

function summariseUnit(unit: UnitDraft, locale: string = 'ar'): string {
  const labels = getLabels(locale);
  const parts = [
    unit.unitType ? labels.unitType[unit.unitType] : (locale === 'en' ? 'Unspecified type' : 'لم يُحدَّد النوع'),
    unit.floor ? (locale === 'en' ? `Floor ${unit.floor}` : `طابق ${unit.floor}`) : null,
    unit.unitArea ? `${unit.unitArea} ${locale === 'en' ? 'm²' : 'م²'}` : null,
  ];
  return parts.filter(Boolean).join(' — ');
}

function PropertyNumberField({
  tenant,
  index,
  value,
  onChange,
  locale = 'ar',
}: {
  tenant: string;
  index: number;
  value: string;
  onChange: (value: string) => void;
  locale?: string;
}) {
  const [result, setResult] = useState<PropertyNumberCheck | null>(null);
  const [checking, setChecking] = useState(false);

  const requestId = useRef(0);

  const verify = useCallback(
    async (candidate: string) => {
      const id = ++requestId.current;
      setChecking(true);
      try {
        const next = await checkPropertyNumber(tenant, candidate);
        if (id === requestId.current) setResult(next);
      } catch {
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

  const neighbours = settled ? result.registeredCount : 0;

  const error = unknown
    ? (locale === 'en'
        ? 'This parcel number was not found in the municipality cadastre. Check the title deed.'
        : 'هذا الرقم غير موجود في السجل العقاري للبلدية. تأكّد من الرقم المدوّن على سند الملكية.')
    : undefined;

  return (
    <Field
      label={locale === 'en' ? 'Property Number' : 'رقم العقار'}
      htmlFor={`pn-${index}`}
      required
      hint={
        locale === 'en'
          ? 'As written on title deed. Automatically verified in municipal records.'
          : 'كما هو مدوّن على سند الملكية. يتم التحقق منه تلقائياً في سجل البلدية.'
      }
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
          {locale === 'en' ? 'Checking…' : 'جارٍ التحقق…'}
        </p>
      ) : null}

      {confirmed ? (
        <p className="flex items-center gap-2 text-sm font-medium text-success">
          <CheckCircle2 className="size-4" aria-hidden />
          {result.location
            ? (locale === 'en' ? 'Valid parcel number — located on municipality map' : 'رقم صحيح — تم تحديد موقع العقار على خريطة البلدية')
            : (locale === 'en' ? 'Valid parcel number' : 'رقم صحيح')}
        </p>
      ) : null}

      {confirmed && neighbours > 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="size-4 shrink-0" aria-hidden />
          {neighbours === 1
            ? (locale === 'en' ? '1 other citizen registered on this parcel — normal in shared buildings.' : 'مسجّل شخص آخر على هذا العقار — هذا طبيعي في المباني المشتركة.')
            : (locale === 'en' ? `${neighbours} other citizens registered on this parcel — normal in shared buildings.` : `مسجّل ${neighbours} أشخاص آخرين على هذا العقار — هذا طبيعي في المباني المشتركة.`)}
        </p>
      ) : null}

      {confirmed && result.location?.approximate ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="size-4" aria-hidden />
          {locale === 'en'
            ? 'This parcel is subdivided into multiple plots — location is approximate.'
            : 'هذا العقار مقسّم إلى أكثر من قطعة — الموقع تقريبي.'}
        </p>
      ) : null}

      {unknown && result.suggestions.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {locale === 'en' ? 'Nearby numbers in registry:' : 'أرقام قريبة موجودة في السجل:'}
          </p>
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
