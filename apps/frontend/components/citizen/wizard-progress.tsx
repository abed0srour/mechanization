'use client';

import { cn } from '@/lib/utils';

/**
 * Progress as a segmented bar. Numbering is meaningful here — the steps are a
 * real sequence, and the citizen needs to know how much is left before deciding
 * whether they have time to finish.
 */
export function WizardProgress({ steps, current }: { steps: string[]; current: number }) {
  return (
    <nav aria-label="مراحل التسجيل" className="space-y-3">
      <p className="text-lg font-semibold">
        الخطوة {toArabicDigits(current + 1)} من {toArabicDigits(steps.length)}
        <span className="ms-2 text-base font-normal text-muted-foreground">{steps[current]}</span>
      </p>

      <ol className="flex gap-1.5">
        {steps.map((step, index) => (
          <li key={step} className="flex-1">
            <div
              aria-current={index === current ? 'step' : undefined}
              title={step}
              className={cn(
                'h-2 rounded-full transition-colors',
                index < current && 'bg-primary',
                index === current && 'bg-warning',
                index > current && 'bg-muted',
              )}
            />
            <span className="sr-only">
              {step} {index < current ? '(مكتملة)' : index === current ? '(الحالية)' : ''}
            </span>
          </li>
        ))}
      </ol>

      <p className="text-sm text-muted-foreground">
        الحقول المميزة بكلمة <span className="font-semibold text-destructive">إلزامي</span> يجب
        تعبئتها.
      </p>
    </nav>
  );
}

/** Arabic-Indic digits read more naturally for the audience this serves. */
function toArabicDigits(value: number): string {
  return String(value).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]!);
}
