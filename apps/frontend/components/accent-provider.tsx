'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT,
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

  useEffect(() => {
    try {
      localStorage.removeItem(ACCENT_STORAGE_KEY);
      document.documentElement.removeAttribute('data-accent');
    } catch {
      /* storage blocked */
    }
    setReady(true);
  }, []);

  const setAccent = useCallback((_next: AccentId) => {
    setAccentState(DEFAULT_ACCENT);
    document.documentElement.removeAttribute('data-accent');
    try {
      localStorage.removeItem(ACCENT_STORAGE_KEY);
    } catch {
      /* storage blocked */
    }
  }, []);

  return (
    <AccentContext.Provider value={{ accent, setAccent, ready }}>
      {children}
    </AccentContext.Provider>
  );
}
