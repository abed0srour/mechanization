'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A titled card that folds away.
 *
 * Built on `<details>/<summary>` rather than a `useState` toggle: the open
 * state then lives in the DOM, so browser find-in-page can open a closed
 * section to reveal a match, the whole thing is keyboard-operable with no
 * `tabIndex`/`role` of ours, and it still renders open with JavaScript
 * disabled. A hand-rolled toggle gets none of that for free and gets the
 * `aria-expanded`/`aria-controls` pairing wrong roughly half the time.
 *
 * The animation is the one thing `<details>` cannot do alone — it snaps. A
 * grid-template-rows transition (0fr → 1fr) is what animates a panel of
 * *unknown* height without measuring it in JavaScript, and it degrades to a
 * snap where it is unsupported rather than breaking.
 */
export function CollapsibleSection({
  title,
  icon: Icon,
  summary,
  defaultOpen = true,
  children,
  className,
  id,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Shown in the header — the point of a closed section is what it still tells you. */
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <details
      id={id}
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      className={cn(
        'group scroll-mt-24 overflow-hidden rounded-xl border bg-card shadow-sm',
        className,
      )}
    >
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-3 p-5 transition-colors hover:bg-accent/50',
          // Safari still paints its own disclosure triangle without this.
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        <ChevronDown
          className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
          aria-hidden
        />
        {Icon ? <Icon className="size-5 shrink-0 text-primary" aria-hidden /> : null}
        <h2 className="min-w-0 flex-1 text-lg font-semibold">{title}</h2>
        {/* Survives the fold: a closed «الرسوم والمدفوعات» that still shows the
            balance is worth closing, one that shows nothing is not. */}
        {summary ? <div className="shrink-0 text-sm">{summary}</div> : null}
      </summary>

      {/*
        `grid-rows-[0fr]` → `[1fr]` animates a panel whose height nobody has
        measured. The inner `min-h-0 overflow-hidden` is required: without it
        the child refuses to shrink below its content height and the animation
        does nothing at all.
      */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t p-5">{children}</div>
        </div>
      </div>
    </details>
  );
}
