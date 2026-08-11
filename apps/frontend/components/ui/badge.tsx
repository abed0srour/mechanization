import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/** Ported verbatim from the Albazourieh platform's shadcn/ui badge. */
const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'text-foreground',
        success: 'border-transparent bg-emerald-600 text-white hover:bg-emerald-600/80',
        warning: 'border-transparent bg-amber-500 text-white hover:bg-amber-500/80',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

/**
 * Small pill: a label, a role, a count.
 *
 * A `<span>`, not the `<div>` the shadcn original uses. A badge is phrasing
 * content — it sits inside a sentence, beside a title, within a `<p>` — and a
 * `<div>` there is invalid HTML that the browser silently repairs by closing
 * the paragraph early. The repaired DOM then no longer matches what the server
 * sent, so it surfaces as a hydration error pointing at this component rather
 * than at the paragraph that actually contains it.
 *
 * `inline-flex` in `badgeVariants` already did the layout work, so nothing
 * about the rendering changes — only which element carries it.
 */
function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/*
 * `STATUS_BADGE_VARIANT`, `STATUS_TONE`, `STATUS_ICON` and `StatusBadge` were
 * here — the one place a طلب's review state was rendered, shared by the
 * dashboard table, the map's citizen drawer and the citizen profile page.
 *
 * Records are entered by staff now, so a filing has no state to render: it
 * exists because a clerk entered it. What is left of "status" in this product
 * is a *payment* status, and that keeps its tones next to the money it
 * describes rather than in a shared component — there is one screen for it,
 * and a generic badge serving two unrelated vocabularies is how the two drift.
 */

export { Badge, badgeVariants };
