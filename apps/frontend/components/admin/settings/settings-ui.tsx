'use client';

import { HardDrive, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SettingsCopy } from '@/lib/settings-i18n';
import { cn } from '@/lib/utils';

/**
 * The three shapes every settings section is built from.
 *
 * Six sections written independently is six slightly different card paddings,
 * six save buttons in six positions, and six ways of saying "this is not saved
 * to the server yet". One set here is what makes them read as one screen.
 */

/**
 * One titled block of related controls.
 *
 * The heading is an `<h3>` because the section itself owns the `<h2>` — a
 * settings page read by heading level should list six sections, each with its
 * blocks under it, rather than a flat run of eighteen equal headings.
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
    <section className={cn('rounded-2xl border border-border/70 bg-card p-6 shadow-sm', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="flex items-center gap-2.5 font-semibold">
            {Icon ? (
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
              >
                <Icon className="size-4" />
              </span>
            ) : null}
            {title}
          </h3>
          {hint ? (
            <p className={cn('text-sm leading-relaxed text-muted-foreground', Icon && 'ps-[42px]')}>
              {hint}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>

      <div className="mt-6">{children}</div>
    </section>
  );
}

/**
 * Says a section is held in the browser rather than on the server.
 *
 * Deliberately stated at the top of the section and not tucked beside the save
 * button. A clerk who configures an exchange rate and walks to another terminal
 * expecting to find it there has been misled by the interface, and the moment
 * to prevent that is before they type, not after they save.
 */
export function LocalOnlyNotice({ copy }: { copy: SettingsCopy }) {
  return (
    <p className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm leading-relaxed">
      <HardDrive className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <span>
        <span className="font-semibold text-warning">{copy.common.notConnected}</span>
        <span className="mt-0.5 block text-muted-foreground">
          {copy.common.notConnectedHint}
        </span>
      </span>
    </p>
  );
}

/**
 * The save row that ends a section.
 *
 * Sticks to the bottom of the viewport while there is something to save. A
 * settings section runs past a screen, and a save button at the natural end of
 * the form is a button an admin has to scroll back to find after changing the
 * one field at the top — which is how a change gets typed, admired, and
 * abandoned unsaved.
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
    <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-popover/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-popover/80">
      <p className="text-sm text-muted-foreground">{copy.common.unsavedChanges}</p>
      <div className="flex items-center gap-2">
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
