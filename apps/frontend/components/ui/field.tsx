'use client';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * One field, one job. The caption is the shared `Label`, so its typography is
 * the reference platform's; only the row layout that carries the required/
 * optional marker is added on top.
 */
export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="flex items-baseline gap-1.5 text-xs font-medium text-foreground/90">
        <span>{label}</span>
        {required ? (
          <span className="text-xs font-bold text-destructive" aria-label="حقل إلزامي">
            *
          </span>
        ) : (
          <span className="text-xs font-normal text-muted-foreground">(اختياري)</span>
        )}
      </Label>

      {hint ? <p className="text-xs text-muted-foreground leading-normal">{hint}</p> : null}

      {children}

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
