'use client';

import { cn } from '@/lib/utils';

/**
 * Progress as a row of stamps: each completed step is "struck" like an official
 * form moving through an office. Numbering is meaningful here — the steps are a
 * real sequence and the citizen needs to know how much is left.
 */
export function WizardProgress({
  steps,
  current,
}: {
  steps: string[];
  current: number;
}) {
  return (
    <nav aria-label="مراحل التسجيل" className="space-y-3">
      <p className="font-display text-lg font-bold">
        الخطوة {toArabicDigits(current + 1)} من {toArabicDigits(steps.length)}
        <span className="ms-2 font-body text-base font-normal text-muted">
          {steps[current]}
        </span>
      </p>

      <ol className="flex gap-1.5">
        {steps.map((step, index) => (
          <li key={step} className="flex-1">
            <div
              aria-current={index === current ? 'step' : undefined}
              title={step}
              className={cn(
                'h-2.5 rounded-sm',
                index < current && 'bg-cedar',
                index === current && 'bg-gold',
                index > current && 'bg-rule',
              )}
            />
            <span className="sr-only">
              {step} {index < current ? '(مكتملة)' : index === current ? '(الحالية)' : ''}
            </span>
          </li>
        ))}
      </ol>

      <p className="text-sm text-muted">
        الحقول المميزة بكلمة <span className="font-bold text-seal">إلزامي</span> يجب تعبئتها.
      </p>
    </nav>
  );
}

/** Arabic-Indic digits read more naturally for the audience this serves. */
function toArabicDigits(value: number): string {
  return String(value).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]!);
}
