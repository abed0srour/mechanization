'use client';

import { useEffect } from 'react';

/**
 * Installs the app shell on this device, and tells it what to keep.
 *
 * The worker itself is static and knows nothing about who is using it; the
 * routes worth holding depend on the municipality and on its deliberately
 * obscure admin segment, both of which only the running page knows. So
 * registration and warming happen together, here.
 *
 * Called from `AdminShell`, so every staff screen installs it — an officer who
 * has ever opened the portal is covered, without having to find a settings
 * toggle first. Registering from the citizen-facing side would be wrong: those
 * pages are for someone checking a fee once, not working a settlement, and the
 * shell would be cache they never benefit from.
 */
export function useServiceWorker(base: string): void {
  useEffect(() => {
    // Absent in a private window, in an insecure context that is not
    // localhost, and in older browsers. All three are ordinary rather than
    // exceptional, and all three leave the portal working exactly as it did
    // before — online-only, with the queue still on disk.
    if (!('serviceWorker' in navigator)) return;

    let cancelled = false;

    const install = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        if (cancelled) return;

        /*
          Wait for a worker that can actually receive a message.

          `registration.active` is null on a first install while the worker is
          still activating, and posting into that gap silently does nothing —
          which would leave the shell uncached on exactly the visit that
          installed it, i.e. the one before the officer walks out of signal.
        */
        const worker = registration.active ?? (await navigator.serviceWorker.ready).active;
        if (cancelled || !worker) return;

        worker.postMessage({
          type: 'warm',
          // The two screens the field work runs through: where a household is
          // registered, and where the queue of unsent ones is listed.
          routes: [`${base}/citizens/new`, `${base}/citizens`],
        });
      } catch {
        /*
          A failed registration is not worth surfacing.

          It means this browser or this context will not hold the shell — the
          portal still works online, records still queue, and the sync still
          runs. Telling a clerk at a counter that "الوضع دون اتصال غير متاح"
          would be alarming for a capability they were not about to use.
        */
      }
    };

    void install();

    return () => {
      cancelled = true;
    };
  }, [base]);
}
