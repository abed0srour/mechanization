'use client';

import { HardDrive, Info, Loader2, Save, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { SettingsCopy } from '@/lib/settings-i18n';
import { cn } from '@/lib/utils';

/**
 * The shapes every settings section is built from.
 *
 * Six sections written independently is six card paddings, six save rows and
 * six ways of saying "not saved to the server yet". One set here is what makes
 * them read as one screen rather than six.
 */

/**
 * One labelled control.
 *
 * Not the shared `Field`, and the difference is the whole point: `Field` puts
 * its hint *between* the label and the input, which is right for the citizen
 * wizard — one column, hint read before answering — and wrong for a settings
 * grid. Two fields side by side where only one carries a hint get inputs at
 * different heights, and every row of this page had that. Hint below the input
 * keeps the controls on one baseline no matter which of them explain
 * themselves.
 *
 * It also drops `Field`'s «اختياري» marker. On a form a citizen files, knowing
 * which questions may be skipped matters; on a settings page nearly every field
 * is optional, so the marker lands on almost every label and stops meaning
 * anything. Required is marked instead, because there it is the exception.
 */
export function SettingsField({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <Label htmlFor={htmlFor} className="flex items-baseline gap-1.5">
        <span className="min-w-0">{label}</span>
        {required ? (
          <span className="text-sm font-semibold text-destructive" aria-label="required">
            *
          </span>
        ) : null}
      </Label>

      {children}

      {error ? (
        <p role="alert" className="text-sm leading-relaxed text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * A row of controls that stay on one baseline.
 *
 * `items-start` matters: a grid cell stretches by default, so a field whose
 * hint wraps to two lines would stretch its neighbours' wrappers and, with
 * `justify-between` anywhere below, push their inputs apart. Every settings
 * grid goes through here so that decision is made once.
 *
 * The breakpoints are the second reason this exists. `sm` is 640px — a phone in
 * landscape — and three inputs across it are 190px each, which is narrower than
 * the text most of them hold. Two columns arrive at `sm`, three at `md`, four
 * at `xl`, so a column is never below about 260px.
 */
export function SettingsGrid({
  columns = 2,
  children,
  className,
}: {
  columns?: 1 | 2 | 3 | 4;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid items-start gap-x-5 gap-y-5',
        columns === 2 && 'sm:grid-cols-2',
        columns === 3 && 'sm:grid-cols-2 md:grid-cols-3',
        columns === 4 && 'sm:grid-cols-2 xl:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * One titled block of related controls.
 *
 * The heading is an `<h3>`: the section owns the `<h2>`, so a settings page
 * read by heading level lists six sections each with its blocks under it,
 * rather than a flat run of twenty equal headings.
 *
 * Title and hint sit in one flex child *beside* the icon rather than the hint
 * being indented by a hard-coded `ps-[42px]` to clear it. That number was the
 * icon's width plus the gap, and it was wrong the moment either changed — and
 * wrong immediately on a narrow screen, where it stole 42px from a hint that
 * needed the width more than the alignment.
 */
export function SettingsCard({
  title,
  hint,
  icon: Icon,
  actions,
  children,
  className,
}: {
  title: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6',
        className,
      )}
    >
      <header className="flex flex-wrap items-start gap-x-3 gap-y-4">
        {Icon ? (
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
          >
            <Icon className="size-4" />
          </span>
        ) : null}

        {/*
          `basis-64` with `flex-1`: the title block takes the row on its own
          when the actions cannot fit beside it, instead of the two crushing
          each other into a pair of 150px columns on a phone.
        */}
        <div className="min-w-0 flex-1 basis-64 space-y-1">
          <h3 className="font-semibold leading-snug">{title}</h3>
          {hint ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{hint}</p>
          ) : null}
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:w-full">
            {actions}
          </div>
        ) : null}
      </header>

      <div className="mt-5 sm:mt-6">{children}</div>
    </section>
  );
}

/**
 * A standing caveat about a whole section.
 *
 * Placed at the top of a section, never beside its save button. A clerk who
 * configures an exchange rate and walks to another terminal expecting to find
 * it there has been misled by the interface, and the moment to prevent that is
 * before they type.
 */
export function Notice({
  tone = 'warning',
  title,
  children,
  className,
}: {
  tone?: 'warning' | 'info';
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const Icon = tone === 'warning' ? TriangleAlert : Info;
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border p-4 text-sm leading-relaxed',
        tone === 'warning'
          ? 'border-warning/30 bg-warning/5'
          : 'border-primary/25 bg-primary/5',
        className,
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          tone === 'warning' ? 'text-warning' : 'text-primary',
        )}
        aria-hidden
      />
      <div className="min-w-0">
        <p className={cn('font-semibold', tone === 'warning' ? 'text-warning' : 'text-primary')}>
          {title}
        </p>
        {children ? <div className="mt-0.5 text-muted-foreground">{children}</div> : null}
      </div>
    </div>
  );
}

/** Says a section is held in this browser rather than on the server. */
export function LocalOnlyNotice({ copy }: { copy: SettingsCopy }) {
  return (
    <Notice title={copy.common.notConnected}>
      <p className="flex items-start gap-2">
        <HardDrive className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {copy.common.notConnectedHint}
      </p>
    </Notice>
  );
}

/**
 * The save row that ends a section.
 *
 * Sticks to the bottom of the viewport while there is something to save. A
 * settings section runs past a screen, and a save button at the natural end of
 * the form is one an admin must scroll back to find after changing the field at
 * the top — which is how a change gets typed, admired, and abandoned.
 *
 * On a phone the buttons take the full width and the message sits above them:
 * two buttons and a sentence on one 360px row leaves each button about 90px,
 * which is under the comfortable target this portal's audience needs.
 */
export function SaveBar({
  copy,
  dirty,
  saving,
  onSave,
  onDiscard,
}: {
  copy: SettingsCopy;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (!dirty) return null;

  return (
    <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-2xl border border-border/70 bg-popover/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-popover/80 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">{copy.common.unsavedChanges}</p>
      <div className="flex items-center gap-2 max-sm:*:flex-1">
        <Button variant="ghost" onClick={onDiscard} disabled={saving}>
          {copy.common.discard}
        </Button>
        <Button onClick={onSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {copy.common.saving}
            </>
          ) : (
            <>
              <Save className="size-4" aria-hidden />
              {copy.common.save}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

/**
 * A table that scrolls rather than crushes.
 *
 * `overflow-x-auto` alone does nothing without a floor: the table shrinks to
 * whatever space it is given, so five columns on a 360px screen become five
 * 70px columns of wrapped single characters instead of a scrollable table. The
 * min-width is what turns squashing into scrolling.
 */
export function ScrollableTable({
  minWidth = '44rem',
  children,
}: {
  minWidth?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <div style={{ minWidth }}>{children}</div>
    </div>
  );
}
