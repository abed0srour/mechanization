import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Ported from the Albazourieh platform, with one deviation: an `invalid` prop
 * instead of callers hand-rolling a red border. A wrong رقم العقار is the
 * single most common error in this form, and it needs to look the same
 * everywhere it appears.
 */
export interface InputProps extends React.ComponentProps<'input'> {
  invalid?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, invalid, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        invalid && 'border-destructive focus-visible:ring-destructive',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

/** Same box as Input, for the handful of native selects the wizard still uses. */
const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = 'Select';

export { Input, Select };
