'use client';

import type { Session } from './api-client';

/**
 * Session storage, namespaced per municipality.
 *
 * The tenant is part of the key because a staff member may legitimately hold
 * accounts in two municipalities, and one overwriting the other would look like
 * a random logout. It also means a token can never be replayed against a tenant
 * it was not issued for — the backend rejects that anyway, but not sending it is
 * better than being rejected.
 *
 * `sessionStorage`, not `localStorage`: these tokens open citizen records, and
 * municipality computers are shared. Closing the tab ends the session.
 */
const key = (tenant: string) => `mechanization.session.${tenant}`;

export function saveSession(tenant: string, session: Session): void {
  try {
    sessionStorage.setItem(key(tenant), JSON.stringify(session));
  } catch {
    // Private-browsing modes reject writes. The session still works for this
    // page load; the user simply signs in again after a reload.
  }
}

export function loadSession(tenant: string): Session | null {
  try {
    const raw = sessionStorage.getItem(key(tenant));
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function clearSession(tenant: string): void {
  try {
    sessionStorage.removeItem(key(tenant));
  } catch {
    /* nothing to clean up */
  }
}
