'use client';

import { cn } from '@/lib/utils';

/**
 * One field, one job. The required marker is a stamp glyph rather than a bare
 * asterisk so it reads as "this must be filled" even to someone who has never
 * used a web form.
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
      <label htmlFor={htmlFor} className="flex items-baseline gap-2 font-medium">
        <span>{label}</span>
        {required ? (
          <span className="text-sm font-bold text-seal" aria-label="حقل إلزامي">
            إلزامي
          </span>
        ) : (
          <span className="text-sm text-muted">اختياري</span>
        )}
      </label>

      {hint ? <p className="text-sm text-muted">{hint}</p> : null}

      {children}

      {error ? (
        <p role="alert" className="border-e-4 border-seal bg-seal/5 px-3 py-2 text-sm text-seal">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const inputClass = (hasError?: boolean) =>
  cn(
    'w-full rounded-card border-2 bg-card px-4 text-lg',
    'min-h-touch', // 48px minimum target
    hasError ? 'border-seal' : 'border-rule focus:border-cedar',
  );

/**
 * Large card-style choice. Used instead of a dropdown wherever there are four
 * or fewer options, because a native select is a poor target on a phone held by
 * someone with limited dexterity.
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
        'flex min-h-touch cursor-pointer items-center gap-3 rounded-card border-2 p-4 transition',
        checked ? 'border-cedar bg-cedar-soft' : 'border-rule bg-card hover:border-cedar/50',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="h-6 w-6 accent-[var(--cedar)]"
      />
      <span>
        <span className="block font-medium">{title}</span>
        {description ? <span className="block text-sm text-muted">{description}</span> : null}
      </span>
    </label>
  );
}
