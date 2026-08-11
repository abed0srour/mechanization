'use client';

import * as React from 'react';
import {
  ColumnDef,
  OnChangeFn,
  PaginationState,
  Row,
  SortingState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  FileSearch,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Button } from './button';
import { Input } from './input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './table';
import { cn } from '@/lib/utils';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    /**
     * Which edge this column's contents sit against — **header and cells
     * together**.
     *
     * One knob rather than a class on each, because the two drifting apart is
     * the failure this replaces: a column whose cells were given `text-end`
     * while its `<th>` kept the default put the heading at one edge of the
     * column and every value at the other, so nothing lined up under its own
     * label. Alignment is a property of the column, so it is declared once.
     *
     * Logical, not physical: `start` is the right edge in this RTL portal and
     * the left in an LTR one, which is what keeps a single set of column
     * definitions correct in both.
     */
    align?: 'start' | 'end' | 'center';
    /** Extra classes applied to this column's `<th>` (e.g. fixed width). */
    headerClassName?: string;
    /** Extra classes applied to this column's `<td>` cells. */
    cellClassName?: string;
  }
}

/** Text alignment per `meta.align`, applied to both `<th>` and `<td>`. */
const ALIGN_TEXT = {
  start: 'text-start',
  end: 'text-end',
  center: 'text-center',
} as const;

/**
 * How the header's inner row distributes itself.
 *
 * A sortable heading is a flex button (label + sort glyph), so `text-*` alone
 * does not move it — it needs a justification to match, or an end-aligned
 * column's heading stays at the start while its values sit at the end.
 */
const ALIGN_JUSTIFY = {
  start: 'justify-start',
  end: 'justify-end',
  center: 'justify-center',
} as const;

/** 10 first, so it is the default every table opens on. */
const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

/**
 * `{count} طلب` + `{count: 12}` -> `12 طلب`. Keeps pluralisable copy in the
 * labels object rather than concatenated at the use site.
 */
function fillTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

export interface DataTableLabels {
  searchAriaLabel: string;
  searchPlaceholder: string;
  clearSearch: string;
  empty: string;
  emptySearch: string;
  loadError: string;
  retry: string;
  previous: string;
  next: string;
  /** Template with a `{current}` and `{total}` placeholder. */
  pageOf: string;
  rowsPerPage: string;
  /** Template with a `{count}` placeholder. */
  totalRows: string;
  sortAscending: string;
  sortDescending: string;
  sortNone: string;
}

export interface DataTableProps<TData, TValue = unknown> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  labels: DataTableLabels;
  getRowId?: (row: TData, index: number) => string;

  /** Set to false to hide the built-in search box entirely. */
  searchable?: boolean;
  /** Controlled search value — required in `manual` mode. */
  searchValue?: string;
  /** Fires with the committed term — on Enter, or when the box is emptied. */
  onSearchChange?: (value: string) => void;

  /**
   * Server-driven mode: pagination, sorting and filtering are computed by
   * the caller (typically a paginated API) instead of in the browser.
   * `pageCount` and the `on*Change` handlers become required in spirit —
   * omitting them just freezes that dimension.
   *
   * Shorthand for all three flags below. Kept because most callers that want
   * one want all three: once a page is a slice of a larger set, sorting and
   * filtering it in the browser would only ever reorder that slice.
   */
  manual?: boolean;
  /**
   * The three axes, separately.
   *
   * They were one flag, and that made a common case unreachable: a table whose
   * *rows* come from a paginated API but whose search box is the browser's, or
   * the reverse. Turning on the shared flag to move one axis silently switched
   * off the row models for the other two — a table that looked fine with 8 rows
   * and lost its pagination entirely at 200.
   *
   * Each defaults to `manual`, so existing callers behave exactly as before.
   */
  manualPagination?: boolean;
  manualSorting?: boolean;
  manualFiltering?: boolean;
  /**
   * Turns every column's sort control off.
   *
   * For a server-paginated table whose endpoint cannot sort: re-ordering the
   * rows currently in hand looks like sorting the table and is not — it sorts
   * one page of many. Hiding the affordance is honest; leaving it is a control
   * that lies about what it did.
   */
  sortable?: boolean;
  pageCount?: number;
  /** Total row count across all pages — falls back to `data.length`. */
  totalRowCount?: number;
  pagination?: PaginationState;
  onPaginationChange?: OnChangeFn<PaginationState>;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  pageSizeOptions?: readonly number[];

  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;

  /** Extra filter controls rendered alongside the search box. */
  toolbar?: React.ReactNode;

  /** Renders an expandable sub-row's content (e.g. an evidence gallery). */
  renderSubRow?: (row: Row<TData>) => React.ReactNode;
  getRowCanExpand?: (row: Row<TData>) => boolean;

  className?: string;
  emptyIcon?: React.ReactNode;
}

