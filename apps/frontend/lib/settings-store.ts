'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Browser-local persistence for the settings this portal cannot yet save.
 *
 * Four of the six settings sections describe configuration the backend has no
 * table for: `SystemSettings` holds five contact fields and nothing else, so
 * there is no column for a default fee rate, an exchange rate, an invoice
 * prefix, or a backup schedule, and no endpoint that would accept one. The
 * choice is between shipping controls that silently discard what is typed into
 * them and shipping controls that keep it somewhere honest. This is the second.
 *
 * **This is a seam, not a destination.** Every slice is written and read
 * through one pair of functions taking exactly the shape a `GET`/`PATCH` on the
 * matching endpoint would carry, so replacing it later is a change to
 * `useSettingsSlice` and nothing else — no call site moves. The UI says so
 * plainly too: each unwired section carries the «غير موصول بالخادم بعد» notice
 * rather than letting a clerk believe a colleague on another machine will see
 * what they just saved.
 *
 * Keys are tenant-scoped. One browser genuinely does serve more than one
 * municipality — a vendor supporting several — and an unscoped key would show
 * one town's exchange rate to the next.
 */

const KEY_PREFIX = 'mechanization.settings';

function storageKey(tenant: string, slice: string): string {
  return `${KEY_PREFIX}.${tenant}.${slice}`;
}

/** Reads one slice, falling back to `fallback` on absence or any corruption. */
export function readSettingsSlice<T extends object>(
  tenant: string,
  slice: string,
  fallback: T,
): T {
  try {
    const raw = localStorage.getItem(storageKey(tenant, slice));
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return fallback;
    }
    // Spread over the fallback rather than returning the parsed object: a slice
    // stored before a field existed must not leave that field `undefined` on a
    // controlled input, which is how React switches it to uncontrolled mid-life.
    return { ...fallback, ...(parsed as Partial<T>) };
  } catch {
    return fallback;
  }
}

/** Writes one slice. A full quota or a private window is not worth an error. */
export function writeSettingsSlice<T extends object>(
  tenant: string,
  slice: string,
  value: T,
): void {
  try {
    localStorage.setItem(storageKey(tenant, slice), JSON.stringify(value));
  } catch {
    /* the value still holds for this page load */
  }
}

/**
 * One slice of locally-held settings, with its hydration state.
 *
 * `hydrated` is not a nicety. The value has to start as `fallback` so the
 * server render and the first client render agree, which means there is one
 * paint where a saved exchange rate is not on screen yet. A section that shows
 * a save button during that paint offers to overwrite real settings with
 * defaults, so callers gate on this.
 */
export function useSettingsSlice<T extends object>(
  tenant: string,
  slice: string,
  fallback: T,
): {
  value: T;
  setValue: (next: T) => void;
  persist: (next: T) => void;
  hydrated: boolean;
} {
  const [value, setValue] = useState<T>(fallback);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setValue(readSettingsSlice(tenant, slice, fallback));
    setHydrated(true);
    // `fallback` is a literal at every call site and would re-run this on each
    // render if it were a dependency, re-reading storage over the user's edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, slice]);

  const persist = useCallback(
    (next: T) => {
      setValue(next);
      writeSettingsSlice(tenant, slice, next);
    },
    [tenant, slice],
  );

  return { value, setValue, persist, hydrated };
}
