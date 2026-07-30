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
    <div className="space-y-2">
      <Label htmlFor={htmlFor} className="flex items-baseline gap-2">
        <span>{label}</span>
        {required ? (
          <span className="text-sm font-semibold text-destructive" aria-label="حقل إلزامي">
            *
          </span>
        ) : (
          <span className="text-sm font-normal text-muted-foreground">اختياري</span>
        )}
      </Label>

      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}

      {children}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Large card-style choice, used instead of a dropdown wherever there are four
 * or fewer options: a native select is a poor target on a phone held by someone
 * with limited dexterity.
 */
export function ChoiceCard({
  name,
  value,
  checked,
  onChange,
  title,
  description,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  title: string;
  description?: string;
}) {
  return (
    <label
      className={cn(
        'flex min-h-touch cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors',
        checked
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-input bg-background hover:bg-accent',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="h-5 w-5 accent-[hsl(var(--primary))]"
      />
      <span>
        <span className="block font-medium">{title}</span>
        {description ? (
          <span className="block text-sm text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </label>
  );
}
