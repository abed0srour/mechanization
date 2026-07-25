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
  children: React.ReactNode;
}

export function Sheet({
  open,
  onClose,
  title,
  description,
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
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 h-full w-full cursor-default bg-black/50 animate-in fade-in"
        onClick={onClose}
      />
      <div
        className={cn(
          'relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto border-s bg-background shadow-xl',
          'animate-in slide-in-from-right duration-300',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b p-6">
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
        <div className="flex-1 p-6">{children}</div>
      </div>
    </div>
  );
}
