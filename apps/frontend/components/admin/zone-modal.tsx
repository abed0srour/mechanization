'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import type { ZoneDetail } from '@/lib/api-client';

/**
 * A fixed palette rather than a free colour picker.
 *
 * Zones are read as a set on one map, so what matters is that any two are
 * told apart at a glance — a choice a native colour input actively works
 * against, since it makes two barely-distinguishable blues as easy to pick as
 * two opposite hues. These eight are spaced around the wheel and hold up
 * against both satellite imagery and the light basemap.
 */
const PALETTE = [
  { hex: '#3B82F6', label: 'أزرق' },
  { hex: '#10B981', label: 'أخضر' },
  { hex: '#F59E0B', label: 'برتقالي' },
  { hex: '#EF4444', label: 'أحمر' },
  { hex: '#8B5CF6', label: 'بنفسجي' },
  { hex: '#EC4899', label: 'وردي' },
  { hex: '#14B8A6', label: 'فيروزي' },
  { hex: '#84CC16', label: 'ليموني' },
] as const;

export interface ZoneFormValues {
  name: string;
  code: string;
  color: string;
  description: string;
}

export function ZoneModal({
  open,
  zone,
  parcelCount,
  saving,
  error,
  fieldErrors,
  onSave,
  onOpenChange,
}: {
  open: boolean;
  /** The sector being edited, or null when creating a new one. */
  zone: ZoneDetail | null;
  /** Parcels currently selected on the map — the membership about to be saved. */
  parcelCount: number;
  saving: boolean;
  error: string | null;
  fieldErrors: Record<string, string>;
  onSave: (values: ZoneFormValues) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [values, setValues] = useState<ZoneFormValues>({
    name: '',
    code: '',
    color: PALETTE[0].hex,
    description: '',
  });

  // Reseeded whenever the dialog opens, so editing one sector and then another
  // does not carry the first one's name into the second one's form.
  useEffect(() => {
    if (!open) return;
    setValues({
      name: zone?.name ?? '',
      code: zone?.code ?? '',
      color: zone?.color ?? PALETTE[0].hex,
      description: zone?.description ?? '',
    });
  }, [open, zone]);

  const set = <K extends keyof ZoneFormValues>(key: K, value: ZoneFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel="إغلاق" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{zone ? 'تعديل القطاع' : 'قطاع جديد'}</DialogTitle>
          <DialogDescription>
            {parcelCount > 0
              ? `${parcelCount} عقار محدّد على الخريطة`
              : 'لم يتم تحديد أي عقار بعد — يمكن حفظ القطاع وإضافة العقارات لاحقاً'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="اسم القطاع" htmlFor="zone-name" required error={fieldErrors.name}>
            <Input
              id="zone-name"
              value={values.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="المنطقة الشرقية - قطاع أ"
            />
          </Field>

          <Field
            label="رمز القطاع"
            htmlFor="zone-code"
            required
            hint="رمز مختصر يستخدم في التقارير"
            error={fieldErrors.code}
          >
            <Input
              id="zone-code"
              value={values.code}
              onChange={(e) => set('code', e.target.value)}
              placeholder="SEC-A1"
              // Latin/digits regardless of the page's RTL flow — the value is a
              // code, and mirroring it makes "SEC-A1" read as "1A-CES".
              dir="ltr"
              className="text-start"
            />
          </Field>

          <Field label="لون القطاع" htmlFor="zone-color" required error={fieldErrors.color}>
            <div id="zone-color" className="flex flex-wrap gap-2">
              {PALETTE.map((swatch) => {
                const active = values.color.toUpperCase() === swatch.hex;
                return (
                  <button
                    key={swatch.hex}
                    type="button"
                    onClick={() => set('color', swatch.hex)}
                    aria-label={swatch.label}
                    aria-pressed={active}
                    className={`size-9 rounded-full border-2 transition-transform ${
                      active
                        ? 'scale-110 border-foreground ring-2 ring-ring ring-offset-2 ring-offset-background'
                        : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: swatch.hex }}
                  />
                );
              })}
            </div>
          </Field>

          <Field label="ملاحظات" htmlFor="zone-description" error={fieldErrors.description}>
            <Textarea
              id="zone-description"
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
              rows={2}
              placeholder="وصف مختصر للقطاع"
            />
          </Field>

          {error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button
            onClick={() => onSave(values)}
            disabled={saving || !values.name.trim() || !values.code.trim()}
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {zone ? 'حفظ التعديلات' : 'إنشاء القطاع'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
