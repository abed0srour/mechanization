'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * The theme boundary for every page under a tenant.
 *
 * A thin client wrapper because `next-themes` uses context and effects, while
 * the layout that mounts it is a server component fetching the municipality's
 * branding. Keeping the `'use client'` seam here rather than on the layout
 * means the tenant config is still fetched and rendered on the server.
 *
 * `storageKey` is deliberately the key the previous hand-rolled toggle wrote
 * to. Its stored values were `'dark'` and `'light'`, which are two of the three
 * `next-themes` accepts verbatim — so a staff member who had already chosen
 * dark keeps it across this migration instead of silently reverting to the OS
 * preference on their next visit.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="mechanization.theme"
      // The palette swap is instant by design. Animating `background-color` on
      // every element that reads a token means a full-page repaint per frame
      // for the duration — on the older phones this serves that is a visibly
      // janky wipe, not a fade.
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
