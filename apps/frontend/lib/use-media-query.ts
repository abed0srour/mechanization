'use client';

import { useEffect, useState } from 'react';

/**
 * Subscribes to a CSS media query from React.
 *
 * Used only where a breakpoint has to change *behaviour* rather than
 * appearance — a drawer that traps focus below `lg` and is an inert rail above
 * it, a collapse preference that only means anything on a wide screen. Anything
 * that is purely visual belongs in a Tailwind `lg:` class instead: those cost
 * no JavaScript and are correct in the first paint.
 *
 * Returns `false` until mounted. The server has no viewport, so any component
 * branching on this must render its narrow form first and widen after
 * hydration — the alternative is a hydration mismatch on every load.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);

  return matches;
}

/** The `lg` breakpoint, where the admin rail stops being a drawer. */
export const DESKTOP_QUERY = '(min-width: 1024px)';
