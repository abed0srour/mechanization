'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * One stage of a screen that is really a procedure.
 *
 * The `id` is both the anchor the rail scrolls to and the key the section
 * renders under, so a rail entry can never point at a heading that does not
 * exist — the same single-source trick `CitizenForm`'s `SECTIONS` uses.
 */
export interface WorkflowStep<Id extends string = string> {
  id: Id;
  /** Arabic-Indic numeral for the chip — ١، ٢، ٣. */
  step: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Shown as a pill beside the title; `0` and `undefined` render nothing. */
  count?: number;
  /**
   * Marks a count as *someone waiting on us* rather than merely a total.
   * Raises the pill to the warning tone so a queue that has grown is visible
   * from the top of the page without scrolling to the section that holds it.
   */
  urgent?: boolean;
}

/**
 * The sticky step rail.
 *
 * A procedure laid out down a page loses the one thing a wizard gives for
 * free: the sense that these parts happen *in an order*, and that you are
 * somewhere in it. The rail restores that without taking away the ability to
 * look at two stages at once — the numerals and the connectors say "first,
 * then, then", while every section stays on the page underneath.
 *
 * The caller owns `active`/`onJump` (from `useSectionNav`) because the same
 * rail serves screens whose chips carry different extra state.
 */
export function WorkflowRail<Id extends string>({
  steps,
  active,
  onJump,
  label = 'مراحل العمل',
}: {
  steps: readonly WorkflowStep<Id>[];
  active: Id;
  onJump: (id: Id) => void;
  label?: string;
}) {
  const activeIndex = steps.findIndex((step) => step.id === active);

  return (
    <nav
      aria-label={label}
      className="sticky top-0 z-20 -mx-4 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      <ol className="flex flex-wrap items-center gap-y-2">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isActive = step.id === active;
          // Everything above the current stage reads as already walked past —
          // it is the only cue that keeps four equal-looking chips from being
          // four unrelated tabs.
          const passed = index < activeIndex;
          const showCount = typeof step.count === 'number' && step.count > 0;

          return (
            <React.Fragment key={step.id}>
              {index > 0 ? (
                <li
                  aria-hidden
                  className={cn(
                    'mx-1 hidden h-px w-5 shrink-0 sm:block',
                    passed || isActive ? 'bg-primary/40' : 'bg-border',
                  )}
                />
              ) : null}
              <li>
                <button
                  type="button"
                  onClick={() => onJump(step.id)}
                  aria-current={isActive ? 'step' : undefined}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-primary bg-primary text-primary-foreground'
                      : passed
                        ? 'border-primary/30 bg-primary/5 text-foreground hover:bg-accent'
                        : 'border-transparent bg-muted/60 text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-5 items-center justify-center rounded text-xs font-semibold',
                      isActive ? 'bg-primary-foreground/20' : 'bg-background/70',
                    )}
                  >
                    {step.step}
                  </span>
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="whitespace-nowrap">{step.title}</span>
                  {showCount ? (
                    <span
                      className={cn(
                        'rounded-full px-1.5 text-xs font-semibold tabular-nums',
                        isActive
                          ? 'bg-primary-foreground/20'
                          : step.urgent
                            ? 'bg-warning/20 text-warning'
                            : 'bg-background/70 text-muted-foreground',
                      )}
                    >
                      {step.count}
                    </span>
                  ) : null}
                </button>
              </li>
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * One stage's card.
 *
 * The numbered chip is the section's half of the rail: a clerk who scrolled
 * here rather than clicking still sees which stage they landed in. `actions`
 * sits in the header rather than above the list because the button that acts
 * on a stage belongs to the stage, not to the page.
 */
export function WorkflowSection({
  id,
  step,
  icon: Icon,
  title,
  description,
  actions,
  attention,
  contentClassName,
  children,
}: {
  id: string;
  step: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  actions?: React.ReactNode;
  /** Raises the whole card — used when a queue is holding someone up. */
  attention?: boolean;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      id={id}
      // Clears the sticky rail: without it `scrollIntoView` puts this heading
      // underneath the bar that was just used to reach it.
      className={cn(
        'scroll-mt-24 overflow-hidden',
        attention && 'border-warning/50 ring-1 ring-warning/20',
      )}
    >
      <CardHeader className="flex-col gap-4 space-y-0 border-b md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-lg ring-1',
              attention
                ? 'bg-warning/10 text-warning ring-warning/20'
                : 'bg-primary/10 text-primary ring-primary/20',
            )}
          >
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <span
                aria-hidden
                className="rounded-md bg-secondary px-1.5 py-0.5 text-sm font-semibold text-secondary-foreground"
              >
                {step}
              </span>
              {title}
            </h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </CardHeader>
      <CardContent className={cn('pt-6', contentClassName)}>{children}</CardContent>
    </Card>
  );
}

/**
 * What a stage says when it has nothing in it.
 *
 * A bare line of grey text reads as a screen that failed to load. An icon and
 * a sentence that names the *reason* the list is empty reads as an answer.
 */
export function WorkflowEmpty({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span
        aria-hidden
        className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Icon className="size-6" />
      </span>
      <p className="font-medium">{title}</p>
      {hint ? <p className="max-w-sm text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
