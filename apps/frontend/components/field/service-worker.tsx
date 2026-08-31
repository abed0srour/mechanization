'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker that makes the field screen openable offline.
 *
 * Mounted from the protected admin layout rather than the root layout: the
 * citizen portal has no offline story and does not want one — a citizen looking
 * up what they owe should always see the live figure, never a cached page that
 * might tell them a settled bill is outstanding.
 *
 * Failure is silent by design. A browser that refuses to register a worker
 * (private mode, an unsupported engine, an insecure origin in local dev) still
 * runs every other screen perfectly, and the field screen tells the worker
 * separately and specifically when local storage is genuinely unavailable —
 * which is the failure that actually costs them work.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      // In development, clear any registered workers so hot-reload/CSS changes are immediate
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister();
        }
      });
      return;
    }

    if (!window.isSecureContext) return;

    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* Offline shell unavailable; every online path is unaffected. */
    });
  }, []);

  return null;
}
