'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A lightweight slide-over sheet — a self-contained alternative to the
 * shadcn/Radix Dialog that needs no extra dependency. It anchors to the
 * inline-end edge (so it slides in from the right in LTR and the left in
 * RTL), locks body scroll while open, and closes on overlay click or the
 * Escape key.
 */
interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /**
   * Which physical edge the panel is pinned to.
   *
   * `inline-end` is the default and follows text direction — right in LTR,
   * left in RTL — which is what a form's contextual panel should do. `left`
   * and `right` are absolute and ignore direction: the map drawer is pinned
   * physically left in both locales, because it is anchored to the map canvas
   * behind it rather than to the reading order.
   */
  side?: 'inline-end' | 'left' | 'right';
  /** Rendered under the header, outside the scrolling body — e.g. a footer bar. */
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  side = 'inline-end',
  footer,
  className,
  children,
}: SheetProps): React.JSX.Element | null {
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex',
        side === 'left' ? 'justify-start' : side === 'right' ? 'justify-end' : 'justify-end',
      )}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 h-full w-full cursor-default bg-black/50 animate-in fade-in"
        onClick={onClose}
      />
      <div
        className={cn(
          'relative z-10 flex h-full w-full max-w-md flex-col bg-background shadow-xl',
          side === 'left'
            ? 'border-e animate-in slide-in-from-left'
            : side === 'right'
              ? 'border-s animate-in slide-in-from-right'
              : // Direction-aware: `slide-in-from-right` is physical, so RTL
                // would otherwise animate the panel in from the far edge.
                'border-s animate-in slide-in-from-right rtl:slide-in-from-left',
          'duration-300',
          className,
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b p-6">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">{title}</h2>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Only the body scrolls, so a long co-owner list never pushes the
            header or the footer action out of reach. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>

        {footer ? <div className="shrink-0 border-t p-4">{footer}</div> : null}
      </div>
    </div>
  );
}
