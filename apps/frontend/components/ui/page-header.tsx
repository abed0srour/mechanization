import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * One page heading, everywhere.
 *
 * Every admin screen had grown its own header — the same tinted icon tile,
 * title, subtitle and action row, re-typed with slightly different sizes and
 * gaps each time. Pulling it into one component is what makes «المواطنون» and
 * «إدارة الرسوم» look like the same product rather than two that happen to
 * share a sidebar.
 *
 * `actions` is pushed to the far edge with `ms-auto` rather than the row using
 * `justify-between`: the header has two children at some widths and three at
 * others, and only the actions should ever be flung to the end.
 */
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3 border-b pb-6', className)}>
      <span
        aria-hidden
        className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        {/*
          Wraps on a phone, truncates from `sm` up.

          `truncate` at every width clipped «تسجيل مواطن جديد» to «تسجيل مواطن
          ج…» on a 390px screen — the page's own name, cut mid-word, at the
          one width where the reader has the least other context about where
          they are. Two lines cost less than that. From `sm` there is room for
          the full title anyway, and truncation goes back to being the guard
          against an unusually long one.
        */}
        <h1 className="text-xl font-bold leading-tight tracking-tight sm:truncate md:text-2xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="ms-auto flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
