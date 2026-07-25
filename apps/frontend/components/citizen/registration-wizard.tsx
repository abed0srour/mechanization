'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ar } from '@mechanization/shared-schemas';
import type { PublicTenantConfig } from '@/lib/api-client';
import { ApiRequestError, submitRegistration } from '@/lib/api-client';
import { clearDraft, loadDraft, saveDraft } from '@/lib/wizard-storage';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { WizardProgress } from './wizard-progress';
import { PropertyCard, type PropertyDraft } from './property-card';
import { ContactStep, DeclarationStep, DocumentsStep, PersonalStep, ReviewStep } from './steps';

/**
 * Six steps, not seven. "مواقع العقارات" — a MapLibre pin-drop per property —
 * is gone: the municipality's cadastre already holds an authoritative point for
 * every رقم العقار, so asking a citizen to find their own roof on a satellite
 * image could only produce a worse answer to a question already answered. It
 * also takes MapLibre off the citizen bundle entirely, which is the largest
 * single win available on a 3G connection with an older Android phone.
 */
const STEPS = [
  'البيانات الشخصية',
  'التواصل والأسرة',
  'عقاراتك',
  'المستندات',
  'المراجعة',
  'الإقرار والإرسال',
];

export interface WizardData {
  personal: Record<string, unknown>;
  contact: Record<string, unknown>;
  properties: PropertyDraft[];
}

const EMPTY: WizardData = {
  personal: { isLebanese: true },
  contact: { whatsappSameAsPhone: true },
  properties: [{}],
};

