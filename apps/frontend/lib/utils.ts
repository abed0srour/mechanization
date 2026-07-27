import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Narrows a flat `"properties.0.units.1.floor": "..."` error map down to the
 * bare keys a nested component expects (`"units.1.floor"`, then `"floor"` one
 * level further in). Field-level error props are written once, in every step,
 * against short local keys (`errors.buildingName`); this is what lets a
 * validator that only knows the full wizard shape hand each component just its
 * own slice.
 */
export function scopeErrors(
  errors: Record<string, string>,
  prefix: string,
): Record<string, string> {
  const withDot = `${prefix}.`;
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(errors)) {
    if (key.startsWith(withDot)) out[key.slice(withDot.length)] = message;
  }
  return out;
}
