import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A placeholder for content that has not arrived.
 *
 * `DataTable` grew its own inline version of this for table rows; every other
 * screen in the portal showed nothing at all while it waited, so a slow
 * connection — which is the normal one for this audience — read as a broken
 * page rather than a loading one. One component now, used by both.
 *
 * `bg-muted` rather than a gradient sweep: the sweep animation is the part
 * that `prefers-reduced-motion` turns off, and a skeleton whose only signal is
 * the animation becomes an invisible grey box for the readers who most need
 * the page to explain itself. A pulse degrades to a static block that still
 * reads as "something goes here".
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      // Not `aria-hidden`: the region it fills is announced as busy by the
      // container, and hiding the shape too leaves a screen reader with an
      // empty page and no explanation.
      aria-hidden
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

/**
 * The skeleton shape a stat tile leaves behind.
 *
 * Kept beside the plain block because a tile is the one shape repeated often
 * enough that spelling out its three bars at every use site is how they drift
 * apart — and a row of four tiles whose placeholders differ in height is a
 * layout shift the moment the real numbers land.
 */
function SkeletonStat({ className }: { className?: string }): React.JSX.Element {
  return (
    <div className={cn('rounded-xl border bg-card p-4', className)}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-16" />
      <Skeleton className="mt-3 h-1.5 w-full" />
    </div>
  );
}

/** A block of body text: three bars of decreasing width. */
function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className="h-3.5"
          // The last line stops short, the way a paragraph's does. A stack of
          // equal full-width bars reads as a table, not as prose.
          style={{ width: index === lines - 1 ? '60%' : `${92 - index * 6}%` }}
        />
      ))}
    </div>
  );
}

export { Skeleton, SkeletonStat, SkeletonText };
