'use client';

import { createContext, useContext } from 'react';
import { X } from 'lucide-react';
import { REJECTABLE_FIELDS, type RejectableField } from '@mechanization/shared-schemas';
import { cn } from '@/lib/utils';

interface FieldReview {
  /** True while a reviewer is composing a rejection. */
  active: boolean;
  flagged: ReadonlySet<RejectableField>;
  toggle: (field: RejectableField) => void;
}

const FieldReviewContext = createContext<FieldReview | null>(null);

export const FieldReviewProvider = FieldReviewContext.Provider;

/**
 * Flagging is read from context rather than threaded through props.
 *
 * The values it decorates sit four levels down — page → registration card →
 * property card → fact — and every layer in between would otherwise have to
 * carry three props it has no use for, purely so the leaf could see them.
 */
export function useFieldReview(): FieldReview | null {
  return useContext(FieldReviewContext);
}

/**
 * The × beside a value that marks it as wrong.
 *
 * Renders nothing outside a rejection, so the same field components serve the
 * ordinary read-only page and the review pass without a second implementation
 * of either. `aria-pressed` rather than a checkbox: this toggles a state on
 * something already on screen, it does not add a row to a form.
 */
export function FieldFlag({ field }: { field: RejectableField }) {
  const review = useFieldReview();
  if (!review?.active) return null;

  const flagged = review.flagged.has(field);
  return (
    <button
      type="button"
      onClick={() => review.toggle(field)}
      aria-pressed={flagged}
      aria-label={
        flagged ? `إلغاء رفض: ${REJECTABLE_FIELDS[field]}` : `رفض: ${REJECTABLE_FIELDS[field]}`
      }
      title={flagged ? 'إلغاء الرفض' : 'رفض هذا الحقل'}
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
        flagged
          ? 'border-destructive bg-destructive text-destructive-foreground'
          : 'border-muted-foreground/40 text-muted-foreground hover:border-destructive hover:text-destructive',
      )}
    >
      <X className="size-3" aria-hidden />
    </button>
  );
}

/** Ring drawn around a flagged value, so the rejection is visible at a glance
 *  and not only on the button that caused it. */
export function flaggedClass(
  review: FieldReview | null,
  field: RejectableField | undefined,
): string | undefined {
  if (!review?.active || !field || !review.flagged.has(field)) return undefined;
  return 'rounded-md bg-destructive/10 px-2 py-1 ring-1 ring-destructive/40';
}
