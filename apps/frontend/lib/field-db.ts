'use client';

import type {
  FieldDraftPayload,
  RecordVisitInput,
  VisitDisposition,
  VisitOutcome,
} from '@mechanization/shared-schemas';

/**
 * ──────────────────────────  The field worker's device  ──────────────────────
 *
 * Everything a worker does at a door is written here first and pushed later.
 * The network is never on the critical path of recording a visit, because the
 * networks this serves are exactly the ones that are missing when someone is
 * standing in a village street.
 *
 * IndexedDB rather than the `localStorage` the citizen wizard uses
 * (`wizard-storage.ts`). That was the right call there — one draft, a few
 * kilobytes, written at every step. This holds a whole sector's worklist plus a
 * day of unsent visits, which is comfortably past the ~5MB `localStorage`
 * ceiling, and it needs to be written from a service worker eventually, which
 * `localStorage` cannot be.
 *
 * The three stores answer three different questions:
 *
 *   `worklist` — what am I supposed to do? Replaced wholesale on every pull.
 *   `outbox`   — what have I done that the server has not been told about?
 *   `meta`     — when did I last sync, and as whom?
 */

const DB_NAME = 'mechanization.field';

/**
 * Bumping this discards the cached worklist and starts again from the server.
 *
 * Safe *only* because the outbox is preserved across the upgrade — losing a
 * worklist costs one refresh, losing a day of unsynced visits costs a day of
 * someone's work, and the two must never share a failure mode.
 */
const DB_VERSION = 1;

const STORE_WORKLIST = 'worklist';
const STORE_OUTBOX = 'outbox';
const STORE_META = 'meta';

/** One door as cached on the device. Mirrors the server's `WorklistParcel`. */
export interface CachedParcel {
  parcelNumber: string;
  zoneId: string;
  zoneCode: string;
  latitude: number | null;
  longitude: number | null;
  registered: boolean;
  lastOutcome: VisitOutcome | null;
  lastDisposition: VisitDisposition | null;
  lastVisitedAt: string | null;
  nextVisitAt: string | null;
  visitCount: number;
  draft: { clientId: string; payload: FieldDraftPayload; gaps: string[] } | null;
}

/** A visit waiting to be pushed. Dates are ISO strings — IndexedDB keeps
 *  `Date` objects, but the outbox is also read straight into a JSON body. */
export interface QueuedVisit extends Omit<RecordVisitInput, 'visitedAt' | 'nextVisitAt'> {
  kind: 'visit';
  visitedAt: string;
  nextVisitAt?: string;
  /** Set by a failed push, shown next to the row so the worker can fix it. */
  lastError?: string;
}

export interface QueuedDraft {
  kind: 'draft';
  clientId: string;
  parcelNumber: string;
  payload: FieldDraftPayload;
  updatedAt: string;
  lastError?: string;
}

export type OutboxEntry = QueuedVisit | QueuedDraft;

export interface FieldMeta {
  lastPulledAt: string | null;
  lastPushedAt: string | null;
  /** Whose worklist is cached. A different login must not inherit it. */
  inspectorId: string | null;
  tenant: string | null;
  /**
   * The municipality's public config, cached on every pull.
   *
   * The draft form is the register's own form, and that form asks the tenant
   * which أنواع العقارات this municipality accepts before it renders a single
   * choice. Fetching it at a doorstep would make the whole screen depend on a
   * network the worker does not have — so it rides along with the worklist,
   * which is the one moment they are known to be online.
   */
  config: unknown | null;
}

const EMPTY_META: FieldMeta = {
  lastPulledAt: null,
  lastPushedAt: null,
  inspectorId: null,
  tenant: null,
  config: null,
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_WORKLIST)) {
        db.createObjectStore(STORE_WORKLIST, { keyPath: 'parcelNumber' });
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        const outbox = db.createObjectStore(STORE_OUTBOX, { keyPath: 'clientId' });
        // Drafts must be pushed before the visits that reference them, and the
        // sync builds its batch by reading this index rather than sorting a
        // whole day's queue in memory.
        outbox.createIndex('kind', 'kind', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const request = body(tx.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

/**
 * True when this browser can hold a worklist at all.
 *
 * A private window, or a browser with site data blocked, has no IndexedDB. The
 * field screen checks this on mount and refuses to pretend — telling a worker
 * up front that their device cannot store anything is far better than letting
 * them record forty visits into a void.
 */
export function isFieldStorageAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

// ──────────────────────────────  Worklist  ───────────────────────────────

/**
 * Replace the cached worklist wholesale.
 *
 * Wholesale rather than merged: the server's bundle is the truth about what is
 * assigned, and a parcel that has left the worker's sector must disappear from
 * their device. Merging would leave it there forever.
 */
export async function saveWorklist(
  parcels: CachedParcel[],
  meta: Partial<FieldMeta>,
): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_WORKLIST, STORE_META], 'readwrite');
    const store = tx.objectStore(STORE_WORKLIST);
    store.clear();
    for (const parcel of parcels) store.put(parcel);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  await updateMeta(meta);
}

