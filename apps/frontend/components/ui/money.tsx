'use client';

import { formatLbp, formatLbpCompact, isCompactable } from '@/lib/currency';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';
import { cn } from '@/lib/utils';

/**
 * One monetary amount, sized so it cannot break the layout it sits in.
 *
 * Three things this does that a bare `{amount} ل.ل` did not:
 *
 *  - **Compacts at a million.** LBP figures reach seven and eight digits
 *    routinely, and `1,250,000,000 ل.ل` in a table cell either wraps onto a
 *    second line — making one row twice the height of its neighbours — or is
 *    clipped by the cell's overflow. `1.25 مليار ل.ل` is half the width.
 *
 *  - **Keeps the exact figure one hover away**, and in `title` for touch and
 *    for anyone who has hover disabled. A rounded amount a clerk cannot get
 *    back to the pound is not something they can act on at a counter, so the
 *    shorthand is never the only copy of the number.
 *
 *  - **Refuses to wrap.** `whitespace-nowrap` plus `tabular-nums`: an amount
 *    is one atom, and a column of them should align on its digits rather than
 *    drift with the proportional figures the body font ships.
 *
 * The containers around it do the rest — none of the money cells or tiles in
 * this portal carry a fixed width, so a longer figure widens its own block
 * instead of being cut off by it.
 */
export function Money({
  amount,
  className,
  /** Renders the full grouped figure regardless of size. For a single row on
   *  a detail page, where there is room and the exact number is the point. */
  exact = false,
}: {
  amount: number;
  className?: string;
  exact?: boolean;
}): React.JSX.Element {
  const full = formatLbp(amount);
  const compacted = !exact && isCompactable(amount);
  const shown = compacted ? formatLbpCompact(amount) : full;

  const text = (
    <span className={cn('whitespace-nowrap tabular-nums', className)}>{shown}</span>
  );

  // Nothing to reveal when the displayed figure is already the exact one —
  // a tooltip that repeats its own trigger is noise on every hover.
  if (!compacted) return text;

  return (
    <Tooltip>
      {/*
        `title` as well as the Radix tooltip, and deliberately not instead of
        it: the tooltip does not open on a touchscreen, which is half the
        devices this dashboard is used on (the brief calls out administrative
        tablets). `title` is the one affordance that survives long-press and
        keyboard focus without a hover.
      */}
      <TooltipTrigger asChild>
        <span
          title={full}
          // `help` rather than `default`: this text does something on hover,
          // and nothing else on the row does.
          className={cn(
            'cursor-help whitespace-nowrap tabular-nums decoration-dotted underline-offset-4 hover:underline',
            className,
          )}
        >
          {shown}
        </span>
      </TooltipTrigger>
      <TooltipContent className="tabular-nums">{full}</TooltipContent>
    </Tooltip>
  );
}
