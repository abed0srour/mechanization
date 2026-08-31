'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiRequestError } from '@/lib/api-client';

/**
 * The staff portal's read cache.
 *
 * Every admin screen used to fetch in a `useEffect` into its own `useState`,
 * which meant the data belonged to the *component*: leaving a page unmounted
 * it, and coming back mounted an empty one that fetched from zero behind a
 * skeleton. Moving between المواطنون and إدارة الرسوم and back — the single
 * most common thing a clerk does all day — was three full loads of data that
 * had not changed, and three skeleton flashes to read past.
 *
 * Mounted in the protected layout rather than at the root, so the cache is
 * exactly as long-lived as the staff session's chrome: it survives navigation
 * between staff screens (the layout is not remounted for a sibling route) and
 * is discarded on the way out to the login page. Nothing is written to disk —
 * this register holds national ID numbers, and a shared municipal desktop is
 * the normal deployment, so the cache dies with the tab rather than waiting on
 * a browser to be told to forget it.
 */
export function QueryProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  /*
    Created once per mount, inside state. A module-level client would be shared
    across every request during server rendering, which on a multi-tenant portal
    means one municipality's rows served to another.
  */
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /**
             * How long a result is served without going back to the API at all.
             *
             * Thirty seconds is deliberately short. This is a system where a
             * second clerk is settling a payment at the next desk, so data
             * genuinely does change under the reader; the win here is not
             * avoiding requests, it is that a cached result renders
             * *immediately* and any refetch happens behind it. A stale page
             * that fills in a moment later beats an empty page that fills in
             * at the same moment.
             */
            staleTime: 30_000,
            /** Kept for five minutes after the last screen using it unmounts. */
            gcTime: 5 * 60_000,
            /**
             * A shared counter machine gets left on a screen for an hour.
             * Re-focusing the tab is the clearest signal that someone is about
             * to act on what it says, so that is when it is worth re-reading.
             */
            refetchOnWindowFocus: true,
            /**
             * Retry the network, never the answer.
             *
             * A 401 means the session is gone and the page is about to redirect
             * to login — retrying it three times just delays that by a few
             * seconds. A 403 or a 404 will say the same thing however many
             * times it is asked. Only a dropped connection (status 0, the
             * normal case on these networks) is worth trying again.
             */
            retry: (failureCount, error) => {
              if (error instanceof ApiRequestError && error.status !== 0) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
