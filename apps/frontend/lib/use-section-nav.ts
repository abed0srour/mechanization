'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drives a jump-link bar: which section is currently being read, and how to
 * scroll to another one.
 *
 * Extracted because both long admin screens need it — the citizen form's three
 * sections and the dashboard's analytics groups — and the two non-obvious
 * parts (the observation band, and suppressing the observer mid-jump) are
 * exactly the parts that get subtly wrong when copied.
 *
 * The caller owns the markup: this returns state and a handler, not a nav bar,
 * because the form's buttons carry validation state and the dashboard's do not.
 *
 * @param ids  Section element ids, in document order. Each element must carry
 *             `scroll-mt-*` big enough to clear the sticky bar.
 * @param deps Values that change the page's height enough to invalidate the
 *             observer (a list growing, data arriving).
 */
export function useSectionNav<T extends string>(
  ids: readonly T[],
  deps: readonly unknown[] = [],
): { active: T; jumpTo: (id: T) => void } {
  const [active, setActive] = useState<T>(ids[0]);

  /**
   * Suppresses the observer while a jump is in flight.
   *
   * A smooth scroll passes *through* every section between here and the
   * target, so without this the highlight flickers across all of them on the
   * way and only settles on the right one after the animation ends — which
   * reads as the bar being broken rather than as it following the page.
   */
  const jumping = useRef<T | null>(null);

  useEffect(() => {
    const nodes = ids
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => node !== null);
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = entry.target.id as T;
          // A jump owns the highlight until its own target arrives.
          if (jumping.current && jumping.current !== id) continue;
          jumping.current = null;
          setActive(id);
        }
      },
      // A narrow band just under the sticky bar and well above the fold, so
      // "active" means "the heading you are reading" rather than "any section
      // with a pixel on screen" — which, when a short section and a tall one
      // are both visible, would always pick whichever came first.
      { rootMargin: '-96px 0px -55% 0px', threshold: 0 },
    );

    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join('|'), ...deps]);

  const jumpTo = useCallback((id: T) => {
    const node = document.getElementById(id);
    if (!node) return;
    jumping.current = id;
    setActive(id);
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return { active, jumpTo };
}
