import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { BadgeCheck, CheckCircle2, Clock, Eye, HelpCircle, XCircle } from 'lucide-react';
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
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Review states, mapped once so the table, the map and the detail page agree. */
export const STATUS_BADGE_VARIANT: Record<string, BadgeProps['variant']> = {
  PENDING: 'warning',
  UNDER_REVIEW: 'warning',
  VERIFIED: 'secondary',
  APPROVED: 'success',
  REJECTED: 'destructive',
};

/**
 * Soft-filled treatment for the status column.
 *
 * The solid variants above are right for a lone badge on a detail page; a
 * column of ten of them is ten saturated blocks competing with the row's
 * actual content. These carry the same hue at tint strength with a matching
 * border and coloured text, so the status stays instantly readable without
 * shouting over the name beside it.
 *
 * Every status gets its own hue — `PENDING` and `UNDER_REVIEW` were both
 * amber and `VERIFIED` was plain grey, which made the three states a reviewer
 * moves a claim through the three hardest to tell apart.
 */
const STATUS_TONE: Record<string, string> = {
  PENDING:
    'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  UNDER_REVIEW:
    'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  VERIFIED:
    'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  APPROVED:
    'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  REJECTED:
    'border-red-600/30 bg-red-600/10 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};

/**
 * Same mapping as the colour, so a status is never a colour alone.
 *
 * Exported because the dashboard's row actions are icon-only: the button that
 * moves a claim *to* a status shows the same glyph the badge will show once
 * it lands there, so the two are learnable as one vocabulary rather than two.
 */
export const STATUS_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  PENDING: Clock,
  UNDER_REVIEW: Eye,
  VERIFIED: BadgeCheck,
  APPROVED: CheckCircle2,
  REJECTED: XCircle,
};

/**
 * The one place a registration's review status is rendered — the dashboard
 * table, the map's citizen drawer and the citizen profile page all used a bare
 * `Badge` with just coloured text, which reads as noise once the eye has to
 * scan a column of ten rows. An icon gives each status a shape, not just a
 * hue, so colour-blind staff and a quick scan both still work.
 */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  label: string;
  className?: string;
}): React.JSX.Element {
  const Icon = STATUS_ICON[status] ?? HelpCircle;
  const tone = STATUS_TONE[status];
  return (
    <Badge
      // Falls back to the solid variants for any status without a tone, so an
      // enum value added later is still legible rather than invisible.
      variant={tone ? 'outline' : (STATUS_BADGE_VARIANT[status] ?? 'secondary')}
      className={cn('gap-1.5 whitespace-nowrap py-1', tone, className)}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {label}
    </Badge>
  );
}

export { Badge, badgeVariants };