export async function loadWorklist(): Promise<CachedParcel[]> {
  return run<CachedParcel[]>(STORE_WORKLIST, 'readonly', (store) => store.getAll());
}

/**
 * Apply a locally-recorded visit to the cached worklist immediately.
 *
 * Without this the worker records "nobody home", the row does not change, and
 * they have no way to tell which doors they have already done today — the list
 * would only update after a sync, which may be hours away. The server will
 * overwrite this on the next pull; until then it is the honest local picture.
 */
export async function applyVisitLocally(
  parcelNumber: string,
  patch: Partial<CachedParcel>,
): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_WORKLIST, 'readwrite');
    const store = tx.objectStore(STORE_WORKLIST);
    const get = store.get(parcelNumber);
    get.onsuccess = () => {
      const current = get.result as CachedParcel | undefined;
      if (current) store.put({ ...current, ...patch });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Drop parcels the server says are already registered by someone else. */
export async function removeParcels(parcelNumbers: readonly string[]): Promise<void> {
  if (parcelNumbers.length === 0) return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_WORKLIST, 'readwrite');
    const store = tx.objectStore(STORE_WORKLIST);
    for (const parcelNumber of parcelNumbers) store.delete(parcelNumber);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// ───────────────────────────────  Outbox  ────────────────────────────────

export async function enqueue(entry: OutboxEntry): Promise<void> {
  await run(STORE_OUTBOX, 'readwrite', (store) => store.put(entry));
}

export async function readOutbox(): Promise<OutboxEntry[]> {
  return run<OutboxEntry[]>(STORE_OUTBOX, 'readonly', (store) => store.getAll());
}

export async function outboxSize(): Promise<number> {
  return run<number>(STORE_OUTBOX, 'readonly', (store) => store.count());
}

/** Remove entries the server has confirmed. */
export async function dequeue(clientIds: readonly string[]): Promise<void> {
  if (clientIds.length === 0) return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    const store = tx.objectStore(STORE_OUTBOX);
    for (const clientId of clientIds) store.delete(clientId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * Record why an entry could not be pushed, and keep it queued.
 *
 * A rejected visit is never silently dropped. "العقار ليس ضمن قطاعك" is
 * something the worker has to see and a supervisor has to fix; discarding it
 * would lose the record of work genuinely done.
 */
export async function markFailed(clientId: string, error: string): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    const store = tx.objectStore(STORE_OUTBOX);
    const get = store.get(clientId);
    get.onsuccess = () => {
      const current = get.result as OutboxEntry | undefined;
      if (current) store.put({ ...current, lastError: error });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// ────────────────────────────────  Meta  ─────────────────────────────────

export async function readMeta(): Promise<FieldMeta> {
  const stored = await run<FieldMeta | undefined>(STORE_META, 'readonly', (store) =>
    store.get('state'),
  );
  return { ...EMPTY_META, ...(stored ?? {}) };
}

export async function updateMeta(patch: Partial<FieldMeta>): Promise<void> {
  const current = await readMeta();
  await run(STORE_META, 'readwrite', (store) => store.put({ ...current, ...patch }, 'state'));
}

/**
 * Wipe everything. Called on logout and when a different inspector signs in on
 * the same device.
 *
 * Deliberately refuses while the outbox is not empty, unless forced: signing
 * out with a day of unsynced visits on the device is the single worst thing
 * that can happen to this feature, and it should cost a confirmation rather
 * than happen quietly inside a session teardown.
 */
export async function clearFieldData(options: { force?: boolean } = {}): Promise<boolean> {
  if (!options.force && (await outboxSize()) > 0) return false;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_WORKLIST, STORE_OUTBOX, STORE_META], 'readwrite');
    tx.objectStore(STORE_WORKLIST).clear();
    tx.objectStore(STORE_OUTBOX).clear();
    tx.objectStore(STORE_META).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return true;
}
