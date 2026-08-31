'use client';

import { usePathname } from 'next/navigation';
import { formatLbp, formatLbpCompact, isCompactable } from '@/lib/currency';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';
import { cn } from '@/lib/utils';

export function Money({
  amount,
  className,
  locale: propLocale,
  /** Renders the full grouped figure regardless of size. For a single row on
   *  a detail page, where there is room and the exact number is the point. */
  exact = false,
}: {
  amount: number;
  className?: string;
  locale?: string;
  exact?: boolean;
}): React.JSX.Element {
  const pathname = usePathname();
  const locale = propLocale ?? (pathname?.split('/')[2] === 'en' ? 'en' : 'ar');
  const full = formatLbp(amount, locale);
  const compacted = !exact && isCompactable(amount);
  const shown = compacted ? formatLbpCompact(amount, locale) : full;

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
