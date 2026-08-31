/*
 * Service worker — the reason the field screen loads at all with no signal.
 *
 * Everything a worker records already survives being offline: it goes into
 * IndexedDB (`lib/field-db.ts`) and syncs later. But none of that helps if the
 * page itself will not open, and a Next.js app with no service worker is a
 * blank screen the moment the network is gone. This closes that gap and nothing
 * more — it is not a general-purpose caching layer, and it deliberately stays
 * out of the way of every request that is not the app shell.
 *
 * Three rules, in order of how much damage getting them wrong would do:
 *
 *  1. **The API is never touched.** It is a different origin, and the one thing
 *     worse than a field screen that will not load is one that quietly shows a
 *     worklist from yesterday as though it were current. Freshness of API data
 *     is IndexedDB's job, where it carries a visible "synced at" timestamp.
 *
 *  2. **Navigations are network-first.** A worker who *does* have signal gets
 *     the current build. The cache is the fallback, not the default, so a
 *     deploy is picked up on the next online load rather than pinned until
 *     someone clears their browser.
 *
 *  3. **Build assets are cache-first and immutable.** `/_next/static/*` is
 *     content-hashed, so a hit can never be stale — and these are the requests
 *     that make an offline load succeed or fail.
 */

const VERSION = 'v1';
const SHELL_CACHE = `mechanization-shell-${VERSION}`;
const ASSET_CACHE = `mechanization-assets-${VERSION}`;

self.addEventListener('install', (event) => {
  // Take over as soon as this version is installed. A worker mid-shift should
  // not have to close every tab to pick up a fix.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('mechanization-') && !name.endsWith(VERSION))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Same-origin only: the API lives elsewhere and is handled by nobody here. */
function isOwnOrigin(url) {
  return url.origin === self.location.origin;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isOwnOrigin(url)) return;

  // Content-hashed build output. A cache hit is always correct.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE));
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;

    /*
     * Never navigated here before and no network.
     *
     * A generic offline page would be a lie — it would suggest the worker's
     * recorded visits are gone, when in fact every one of them is safe in
     * IndexedDB waiting to sync. So say that instead, in the language the app
     * is used in.
     */
    return new Response(
      `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
       <meta name="viewport" content="width=device-width,initial-scale=1">
       <title>لا يوجد اتصال</title>
       <style>
         body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;
              display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
         .card{max-width:32rem;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px}
         h1{font-size:1.25rem;margin:0 0 12px}
         p{color:#475569;line-height:1.8;margin:0 0 8px}
         @media (prefers-color-scheme:dark){
           body{background:#090e17;color:#f1f5f9}
           .card{background:#0f172a;border-color:#1e293b}
           p{color:#94a3b8}
         }
       </style></head>
       <body><div class="card">
         <h1>لا يوجد اتصال بالإنترنت</h1>
         <p>لم يسبق فتح هذه الصفحة على هذا الجهاز، فلا يمكن عرضها دون اتصال.</p>
         <p><strong>الزيارات التي سجّلتها محفوظة على الجهاز</strong> وسيتم إرسالها تلقائياً عند عودة الاتصال.</p>
       </div></body></html>`,
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}
