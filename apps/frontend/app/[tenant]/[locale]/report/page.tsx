'use client';

import { use, useState } from 'react';
import { PropertyStep } from '@/components/citizen/property-step';
import type { PropertyDraft } from '@/components/citizen/property-card';
import { WizardProgress } from '@/components/citizen/wizard-progress';

const STEPS = [
  'البيانات الشخصية',
  'التواصل والأسرة',
  'العقارات',
  'المرفقات',
  'المراجعة',
  'التأكيد',
];

/**
 * Wizard shell. Draft state lives here and is mirrored to sessionStorage on each
 * step change, so a dropped connection near the end does not cost the citizen
 * every step they already filled.
 */
export default function ReportWizard({
  params,
}: {
  params: Promise<{ tenant: string; locale: string }>;
}) {
  const { tenant } = use(params);
  const [step, setStep] = useState(0);
  const [properties, setProperties] = useState<PropertyDraft[]>([{}]);

  return (
    <div className="space-y-8">
      <WizardProgress steps={STEPS} current={step} />

      {step === 2 ? (
        <PropertyStep tenant={tenant} properties={properties} onChange={setProperties} />
      ) : (
        <div className="rounded-card border-2 border-dashed border-rule bg-card p-8 text-center text-muted">
          <p className="font-display text-lg">{STEPS[step]}</p>
          <p className="mt-2 text-sm">
            هذه الخطوة قيد الإنشاء — خطوة العقارات جاهزة للتجربة.
          </p>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          className="min-h-touch flex-1 rounded-card border-2 border-rule bg-card px-5 font-medium disabled:opacity-40"
        >
          السابق
        </button>
        <button
          type="button"
          disabled={step === STEPS.length - 1}
          onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          className="min-h-touch flex-[2] rounded-card border-2 border-cedar bg-cedar px-5 font-medium text-card disabled:opacity-40"
        >
          التالي
        </button>
      </div>
    </div>
  );
}
