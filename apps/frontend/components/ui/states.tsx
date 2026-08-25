'use client';

import * as React from 'react';
import { Inbox, RefreshCw, TriangleAlert, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The three things a panel can be showing instead of its content: nothing yet,
 * nothing at all, or a failure.
 *
 * `DataTable` already draws all three for the rows it owns, and every screen
 * outside a table re-invented them — usually as a bare `<p>` of grey text, and
 * on the error path usually as nothing, since `logApiError` writes to the
 * console and the page keeps its stale content. These are the same three
 * states as one component so a card, a drawer and a chart panel answer "where
 * is my data" identically.
 */

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  /** What would put something here — not a restatement of the title. */
  description?: string;
  action?: React.ReactNode;
  className?: string;
  /** Tighter padding, for an empty state inside a card rather than a page. */
  compact?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        compact ? 'py-8' : 'py-14',
        className,
      )}
    >
      <span
        aria-hidden
        className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Icon className="size-6" />
      </span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description ? (
        // `max-w-sm`: a full-width line of centred text across a desktop table
        // is a paragraph the eye cannot track back to the start of.
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'تعذّر تحميل البيانات',
  description,
  onRetry,
  retryLabel = 'إعادة المحاولة',
  className,
  compact = false,
}: {
  title?: string;
  /** The server's own message, when there is one worth showing. */
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
  compact?: boolean;
}): React.JSX.Element {
  /*
   * A dropped connection is told apart from a server fault, because the two
   * have different remedies and only one of them is the reader's to apply.
   * `api-client.ts` already raises `NETWORK_ERROR` for a fetch that never
   * reached the server; matching its Arabic message here keeps the two in step
   * without this component importing the client.
   */
  const offline = description?.includes('تعذّر الاتصال') ?? false;
  const Icon = offline ? WifiOff : TriangleAlert;

  return (
    <div
      // `role="alert"` rather than a plain div: this replaces content the
      // reader was waiting for, and a screen reader gets no other signal that
      // the wait ended in a failure.
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        compact ? 'py-8' : 'py-14',
        className,
      )}
    >
      <span
        aria-hidden
        className="mb-3 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"
      >
        <Icon className="size-6" />
      </span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm break-words text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-4 gap-2" onClick={onRetry}>
          <RefreshCw className="size-4" />
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
