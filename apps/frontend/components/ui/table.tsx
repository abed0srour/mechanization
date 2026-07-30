import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Ported from the Albazourieh platform's shadcn/ui table, with one deliberate
 * departure: the reference wraps every `<table>` in its own
 * `overflow-auto` div. That is wrong wherever the caller already owns a scroll
 * container — the header's `sticky top-0` resolves against the *nearest*
 * scrolling ancestor, so an inner wrapper that never scrolls vertically
 * silently pins the header to nothing. `DataTable` supplies the single
 * scroll+border container; this stays a bare `<table>`.
 */
const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <table
    ref={ref}
    className={cn('w-full caption-bottom text-sm', className)}
    {...props}
  />
));
Table.displayName = 'Table';

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn('[&_tr:last-child]:border-0', className)}
    {...props}
  />
));
TableBody.displayName = 'TableBody';

/**
 * Hover is a primary tint rather than another step of `muted`: zebra striping
 * below already spends `muted`, and this palette resolves `accent` and `muted`
 * to the same colour — so a muted hover over a muted stripe is invisible.
 */
const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      'border-b transition-colors hover:bg-primary/10 data-[state=selected]:bg-primary/15',
      className,
    )}
    {...props}
  />
));
TableRow.displayName = 'TableRow';

/**
 * No `uppercase`/`tracking-wider` here, unlike most shadcn tables: this is an
 * Arabic-first UI, and Arabic is unicameral — the transform does nothing to a
 * header like "الرقم المرجعي" while letter-spacing actively breaks the
 * cursive joins.
 */
const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-11 whitespace-nowrap px-4 text-start align-middle text-xs font-semibold text-muted-foreground',
      className,
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn('px-4 py-3 align-middle', className)} {...props} />
));
TableCell.displayName = 'TableCell';

export { Table, TableHeader, TableBody, TableHead, TableRow, TableCell };
