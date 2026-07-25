'use client';

import { cn } from '@/lib/utils';

/**
 * The Albazourieh platform's wizard header, carried over as-is: a step counter
 * above a segmented bar, one segment per step, filled up to and including the
 * current one.
 *
 * Digits are Arabic-Indic because the rest of this form is — the reference
 * platform reads its counter out of an Arabic dictionary and arrives at the
 * same place.
 */
export function WizardProgress({ steps, current }: { steps: string[]; current: number }) {
  return (
    <nav aria-label="مراحل التسجيل" className="space-y-3">
      <p className="text-sm font-medium text-muted-foreground">
        الخطوة {toArabicDigits(current + 1)} من {toArabicDigits(steps.length)}
        <span className="ms-2 text-foreground">{steps[current]}</span>
      </p>

      <ol className="flex gap-1.5">
        {steps.map((step, index) => (
          <li key={step} className="flex-1">
            <div
              aria-current={index === current ? 'step' : undefined}
              title={step}
              className={cn('h-2 rounded-full', index <= current ? 'bg-primary' : 'bg-muted')}
            />
            <span className="sr-only">
              {step} {index < current ? '(مكتملة)' : index === current ? '(الحالية)' : ''}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Arabic-Indic digits read more naturally for the audience this serves. */
function toArabicDigits(value: number): string {
  return String(value).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]!);
}
