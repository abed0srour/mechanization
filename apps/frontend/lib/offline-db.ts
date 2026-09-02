'use client';

import type { FieldFlag } from '@mechanization/shared-schemas';

/**
 * The queue of citizen registrations recorded with no connection.
 *
 * `wizard-storage` already keeps a *draft* alive across a dropped tab, and it
 * uses localStorage because a draft is small, single, and disposable. This is
 * the other problem: a field officer works a settlement for three hours with no
 * signal and finishes thirty complete registrations. Those are not drafts —
 * they are finished records, and losing one is losing a household's afternoon.
 * So they go to IndexedDB, which is transactional, has room for thirty of them,
 * and does not silently evict the way a full localStorage does.
 *
 * Written against the raw IndexedDB API rather than pulling in `idb`: this is
 * one object store with five operations, the wrapper would be most of what the
 * dependency does, and every byte of this ships to a phone on a bad connection.
 */

const DB_NAME = 'mechanization.offline';
const DB_VERSION = 1;
const STORE = 'citizenSubmissions';

/** Groups a queue read by municipality without scanning every record. */
const TENANT_INDEX = 'by-tenant';

export type QueuedStatus =
  /** Waiting for a connection. Retried automatically, forever. */
  | 'pending'
  /**
   * The server refused it, and would refuse it again.
   *
   * A 4xx that is not an expired session — a validation failure, a duplicate
   * identity document, a property type this municipality does not accept.
   * Retrying is pointless and would hide the problem behind a spinner, so the
   * record stops here and is shown to a human with what the server said.
   */
  | 'blocked';

export interface QueuedSubmission {
  /**
   * The `clientSubmissionId` the server deduplicates on.
   *
   * Minted here, before the first send, and never regenerated — that is the
   * whole point. A record whose response was lost to the same bad connection
   * that queued it is re-sent under the same id and recognised, rather than
   * registering the household twice.
   */
  id: string;
  tenant: string;
  /** What the record will be called in the queue list, before it has an id. */
  displayName: string;
  payload: {
    personal: Record<string, unknown>;
    contact: Record<string, unknown>;
    properties: Array<Record<string, unknown>>;
    flags: FieldFlag[];
  };
  status: QueuedStatus;
  savedAt: number;
  attempts: number;
  lastAttemptAt: number | null;
  /** What the server or the network said last, verbatim, for the queue list. */
  lastError: string | null;
}

/** Nothing here works server-side, and Next renders these pages there first. */
export function offlineStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

let connection: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (connection) return connection;

  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex(TENANT_INDEX, 'tenant', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    /*
      Another tab is holding the old version open during an upgrade.

      Rejecting rather than hanging: every caller here treats a failure as "no
      queue available" and falls back to sending online, which is the right
      answer for a browser that cannot open the store at all.
    */
    request.onblocked = () => reject(new Error('offline queue is open in another tab'));
  });

  // A failed open must not be cached as the connection, or the queue stays
  // broken for the life of the page even after the condition clears.
  connection.catch(() => {
    connection = null;
  });

  return connection;
}

/** One transaction, promisified. */
function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = work(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.onabort = () => reject(transaction.error);
      }),
  );
}

/** Queues a finished registration. Resolves once it is durably stored. */
export async function enqueue(submission: QueuedSubmission): Promise<void> {
  await run('readwrite', (store) => store.put(submission));
}

/** Everything still waiting for this municipality, oldest first. */
export async function listQueued(tenant: string): Promise<QueuedSubmission[]> {
  const rows = await run<QueuedSubmission[]>('readonly', (store) =>
    store.index(TENANT_INDEX).getAll(tenant),
  );
  return rows.sort((a, b) => a.savedAt - b.savedAt);
}

/** One queued record by id — for an officer opening it to correct it. */
export async function getQueued(id: string): Promise<QueuedSubmission | null> {
  const result = await run<QueuedSubmission | undefined>('readonly', (store) => store.get(id));
  return result ?? null;
}

/** Removes a record the server has accepted. */
export async function dequeue(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(id));
}

/**
 * Read-modify-write inside a single transaction.
 *
 * Not `put` of a whole record held in memory: two tabs may be draining the
 * same queue, and the loser of that race must not resurrect a record the
 * winner has just deleted. A record that is gone by the time this reads it is
 * left gone — resolving `false` rather than silently doing nothing, so a
 * caller correcting a record that was delivered a moment earlier can say so
 * rather than claim a save that never happened.
 */
async function update(
  id: string,
  patch: (existing: QueuedSubmission) => QueuedSubmission,
): Promise<boolean> {
  const db = await open();
  let found = false;

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const read = store.get(id);

    read.onsuccess = () => {
      const existing = read.result as QueuedSubmission | undefined;
      if (existing) {
        found = true;
        store.put(patch(existing));
      }
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

  return found;
}

/** Records the outcome of one delivery attempt. */
export function recordAttempt(
  id: string,
  outcome: { status: QueuedStatus; error: string | null },
): Promise<boolean> {
  return update(id, (existing) => ({
    ...existing,
    status: outcome.status,
    attempts: existing.attempts + 1,
    lastAttemptAt: Date.now(),
    lastError: outcome.error,
  }));
}

/**
 * Puts a blocked record back in line — the officer has said to try again.
 *
 * Offered because "blocked" is a judgement about the *last* attempt: a
 * rejection for a duplicate identity document stops being true once the
 * duplicate is deleted, and a municipality that enables a property type makes
 * a previously refused registration valid without anyone editing it. It does
 * not count as an attempt, because nothing has been attempted yet.
 */
export function retryLater(id: string): Promise<boolean> {
  return update(id, (existing) => ({ ...existing, status: 'pending', lastError: null }));
}

/**
 * Replaces a queued record's payload — an officer correcting the field the
 * server rejected, or one they caught before it was ever sent.
 *
 * Goes back to `pending` with its error cleared: whatever the reason was, the
 * officer has just acted on it, and leaving the record in `blocked` next to a
 * complaint that may no longer even apply would read as though the edit had
 * not registered at all.
 *
 * `savedAt` and `attempts` are left untouched — they are the record's own
 * history (when it was first filed, how many times it has been tried), not
 * something a correction should erase.
 */
export function reviseQueued(
  id: string,
  patch: { payload: QueuedSubmission['payload']; displayName: string },
): Promise<boolean> {
  return update(id, (existing) => ({
    ...existing,
    payload: patch.payload,
    displayName: patch.displayName,
    status: 'pending',
    lastError: null,
  }));
}
