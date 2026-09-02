'use client';

import Link from 'next/link';
import type { useRouter } from 'next/navigation';
import { useOnlineStatus } from '@/lib/offline-sync';

/**
 * Navigation to and from this offline feature's cached screens — `/citizens`,
 * `/citizens/new`, `/citizens/queue/[id]` — that stays correct when there is
 * no connection.
 *
 * The bug this exists to close: clicking a Next `<Link>`, or calling the
 * router's own `push`, from a page that is already mounted does not reload
 * anything. It fetches an "RSC payload" — React's own serialised description
 * of the next screen — over a request shape that differs from an ordinary
 * page load and, critically, differs by *which page the visitor is coming
 * from*. That is not something a service worker can warm ahead of time: there
 * is no way to cache a response keyed on a "from" that does not exist until
 * the click happens. So offline, that fetch fails, and — the part that reads
 * as "the page doesn't load" — nothing in this app forced a real navigation to
 * fall back to, because there was never a reason to, online.
 *
 * A full, ordinary navigation is what the service worker's own fetch handler
 * is built to serve correctly from its cache (see `sw.js`'s `navigate`
 * branch). This is what forces one, but only while offline — Next's fast
 * client transition is kept for the ordinary case, since there is nothing
 * wrong with it when there is a network to answer it.
 */
export function ShellLink({
  href,
  onClick,
  ...props
}: {
  href: string;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
} & Omit<React.ComponentProps<typeof Link>, 'href'>): React.JSX.Element {
  const online = useOnlineStatus();

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;

    // A click at the moment the connection drops: prevent Next.js client-side
    // RSC fetch from failing and stalling the transition, and do a full browser
    // navigation served directly by the Service Worker cache.
    if (!online || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      e.preventDefault();
      window.location.href = href;
    }
  };

  // A bare anchor: no client router involved at all, so there is no RSC
  // fetch to fail in the first place — the browser just navigates, exactly
  // as it would for a link on a page with no JavaScript on it.
  if (!online) {
    return <a href={href} onClick={handleClick} {...(props as React.ComponentProps<'a'>)} />;
  }

  return <Link href={href} onClick={handleClick} {...props} />;
}

/**
 * The `router.push` / `router.replace` counterpart, for a navigation
 * triggered by code rather than a click — after a successful offline save,
 * for instance, where there is no `<Link>` in the picture to swap out.
 */
export function shellNavigate(router: ReturnType<typeof useRouter>, href: string): void {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    window.location.href = href;
    return;
  }
  router.push(href);
}
