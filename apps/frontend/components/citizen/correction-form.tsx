'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  ar,
  isCorrectable,
  isPropertyField,
  REJECTABLE_FIELDS,
  type RejectableField,
} from '@mechanization/shared-schemas';
import {
  ApiRequestError,
  getCorrection,
  logApiError,
  submitCorrection,
  type CorrectionContext,
} from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** The citizen columns each flag maps onto. `personal.name` is the one flag
 *  that owns more than one input. */
const PERSONAL_INPUTS: Partial<Record<RejectableField, string[]>> = {
  'personal.name': ['firstName', 'middleName', 'lastName'],
  'personal.gender': ['gender'],
  'personal.nationality': ['nationality'],
  'personal.residentStatus': ['residentStatus'],
  'personal.identityDocType': ['identityDocType'],
  'personal.identityDocNumber': ['identityDocNumber'],
  'personal.civilRecordNumber': ['civilRecordNumber'],
  'personal.residencyNumber': ['residencyNumber'],
};

const CONTACT_INPUTS: Partial<Record<RejectableField, string[]>> = {
  'contact.phone': ['phone'],
  'contact.whatsapp': ['whatsapp'],
  'contact.maritalStatus': ['maritalStatus'],
  'contact.familySize': ['familySize'],
};

const PROPERTY_INPUTS: Partial<Record<RejectableField, string[]>> = {
  'property.neighborhood': ['neighborhood'],
  'property.propertyNumber': ['propertyNumber'],
  'property.buildingName': ['buildingName'],
  'property.unitArea': ['unitArea'],
  'property.landlord': ['landlordName', 'landlordPhone'],
};

const LABELS: Record<string, string> = {
  firstName: 'الاسم الأول',
  middleName: 'اسم الأب',
  lastName: 'الشهرة',
  gender: 'الجنس',
  nationality: 'الجنسية',
  residentStatus: 'صفة الإقامة',
  identityDocType: 'نوع وثيقة الإثبات',
  identityDocNumber: 'رقم الوثيقة',
  civilRecordNumber: 'رقم السجل',
  residencyNumber: 'رقم الإقامة',
  phone: 'رقم الهاتف',
  whatsapp: 'رقم واتساب',
  maritalStatus: 'الحالة الاجتماعية',
  familySize: 'عدد أفراد الأسرة',
  neighborhood: 'الحي',
  propertyNumber: 'رقم العقار',
  buildingName: 'اسم المبنى',
  unitArea: 'المساحة (م²)',
  landlordName: 'اسم المالك',
  landlordPhone: 'هاتف المالك',
};

/** Inputs that are a fixed choice rather than free text. */
const OPTIONS: Record<string, Record<string, string>> = {
  gender: ar.gender,
  residentStatus: ar.residentStatus,
  identityDocType: ar.identityDocType,
  maritalStatus: ar.maritalStatus ?? {},
};

const LTR_INPUTS = new Set([
  'identityDocNumber',
  'civilRecordNumber',
  'residencyNumber',
  'phone',
  'whatsapp',
  'landlordPhone',
  'propertyNumber',
  'familySize',
  'unitArea',
]);

/** Null-safe string coercion for seeding an input from stored data. */
function str(value: unknown): string {
  return value == null ? '' : String(value);
}

/**
 * The corrections form: only what the reviewer flagged, nothing else.
 *
 * A rejected claim is not re-filed from scratch. The citizen answered these
 * questions once already, and asking for all seven wizard steps again to fix
 * one wrong digit is how a correctable submission turns into an abandoned one.
 * So this renders an input per flagged field, pre-filled with what is on
 * record, and sends only those values back.
 */
