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
 * `sessionStorage` by default — these tokens open citizen records, and
 * municipality computers are shared, so closing the tab ends the session.
 * "Remember me" is an explicit opt-in to `localStorage` instead, for a staff
 * member on their own machine who would rather not sign in every session; the
 * safer default is unaffected for everyone who doesn't check it.
 */
const key = (tenant: string) => `mechanization.session.${tenant}`;

/**
 * Stores the session, in `localStorage` when "remember me" was ticked and
 * `sessionStorage` otherwise — see the note above on shared municipal PCs.
 */
export function saveSession(tenant: string, session: Session, remember = false): void {
  const store = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;
  try {
    store.setItem(key(tenant), JSON.stringify(session));
    // Clears a copy left in the other storage by an earlier sign-in with the
    // opposite choice — otherwise loadSession could resurrect it later.
    other.removeItem(key(tenant));
  } catch {
    // Private-browsing modes reject writes. The session still works for this
    // page load; the user simply signs in again after a reload.
  }
}

/** Reads whichever store holds this tenant's session, session-scoped first. */
export function loadSession(tenant: string): Session | null {
  try {
    const raw = sessionStorage.getItem(key(tenant)) ?? localStorage.getItem(key(tenant));
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

/** Signs out of this tenant by clearing both stores. */
export function clearSession(tenant: string): void {
  try {
    sessionStorage.removeItem(key(tenant));
    localStorage.removeItem(key(tenant));
  } catch {
    /* nothing to clean up */
  }
}
