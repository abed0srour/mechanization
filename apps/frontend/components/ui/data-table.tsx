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
    /** Extra classes applied to this column's `<th>` (e.g. fixed width). */
    headerClassName?: string;
    /** Extra classes applied to this column's `<td>` cells. */
    cellClassName?: string;
  }
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const DEFAULT_SEARCH_DEBOUNCE_MS = 300;

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
  /** Fires after the debounce window with the committed search term. */
  onSearchChange?: (value: string) => void;
  searchDebounceMs?: number;

  /**
   * Server-driven mode: pagination, sorting and filtering are computed by
   * the caller (typically a paginated API) instead of in the browser.
   * `pageCount` and the `on*Change` handlers become required in spirit —
   * omitting them just freezes that dimension.
   */
  manual?: boolean;
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
  searchDebounceMs = DEFAULT_SEARCH_DEBOUNCE_MS,
  manual = false,
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

  // Search box shows every keystroke instantly; the committed value
  // (which drives filtering / API calls) only updates after the
  // debounce window, so neither a slow backend nor a large in-memory
  // table re-renders on every keypress.
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

  React.useEffect(() => {
    if (searchInput === committedSearch) return;
    const handle = setTimeout(() => commitSearch(searchInput), searchDebounceMs);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, searchDebounceMs]);

  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: {
      pagination,
      sorting,
      globalFilter: committedSearch,
    },
    manualPagination: manual,
    manualSorting: manual,
    manualFiltering: manual,
    pageCount: manual ? (pageCount ?? -1) : undefined,
    onPaginationChange: onPaginationChange ?? setInternalPagination,
    onSortingChange: onSortingChange ?? setInternalSorting,
    onGlobalFilterChange: (updater) => {
      const next =
        typeof updater === 'function' ? updater(committedSearch) : updater;
      commitSearch(next ?? '');
    },
    getRowCanExpand,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: manual ? undefined : getFilteredRowModel(),
    getSortedRowModel: manual ? undefined : getSortedRowModel(),
    getPaginationRowModel: manual ? undefined : getPaginationRowModel(),
    getExpandedRowModel: renderSubRow ? getExpandedRowModel() : undefined,
  });

  const rows = table.getRowModel().rows;
  const resolvedTotal = totalRowCount ?? data.length;
  const resolvedPageCount = table.getPageCount();
  const currentPage = pagination.pageIndex + 1;
  const hasSearchTerm = committedSearch.trim().length > 0;
  const columnCount = columns.length;

  const skeletonRows = (
    <TableBody>
      {Array.from({ length: Math.min(pagination.pageSize, 8) }, (_, row) => (
        <TableRow key={row}>
          {Array.from({ length: columnCount }, (_, col) => (
            <TableCell key={col} className="py-4">
              <div className="h-4 animate-pulse rounded bg-muted" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );

  return (
    <div className={cn('space-y-4', className)}>
      {searchable || toolbar ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {searchable ? (
            <div className="relative w-full sm:max-w-md">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                role="searchbox"
                aria-label={labels.searchAriaLabel}
                className="h-10 ps-9 pe-9"
                placeholder={labels.searchPlaceholder}
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
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
        <div className="flex flex-col items-center gap-3 rounded-lg border p-12 text-center">
          <TriangleAlert className="h-8 w-8 text-destructive" />
          <p className="text-destructive">{labels.loadError}</p>
          {onRetry ? (
            <Button variant="outline" onClick={onRetry}>
              {labels.retry}
            </Button>
          ) : null}
        </div>
      ) : !loading && rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border p-14 text-center">
          {emptyIcon ?? <FileSearch className="h-10 w-10 text-muted-foreground/60" />}
          <p className="font-medium text-muted-foreground">
            {hasSearchTerm ? labels.emptySearch : labels.empty}
          </p>
        </div>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted/60 shadow-[inset_0_-1px_0_hsl(var(--border))] backdrop-blur supports-[backdrop-filter]:bg-muted/50">
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
                    return (
                      <TableHead
                        key={header.id}
                        scope="col"
                        aria-sort={ariaSort}
                        className={header.column.columnDef.meta?.headerClassName}
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="-ms-2 inline-flex items-center gap-1.5 rounded px-2 py-1 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                      className={row.index % 2 === 1 ? 'bg-muted/25' : undefined}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={cell.column.columnDef.meta?.cellClassName}
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

      {/* Pagination + page-size footer */}
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={loading || currentPage <= 1}
            onClick={() => table.previousPage()}
          >
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
            {labels.previous}
          </Button>
          <span className="text-sm font-medium tabular-nums">
            {fillTemplate(labels.pageOf, {
              current: currentPage,
              total: Math.max(resolvedPageCount, 1),
            })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || currentPage >= resolvedPageCount}
            onClick={() => table.nextPage()}
          >
            {labels.next}
            <ChevronRight className="h-4 w-4 rtl:rotate-180" />
          </Button>
        </div>
      </div>
    </div>
  );
}
