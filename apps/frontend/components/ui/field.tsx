'use client';

import { createContext, useContext, useId } from 'react';
import { FileQuestion, X } from 'lucide-react';
import { isFlaggablePath, type FieldFlag } from '@mechanization/shared-schemas';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * The «غير مؤكَّد» controls, shared by every field on a form that offers them.
 *
 * A context rather than a prop threaded through `PersonalStep`, `ContactStep`,
 * `PropertyCard` and `UnitsEditor`: those four components render some fifty
 * fields between them, they are shared with the citizen-facing wizard which
 * offers no flagging at all, and a prop chain that long is one someone
 * eventually forgets to extend — leaving a field that cannot be flagged for no
 * reason anyone can see. With a context, a field opts in by naming its own
 * path, and a form opts in by providing one.
 */
interface FieldFlagApi {
  /** Flags in effect, keyed by dot-path. */
  flags: ReadonlyMap<string, string>;
  /** Raise or amend a flag. An empty reason is what the form refuses to save. */
  set: (path: string, reason: string) => void;
  /** Withdraw a flag — the field is answerable after all. */
  clear: (path: string) => void;
  locale: string;
}

const FieldFlagContext = createContext<FieldFlagApi | null>(null);

export function FieldFlagProvider({
  value,
  children,
}: {
  value: FieldFlagApi;
  children: React.ReactNode;
}) {
  return <FieldFlagContext.Provider value={value}>{children}</FieldFlagContext.Provider>;
}

/**
 * The flag controls, for the handful of things that are not a `Field`.
 *
 * A building's units editor is a repeatable section rather than one input, and
 * «لم نتمكن من جرد وحدات المبنى» is a real answer an officer needs to be able
 * to give. Returns null outside a provider, which is how the citizen wizard —
 * which offers no flagging — gets the section unchanged.
 */
export function useFieldFlags(): FieldFlagApi | null {
  return useContext(FieldFlagContext);
}

/** The flags as the wire wants them: an array, in the order fields appear. */
export function flagsToArray(flags: ReadonlyMap<string, string>): FieldFlag[] {
  return [...flags].map(([path, reason]) => ({ path, reason }));
}

export function flagsFromArray(flags: readonly FieldFlag[]): Map<string, string> {
  return new Map(flags.map((flag) => [flag.path, flag.reason]));
}

/**
 * One field, one job. The caption is the shared `Label`, so its typography is
 * the reference platform's; only the row layout that carries the required/
 * optional marker is added on top.
 *
 * `path` opts the field into «غير مؤكَّد». Given one — and rendered inside a
 * `FieldFlagProvider` — the caption grows a control that lets the officer say
 * they could not establish this value and why. Without it the field renders
 * exactly as it did, which is what the citizen wizard still gets.
 */
export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  path,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor: string;
  /** This field's dot-path — `personal.civilRecordNumber`, `properties.0.unitArea`. */
  path?: string;
  children: React.ReactNode;
}) {
  const flagging = useContext(FieldFlagContext);
  const reasonId = useId();

  // A path the schema will not accept a flag on renders as an ordinary field,
  // rather than offering a control whose every use would be rejected on save.
  const flaggable = Boolean(flagging && path && isFlaggablePath(path));
  const reason = flaggable && path ? flagging?.flags.get(path) : undefined;
  const flagged = reason !== undefined;
  const locale = flagging?.locale ?? 'ar';

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label
          htmlFor={htmlFor}
          className="flex items-baseline gap-1.5 text-xs font-medium text-foreground/90"
        >
          <span>{label}</span>
          {required ? (
            <span className="text-xs font-bold text-destructive" aria-label="حقل إلزامي">
              *
            </span>
          ) : (
            <span className="text-xs font-normal text-muted-foreground">
              {locale === 'en' ? '(optional)' : '(اختياري)'}
            </span>
          )}
        </Label>

        {flagged ? (
          <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning ring-1 ring-warning/30">
            <FileQuestion className="size-3" aria-hidden />
            <span>{locale === 'en' ? 'Unverified' : 'غير مؤكَّد'}</span>
          </span>
        ) : null}
      </div>

      {hint ? <p className="text-xs text-muted-foreground leading-normal">{hint}</p> : null}

      {/*
        A flagged field's input is replaced by the reason input.
      */}
      {flagged && path ? (
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <input
              id={reasonId}
              value={reason ?? ''}
              onChange={(event) => flagging?.set(path, event.target.value)}
              placeholder={
                locale === 'en'
                  ? 'Why is this missing? (required)...'
                  : 'سبب عدم توفّر هذه المعلومة (إلزامي)...'
              }
              className="flex h-10 w-full rounded-md border border-warning/50 bg-warning/5 px-3 py-2 text-xs text-foreground placeholder:text-warning/70 outline-none ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/50 focus-visible:ring-offset-2"
            />
          </div>
          <button
            type="button"
            onClick={() => flagging?.clear(path)}
            title={locale === 'en' ? 'Undo unverified status' : 'تراجع عن غير مؤكَّد'}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1 rounded-md border border-warning/40 bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning hover:bg-warning/25 transition-colors select-none"
          >
            <X className="size-3.5 shrink-0" aria-hidden />
            <span>{locale === 'en' ? 'Undo' : 'تراجع'}</span>
          </button>
        </div>
      ) : (
        children
      )}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Compact card-style choice for radio options.
 */
export function ChoiceCard({
  name,
  value,
  checked,
  onChange,
  title,
  description,
  icon: Icon,
  className,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-all select-none',
        checked
          ? 'border-primary/80 bg-primary/5 ring-1 ring-primary/40 shadow-2xs font-medium text-foreground'
          : 'border-border/80 bg-card hover:bg-muted/40 hover:border-border text-foreground/80',
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="size-4 shrink-0 accent-[hsl(var(--primary))]"
      />
      {Icon ? (
        <Icon
          className={cn(
            'size-4 shrink-0',
            checked ? 'text-primary' : 'text-muted-foreground',
          )}
          aria-hidden
        />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block text-xs sm:text-sm font-medium leading-tight">{title}</span>
        {description ? (
          <span className="block text-xs text-muted-foreground leading-normal mt-0.5">{description}</span>
        ) : null}
      </span>
    </label>
  );
}