/**
 * General-purpose admin table: client- or server-driven pagination, page
 * size selection, single-input search and column sorting, built on
 * TanStack Table. Search input, loading skeleton, error and empty states
 * are all handled here so feature panels only supply columns + data.
 */
export function DataTable<TData, TValue = unknown>({
  columns,
  data,
  labels,
  getRowId,
  searchable = true,
  searchValue,
  onSearchChange,
  manual = false,
  manualPagination = manual,
  manualSorting = manual,
  manualFiltering = manual,
  sortable = true,
  pageCount,
  totalRowCount,
  pagination: controlledPagination,
  onPaginationChange,
  sorting: controlledSorting,
  onSortingChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  loading = false,
  error = null,
  onRetry,
  toolbar,
  renderSubRow,
  getRowCanExpand,
  className,
  emptyIcon,
}: DataTableProps<TData, TValue>): React.JSX.Element {
  // Uncontrolled fallbacks so the table works fully client-side out of
  // the box; callers only need to pass `manual` + the controlled props
  // once pagination/sorting/search are driven by a server.
  const [internalPagination, setInternalPagination] =
    React.useState<PaginationState>({ pageIndex: 0, pageSize: pageSizeOptions[0] ?? 20 });
  const [internalSorting, setInternalSorting] = React.useState<SortingState>([]);
  const [internalGlobalFilter, setInternalGlobalFilter] = React.useState('');

  const pagination = controlledPagination ?? internalPagination;
  const sorting = controlledSorting ?? internalSorting;

  // Two values, deliberately: the box shows every keystroke, while the
  // committed term — the one that filters, or is sent to the API — changes
  // only when the reader asks for it with Enter. Neither a slow backend nor a
  // large in-memory table is touched while someone is still typing a name.
  const committedSearch = searchValue ?? internalGlobalFilter;
  const [searchInput, setSearchInput] = React.useState(committedSearch);
  const searchInputRef = React.useRef(searchInput);
  searchInputRef.current = searchInput;

  // Keep the visible input in sync if the committed value changes from
  // outside (e.g. a "clear filters" action elsewhere on the page).
  React.useEffect(() => {
    setSearchInput(committedSearch);
  }, [committedSearch]);

  const commitSearch = React.useCallback(
    (value: string) => {
      if (onSearchChange) {
        onSearchChange(value);
      } else {
        setInternalGlobalFilter(value);
      }
      // Any new search term restarts from the first page. Bailing out
      // when already on page 0 preserves the state reference, so callers
      // relying on it as a `useCallback`/`useEffect` dependency don't
      // see a spurious change.
      const resetPage = (previous: PaginationState): PaginationState =>
        previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 };
      if (onPaginationChange) {
        onPaginationChange(resetPage);
      } else {
        setInternalPagination(resetPage);
      }
    },
    [onSearchChange, onPaginationChange],
  );

  /*
   * Typing no longer searches; Enter does.
   *
   * The box used to fire on a timer after every keystroke, which meant a
   * ten-character name was one query if you typed it quickly and three or four
   * if you paused — each one a full round trip, each one replacing the results
   * under a reader's eyes mid-scan. Committing on Enter makes the request
   * something the clerk asks for, so a search costs exactly one query and the
   * table only moves when they meant it to.
   *
   * Clearing the box is the one exception: emptying a filter is unambiguous and
   * nobody presses Enter to say "show everything again".
   */

  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: {
      pagination,
      sorting,
      globalFilter: committedSearch,
    },
    enableSorting: sortable,
    manualPagination,
    manualSorting,
    manualFiltering,
    // `-1` means "unknown page count"; TanStack then trusts `pageCount` only
    // when the caller supplies one, and leaves next/previous enabled otherwise.
    pageCount: manualPagination ? (pageCount ?? -1) : undefined,
    onPaginationChange: onPaginationChange ?? setInternalPagination,
    onSortingChange: onSortingChange ?? setInternalSorting,
    onGlobalFilterChange: (updater) => {
      const next =
        typeof updater === 'function' ? updater(committedSearch) : updater;
      commitSearch(next ?? '');
    },
    getRowCanExpand,
    getCoreRowModel: getCoreRowModel(),
    // Each row model is dropped only for the axis the server owns. Dropping
    // all three because one moved is what previously left a server-paginated
    // table unsortable and unpaged at the same time.
    getFilteredRowModel: manualFiltering ? undefined : getFilteredRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getPaginationRowModel: manualPagination ? undefined : getPaginationRowModel(),
    getExpandedRowModel: renderSubRow ? getExpandedRowModel() : undefined,
  });

  const rows = table.getRowModel().rows;
  const resolvedTotal = totalRowCount ?? data.length;
  const resolvedPageCount = table.getPageCount();
  const currentPage = pagination.pageIndex + 1;
  const hasSearchTerm = committedSearch.trim().length > 0;
  const columnCount = columns.length;

  // Varied bar widths, cycled deterministically by column. A grid of
  // identical full-width bars reads as a broken layout; an uneven one reads
  // as text that has not arrived yet, which is what this is.
  const skeletonRows = (
    <TableBody>
      {Array.from({ length: Math.min(pagination.pageSize, 8) }, (_, row) => (
        <TableRow key={row} className="hover:bg-transparent">
          {Array.from({ length: columnCount }, (_, col) => (
            <TableCell key={col}>
              <div
                className="h-4 animate-pulse rounded bg-muted"
                style={{ width: `${[70, 90, 55, 80, 45, 65][(row + col) % 6]}%` }}
              />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );

  return (
    /*
      One bordered card holding the toolbar, the rows and the footer, rather
      than three stacked blocks with gaps between them. The controls belong to
      the table they act on, and a search box floating above an unrelated
      rounded rectangle reads as page furniture instead.
    */
    <div className={cn('overflow-hidden rounded-lg border bg-card', className)}>
      {searchable || toolbar ? (
        <div className="flex flex-col gap-3 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
          {searchable ? (
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                role="searchbox"
                aria-label={labels.searchAriaLabel}
                className="h-10 ps-9 pe-9"
                placeholder={labels.searchPlaceholder}
                value={searchInput}
                onChange={(event) => {
                  const next = event.target.value;
                  setSearchInput(next);
                  // Emptying the box applies straight away. It is unambiguous,
                  // and it also covers the native clear button WebKit renders
                  // inside `type="search"` — which would otherwise leave a
                  // blank field still filtering by the previous term.
                  if (next === '' && committedSearch !== '') commitSearch('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitSearch(searchInput.trim());
                  }
                }}
              />
              {searchInput ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('');
                    commitSearch('');
                  }}
                  aria-label={labels.clearSearch}
                  className="absolute end-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ) : null}
          {toolbar ? <div className="flex flex-wrap gap-2">{toolbar}</div> : null}
        </div>
      ) : null}

      {error ? (
        <div className="flex flex-col items-center gap-3 p-12 text-center">
          <TriangleAlert className="h-8 w-8 text-destructive" />
          <p className="text-destructive">{labels.loadError}</p>
          {onRetry ? (
            <Button variant="outline" onClick={onRetry}>
              {labels.retry}
            </Button>
          ) : null}
        </div>
      ) : !loading && rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 p-14 text-center">
          {emptyIcon ?? <FileSearch className="h-10 w-10 text-muted-foreground/60" />}
          <p className="font-medium text-muted-foreground">
            {hasSearchTerm ? labels.emptySearch : labels.empty}
          </p>
        </div>
      ) : (
        // The single scroll container for both axes — `overflow-x` for a wide
        // row of action buttons, `overflow-y` under `max-h` for a long page.
        // `Table` deliberately adds no wrapper of its own; see table.tsx.
        // No border of its own now: the card around the whole component draws
        // it, and the toolbar and footer supply the horizontal rules.
        <div className="max-h-[70vh] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted/95 shadow-[inset_0_-1px_0_hsl(var(--border))] backdrop-blur supports-[backdrop-filter]:bg-muted/80">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sortState = header.column.getIsSorted();
                    const ariaSort =
                      sortState === 'asc'
                        ? 'ascending'
                        : sortState === 'desc'
                          ? 'descending'
                          : canSort
                            ? 'none'
                            : undefined;
                    const align = header.column.columnDef.meta?.align ?? 'start';
                    return (
                      <TableHead
                        key={header.id}
                        scope="col"
                        aria-sort={ariaSort}
                        className={cn(
                          ALIGN_TEXT[align],
                          header.column.columnDef.meta?.headerClassName,
                        )}
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className={cn(
                              'inline-flex w-full items-center gap-1.5 rounded px-2 py-1 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              ALIGN_JUSTIFY[align],
                              // Pulls the button's own padding back so the
                              // label sits flush with the cells beneath it
                              // rather than inset by 8px — on whichever side
                              // this column is aligned to.
                              align === 'end' ? '-me-2' : align === 'start' ? '-ms-2' : '',
                            )}
                            title={
                              sortState === 'asc'
                                ? labels.sortDescending
                                : sortState === 'desc'
                                  ? labels.sortNone
                                  : labels.sortAscending
                            }
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {sortState === 'asc' ? (
                              <ArrowUp className="h-3.5 w-3.5" />
                            ) : sortState === 'desc' ? (
                              <ArrowDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />
                            )}
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            {loading && rows.length === 0 ? (
              skeletonRows
            ) : (
              <TableBody className={loading ? 'opacity-60 transition-opacity' : ''}>
                {rows.map((row) => (
                  <React.Fragment key={row.id}>
                    <TableRow
                      data-state={row.getIsExpanded() ? 'selected' : undefined}
                      // Zebra stays on `muted` and hover on `primary` so the
                      // two never compete on the same grey — hovering a
                      // striped row is a hue change, not a shade nudge.
                      className={row.index % 2 === 1 ? 'bg-muted/30' : undefined}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            ALIGN_TEXT[cell.column.columnDef.meta?.align ?? 'start'],
                            cell.column.columnDef.meta?.cellClassName,
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                    {renderSubRow && row.getIsExpanded() ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={columnCount} className="bg-muted/30">
                          {renderSubRow(row)}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </React.Fragment>
                ))}
              </TableBody>
            )}
          </Table>
        </div>
      )}

      {/* Pagination + page-size footer, inside the card and ruled off from the
          rows above it. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t p-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{labels.rowsPerPage}</span>
          <Select
            value={String(pagination.pageSize)}
            onValueChange={(value) => {
              const pageSize = Number(value);
              if (onPaginationChange) {
                onPaginationChange({ pageIndex: 0, pageSize });
              } else {
                setInternalPagination({ pageIndex: 0, pageSize });
              }
            }}
          >
            <SelectTrigger className="h-8 w-[80px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="whitespace-nowrap">
            {fillTemplate(labels.totalRows, { count: resolvedTotal })}
          </span>
        </div>
        {/* Square icon buttons rather than labelled ones: with the position
            spelled out beside them, «السابق»/«التالي» repeat what the reader
            has just been told and crowd the row on a phone. The labels survive
            as `aria-label` and `title`, so nothing is lost to a screen reader
            or a hover. */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium tabular-nums text-muted-foreground">
            {fillTemplate(labels.pageOf, {
              current: currentPage,
              total: Math.max(resolvedPageCount, 1),
            })}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={labels.previous}
            title={labels.previous}
            disabled={loading || currentPage <= 1}
            onClick={() => table.previousPage()}
          >
            <ChevronRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={labels.next}
            title={labels.next}
            disabled={loading || currentPage >= resolvedPageCount}
            onClick={() => table.nextPage()}
          >
            <ChevronLeft className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" />
          </Button>
        </div>
      </div>
    </div>
  );
}
