'use client';

/**
 * Draft persistence for the citizen wizard.
 *
 * This closes the gap flagged as open in the architecture doc: "what happens to
 * wizard progress on a dropped connection mid-submission". The answer here is
 * that progress never depended on the connection in the first place — every
 * step writes to localStorage, and the network is touched exactly once, at
 * submit. A citizen on an intermittent connection who loses the tab at step 6
 * reopens it and continues, rather than starting a ten-minute form again.
 *
 * What is deliberately NOT persisted: the uploaded files. They are large,
 * localStorage is a few megabytes, and quietly evicting a citizen's ID scan
 * would be worse than asking them to re-attach it. The wizard says so on the
 * documents step when a draft is restored.
 */
/**
 * Versioned: a saved draft holds a step *index*, so removing a step renumbers
 * every draft in the field. Bumping this abandons them instead of restoring
 * someone to the wrong page — cheap, because a draft is at most two weeks old.
 *
 * v2 dropped the "مواقع العقارات" step; coordinates now come from the cadastre.
 */
const KEY_PREFIX = 'mechanization.draft.v2.';

/** Drafts older than this are stale enough that the taxonomy may have changed. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

interface StoredDraft<T> {
  savedAt: number;
  step: number;
  data: T;
}

const key = (tenant: string) => `${KEY_PREFIX}${tenant}`;

export function saveDraft<T>(tenant: string, step: number, data: T): void {
  try {
    const payload: StoredDraft<T> = { savedAt: Date.now(), step, data };
    localStorage.setItem(key(tenant), JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage disabled. Losing autosave is not worth
    // interrupting someone mid-form over — the wizard still works in memory.
  }
}

export function loadDraft<T>(tenant: string): { step: number; data: T; savedAt: Date } | null {
  try {
    const raw = localStorage.getItem(key(tenant));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      clearDraft(tenant);
      return null;
    }

    return { step: parsed.step, data: parsed.data, savedAt: new Date(parsed.savedAt) };
  } catch {
    // A draft written by an older version of the wizard may not parse. Drop it
    // rather than crashing the page a citizen is trying to use.
    clearDraft(tenant);
    return null;
  }
}

/** Called after a successful submission — a filed report is not a draft. */
export function clearDraft(tenant: string): void {
  try {
    localStorage.removeItem(key(tenant));
  } catch {
    /* nothing to clean up */
  }
}
