'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT,
  isAccent,
  type AccentId,
} from '@/lib/accents';

interface AccentContextValue {
  accent: AccentId;
  setAccent: (accent: AccentId) => void;
  /** False until the stored value has been read — lets the UI avoid a flicker. */
  ready: boolean;
}

const AccentContext = createContext<AccentContextValue>({
  accent: DEFAULT_ACCENT,
  setAccent: () => {},
  ready: false,
});

export const useAccent = () => useContext(AccentContext);

/**
 * Holds the accent choice and mirrors it onto `<html data-accent>`, which is
 * what the CSS variables key off.
 *
 * Deliberately shaped like `next-themes`: an attribute on the root element, a
 * value in localStorage, and a pre-paint script that applies it before React
 * exists. The two coexist rather than compete — light/dark owns the `dark`
 * class, this owns `data-accent`.
 *
 * Changing the accent repaints instantly with no reload, because every
 * component already resolves its colour through `--primary` / `--ring` at
 * style time rather than baking a hex at build time.
 */
export function AccentProvider({ children }: { children: React.ReactNode }) {
  const [accent, setAccentState] = useState<AccentId>(DEFAULT_ACCENT);
  const [ready, setReady] = useState(false);

  // Adopt whatever the pre-paint script already applied, so React's state and
  // the DOM agree from the first render rather than fighting over it.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
      if (isAccent(stored)) setAccentState(stored);
    } catch {
      /* storage blocked — the default is already on screen */
    }
    setReady(true);
  }, []);

  const setAccent = useCallback((next: AccentId) => {
    setAccentState(next);
    const root = document.documentElement;
    // The default *is* the base stylesheet, so the attribute is removed rather
    // than set to a block that does not exist.
    if (next === DEFAULT_ACCENT) root.removeAttribute('data-accent');
    else root.setAttribute('data-accent', next);
    try {
      localStorage.setItem(ACCENT_STORAGE_KEY, next);
    } catch {
      /* the choice still applies for this page load */
    }
  }, []);

  return (
    <AccentContext.Provider value={{ accent, setAccent, ready }}>
      {children}
    </AccentContext.Provider>
  );
}