export function RegistrationWizard({
  tenant,
  locale,
  config,
}: {
  tenant: string;
  locale: string;
  config: PublicTenantConfig;
}) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(EMPTY);
  const [files, setFiles] = useState<Record<string, File>>({});
  const [restoredAt, setRestoredAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ referenceNumber: string; propertyCount: number } | null>(
    null,
  );

  /**
   * Restore an interrupted session. Runs once on mount rather than on every
   * render so a citizen who deliberately went back a step is not yanked forward
   * again.
   */
  useEffect(() => {
    const draft = loadDraft<WizardData>(tenant);
    if (draft) {
      setData(draft.data);
      setStep(draft.step);
      setRestoredAt(draft.savedAt);
    }
  }, [tenant]);

  // Every change is written through. The network is touched once, at submit.
  useEffect(() => {
    if (result) return;
    saveDraft(tenant, step, data);
  }, [tenant, step, data, result]);

  const update = useCallback((patch: Partial<WizardData>) => {
    setData((current) => ({ ...current, ...patch }));
  }, []);

  const setProperty = useCallback((index: number, next: PropertyDraft) => {
    setData((current) => ({
      ...current,
      properties: current.properties.map((p, i) => (i === index ? next : p)),
    }));
  }, []);

  /**
   * A citizen with several properties fills the same shape repeatedly, so a new
   * card inherits the occupancy type from the last one — changeable, never
   * assumed correct.
   */
  const addProperty = useCallback(() => {
    setData((current) => ({
      ...current,
      properties: [
        ...current.properties,
        { occupancyType: current.properties.at(-1)?.occupancyType },
      ],
    }));
  }, []);

  const removeProperty = useCallback((index: number) => {
    setData((current) => ({
      ...current,
      properties: current.properties.filter((_, i) => i !== index),
    }));
  }, []);

  const allowedTypes = useMemo(
    () => new Set(config.enabledPropertyTypes),
    [config.enabledPropertyTypes],
  );

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      const form = new FormData();

      // Each file gets a slot descriptor so the server can match bytes to the
      // right property card without trusting filenames.
      const documentSlots = Object.entries(files).map(([field, file]) => ({
        field,
        type: slotTypeFor(field),
        propertyIndex: slotPropertyIndex(field),
        _name: file.name,
      }));

      form.append(
        'payload',
        JSON.stringify({
          personal: data.personal,
          contact: data.contact,
          properties: data.properties.map(toPayloadProperty),
          documentSlots: documentSlots.map(({ _name, ...slot }) => slot),
          declarationAccepted: true,
        }),
      );

      for (const [field, file] of Object.entries(files)) {
        form.append(field, file);
      }

      const response = await submitRegistration(tenant, form);

      // Only now is the draft gone — a filed report is no longer a draft, but a
      // failed submit must leave everything exactly where it was.
      clearDraft(tenant);
      setResult({
        referenceNumber: response.referenceNumber,
        propertyCount: response.propertyCount,
      });
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setError('تعذّر إرسال الطلب. بياناتك محفوظة — يمكنك المحاولة مرة أخرى.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return <SubmissionReceipt tenant={tenant} locale={locale} {...result} />;
  }

  return (
    <div className="space-y-8">
      <WizardProgress steps={STEPS} current={step} />

      {restoredAt && step > 0 ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          تم استرجاع طلب غير مكتمل حُفظ في {restoredAt.toLocaleDateString('ar-LB')}.{' '}
          <button
            type="button"
            className="font-medium text-primary underline underline-offset-4"
            onClick={() => {
              clearDraft(tenant);
              setData(EMPTY);
              setStep(0);
              setRestoredAt(null);
            }}
          >
            ابدأ من جديد
          </button>
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive"
        >
          {error}
        </p>
      ) : null}

      {step === 0 ? (
        <PersonalStep
          value={data.personal}
          errors={fieldErrors}
          onChange={(personal) => update({ personal })}
        />
      ) : null}

      {step === 1 ? (
        <ContactStep
          value={data.contact}
          errors={fieldErrors}
          onChange={(contact) => update({ contact })}
        />
      ) : null}

      {step === 2 ? (
        <div className="space-y-6">
          <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
            رقم العقار هو ما يحدد موقع عقارك لدى البلدية، لذلك يتم التحقق منه في السجل
            العقاري أثناء الكتابة. لا حاجة لتحديد الموقع على الخريطة.
          </p>

          {data.properties.map((property, index) => (
            <PropertyCard
              key={index}
              tenant={tenant}
              index={index}
              draft={property}
              onChange={(next) => setProperty(index, next)}
              onRemove={() => removeProperty(index)}
              canRemove={data.properties.length > 1}
            />
          ))}

          <Button
            variant="outline"
            size="lg"
            onClick={addProperty}
            className="w-full border-dashed border-primary text-primary hover:bg-primary/5"
          >
            + إضافة عقار آخر
          </Button>

          {data.properties.some((p) => p.propertyType && !allowedTypes.has(p.propertyType)) ? (
            <p role="alert" className="text-destructive">
              هذه البلدية لا تستقبل حالياً أحد أنواع العقارات المحددة.
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 3 ? (
        <DocumentsStep
          properties={data.properties}
          files={files}
          requiredDocuments={config.requiredDocuments}
          draftRestored={restoredAt !== null}
          onChange={setFiles}
        />
      ) : null}

      {step === 4 ? <ReviewStep data={data} files={files} onJump={setStep} /> : null}

      {step === 5 ? (
        <DeclarationStep
          submitting={submitting}
          supportPhone={config.supportPhone}
          onSubmit={handleSubmit}
        />
      ) : null}

      <nav className="flex gap-3 border-t pt-6">
        {step > 0 ? (
          <Button variant="outline" size="lg" className="flex-1" onClick={() => setStep((s) => s - 1)}>
            السابق
          </Button>
        ) : null}

        {step < STEPS.length - 1 ? (
          <Button size="lg" className="flex-1" onClick={() => setStep((s) => s + 1)}>
            التالي
          </Button>
        ) : null}
      </nav>

      <p className="text-center text-sm text-muted-foreground">
        تُحفظ إجاباتك على هذا الجهاز تلقائياً. يمكنك إغلاق الصفحة والعودة لاحقاً.
      </p>
    </div>
  );
}

/** Confirmation. The رقم مرجعي is the one thing the citizen must leave with. */
function SubmissionReceipt({
  tenant,
  locale,
  referenceNumber,
  propertyCount,
}: {
  tenant: string;
  locale: string;
  referenceNumber: string;
  propertyCount: number;
}) {
  return (
    <div className="space-y-8 text-center">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">تم استلام طلبك</h1>
        <p className="text-lg text-muted-foreground">
          سُجّل {propertyCount === 1 ? 'عقار واحد' : `${propertyCount} عقارات`}.
        </p>
      </div>

      <Card className="mx-auto max-w-md border-primary/30 bg-primary/5">
        <CardContent className="space-y-2 p-6">
          <p className="text-sm text-muted-foreground">رقمك المرجعي</p>
          <p className="text-3xl font-bold tracking-widest text-primary" dir="ltr">
            {referenceNumber}
          </p>
        </CardContent>
      </Card>

      <p className="mx-auto max-w-prose text-muted-foreground">
        احتفظ بهذا الرقم — تحتاجه لمتابعة طلبك، وهو يعمل حتى لو تغيّر رقم هاتفك. أُرسلت لك
        نسخة برسالة نصية.
      </p>

      <a
        href={`/${tenant}/${locale}/my-account`}
        className={buttonVariants({ size: 'lg' })}
      >
        متابعة طلبي
      </a>
    </div>
  );
}

/** `identity`, `proof-0`, `extra-2` → the document type the server expects. */
function slotTypeFor(field: string): string {
  if (field.startsWith('identity')) return 'IDENTITY';
  if (field.startsWith('proof')) return 'OWNERSHIP_PROOF';
  if (field.startsWith('contract')) return 'RENTAL_CONTRACT';
  if (field.startsWith('residency')) return 'RESIDENCY_PROOF';
  return 'EXTRA_PHOTO';
}

function slotPropertyIndex(field: string): number | undefined {
  const match = field.match(/-(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

/** Drops UI-only fields and coerces the numeric strings the inputs produce. */
function toPayloadProperty(property: PropertyDraft): Record<string, unknown> {
  const { unitArea, ...rest } = property;
  return {
    ...rest,
    ...(unitArea !== undefined && unitArea !== '' ? { unitArea: Number(unitArea) } : {}),
  };
}

export { ar };