export function CorrectionForm({
  tenant,
  token,
  registrationId,
  open,
  onOpenChange,
  onCorrected,
}: {
  tenant: string;
  token: string;
  registrationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCorrected: () => void;
}) {
  const [context, setContext] = useState<CorrectionContext | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [propertyValues, setPropertyValues] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !registrationId) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    getCorrection(tenant, token, registrationId)
      .then((result) => {
        if (cancelled) return;
        setContext(result);

        // Pre-filled with what is on record: the citizen is correcting an
        // answer, not producing a new one, and retyping a name to fix a
        // surname is its own source of fresh mistakes.
        const seeded: Record<string, string> = {};
        for (const [key, value] of Object.entries({ ...result.personal, ...result.contact })) {
          seeded[key] = str(value);
        }
        setValues(seeded);

        const perProperty: Record<string, Record<string, string>> = {};
        for (const property of result.properties) {
          const id = str(property.id);
          perProperty[id] = Object.fromEntries(
            Object.entries(property).map(([key, value]) => [key, str(value)]),
          );
        }
        setPropertyValues(perProperty);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        logApiError(caught);
        setError('تعذّر تحميل بيانات التصحيح.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, registrationId, tenant, token]);

  const flags = useMemo(
    () => (context?.rejectedFields ?? []) as RejectableField[],
    [context],
  );

  /** Flags that no text input can honestly repair — a missing document, a
   *  wrong property type. Named rather than hidden, so the citizen is not
   *  left wondering why the reviewer's complaint is absent from the form. */
  const notFixableHere = flags.filter((field) => !isCorrectable(field));

  const personalFlags = flags.filter((f) => isCorrectable(f) && f.startsWith('personal.'));
  const contactFlags = flags.filter((f) => isCorrectable(f) && f.startsWith('contact.'));
  const propertyFlags = flags.filter((f) => isCorrectable(f) && isPropertyField(f));

  function inputsFor(
    field: RejectableField,
    map: Partial<Record<RejectableField, string[]>>,
  ): string[] {
    return map[field] ?? [];
  }

  async function handleSubmit() {
    if (!registrationId) return;
    setSubmitting(true);
    setError(null);
    try {
      const personal: Record<string, unknown> = {};
      for (const field of personalFlags) {
        for (const key of inputsFor(field, PERSONAL_INPUTS)) personal[key] = values[key] ?? '';
      }

      const contact: Record<string, unknown> = {};
      for (const field of contactFlags) {
        for (const key of inputsFor(field, CONTACT_INPUTS)) contact[key] = values[key] ?? '';
      }

      const properties = Object.entries(propertyValues).map(([id, fields]) => {
        const patch: { id: string } & Record<string, unknown> = { id };
        for (const field of propertyFlags) {
          for (const key of inputsFor(field, PROPERTY_INPUTS)) patch[key] = fields[key] ?? '';
        }
        return patch;
      });

      await submitCorrection(tenant, token, registrationId, {
        personal,
        contact,
        properties: propertyFlags.length > 0 ? properties : [],
      });

      onOpenChange(false);
      onCorrected();
    } catch (caught) {
      logApiError(caught);
      setError(
        caught instanceof ApiRequestError ? caught.message : 'تعذّر إرسال التصحيح.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const renderInput = (key: string, value: string, onChange: (next: string) => void) => {
    const options = OPTIONS[key];
    if (options) {
      return (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={key}>
            <SelectValue placeholder="اختر…" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(options).map(([optionValue, label]) => (
              <SelectItem key={optionValue} value={optionValue}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    return (
      <Input
        id={key}
        dir={LTR_INPUTS.has(key) ? 'ltr' : undefined}
        className={LTR_INPUTS.has(key) ? 'text-start' : undefined}
        inputMode={key === 'familySize' || key === 'unitArea' ? 'numeric' : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  };

  const hasAnyInput =
    personalFlags.length > 0 || contactFlags.length > 0 || propertyFlags.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel="إغلاق" className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 space-y-1 border-b p-6 text-start">
          <DialogTitle>تصحيح الطلب</DialogTitle>
          <DialogDescription>
            صحّح الحقول التالية فقط، ثم أعد الإرسال. باقي طلبك يبقى كما هو.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
          {loading ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              جارٍ التحميل…
            </p>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          {context?.rejectionReason ? (
            <div className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-sm font-semibold text-destructive">ملاحظة البلدية</p>
              <p className="text-sm">{context.rejectionReason}</p>
            </div>
          ) : null}

          {personalFlags.map((field) =>
            inputsFor(field, PERSONAL_INPUTS).map((key) => (
              <Field key={key} label={LABELS[key] ?? key} htmlFor={key} required>
                {renderInput(key, values[key] ?? '', (next) =>
                  setValues((previous) => ({ ...previous, [key]: next })),
                )}
              </Field>
            )),
          )}

          {contactFlags.map((field) =>
            inputsFor(field, CONTACT_INPUTS).map((key) => (
              <Field key={key} label={LABELS[key] ?? key} htmlFor={key} required>
                {renderInput(key, values[key] ?? '', (next) =>
                  setValues((previous) => ({ ...previous, [key]: next })),
                )}
              </Field>
            )),
          )}

          {/* Every property is shown when a property field is flagged: the
              reviewer's flag names the field, not which card it was on. */}
          {propertyFlags.length > 0
            ? Object.entries(propertyValues).map(([id, fields]) => (
                <div key={id} className="space-y-4 rounded-lg border p-4">
                  <p className="text-sm font-semibold">
                    العقار رقم <span dir="ltr">{fields.propertyNumber}</span>
                  </p>
                  {propertyFlags.map((field) =>
                    inputsFor(field, PROPERTY_INPUTS).map((key) => (
                      <Field key={key} label={LABELS[key] ?? key} htmlFor={`${id}-${key}`} required>
                        {renderInput(key, fields[key] ?? '', (next) =>
                          setPropertyValues((previous) => ({
                            ...previous,
                            [id]: { ...previous[id], [key]: next },
                          })),
                        )}
                      </Field>
                    )),
                  )}
                </div>
              ))
            : null}

          {notFixableHere.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                يحتاج مراجعة البلدية
              </p>
              <p className="text-sm text-muted-foreground">
                لا يمكن تصحيح ما يلي من هنا — راجع البلدية مع رقمك المرجعي:
              </p>
              <ul className="list-inside list-disc text-sm">
                {notFixableHere.map((field) => (
                  <li key={field}>{REJECTABLE_FIELDS[field] ?? field}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {!loading && !hasAnyInput && notFixableHere.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              لم تحدَّد حقول بعينها. راجع ملاحظة البلدية أعلاه، وقدّم طلباً جديداً إذا لزم.
            </p>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t p-6">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            إلغاء
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting || !hasAnyInput}>
            {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            إرسال التصحيح
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
