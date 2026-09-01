'use client';

import {
  OUTCOME_DISPOSITION,
  visitStateChanged,
  type DiscardDraftInput,
  type FieldDraftPayload,
  type FieldDraftSummary,
  type PromotedDraftInfo,
  type RecordVisitInput,
  type RegisteredCitizenSummary,
  type SyncFailureCode,
  type VisitOutcome,
  type WorklistParcel,
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
 * The four stores answer four different questions:
 *
 *   `worklist` — what am I supposed to do? Replaced wholesale on every pull.
 *   `outbox`   — what have I done that the server has not been told about?
 *   `retired`  — what have I finished, that a stale pull must not hand back?
 *   `meta`     — when did I last sync, and as whom?
 */

const DB_NAME = 'mechanization.field';

/**
 * Bumping this discards the cached worklist and starts again from the server.
 *
 * Safe *only* because the outbox is preserved across the upgrade — losing a
 * worklist costs one refresh, losing a day of unsynced visits costs a day of
 * someone's work, and the two must never share a failure mode.
 *
 * v2 adds `retired`. See the store's own note: without it a household that
 * became a real citizen record could be handed back to the device as
 * outstanding work, forever.
 */
const DB_VERSION = 2;

const STORE_WORKLIST = 'worklist';
const STORE_OUTBOX = 'outbox';
const STORE_META = 'meta';
const STORE_RETIRED = 'retired';

/**
 * One household on the device.
 *
 * Structurally the server's `FieldDraftSummary` with dates already ISO strings,
 * which is what they are by the time JSON has been through them — declared as
 * the shared type rather than a copy of it, so a field added on the server
 * cannot quietly go unread here.
 */
export type CachedDraft = FieldDraftSummary<string>;

export type { RegisteredCitizenSummary };

/** One door as cached on the device. */
export type CachedParcel = WorklistParcel<string>;

/**
 * The visit half of a household's state — the seven fields a new outcome
 * replaces *wholesale*.
 *
 * Wholesale is the entire point. Every merge on this path used to be written
 * `patch.x ?? current.x`, which cannot express "there is no return date any
 * more": changing a case from «بانتظار مستندات» (return on the 15th, وكيل
 * named) to «منجز» left the 15th and the وكيل behind, and the parcel then sat
 * in «مستحقة» forever because something was still owed on a date that had
 * passed. A visit is a complete statement about a household at a moment. It is
 * applied as one.
 */
export interface DraftVisitState {
  lastOutcome: VisitOutcome | null;
  lastVisitedAt: string | null;
  nextVisitAt: string | null;
  note: string | null;
  proxyName: string | null;
  proxyPhone: string | null;
}

/** The seven fields of `DraftVisitState`, with disposition derived. */
function applyVisitState(draft: CachedDraft, visit: DraftVisitState): CachedDraft {
  return {
    ...draft,
    lastOutcome: visit.lastOutcome,
    lastDisposition: visit.lastOutcome ? OUTCOME_DISPOSITION[visit.lastOutcome] : null,
    lastVisitedAt: visit.lastVisitedAt,
    nextVisitAt: visit.nextVisitAt,
    note: visit.note,
    proxyName: visit.proxyName,
    proxyPhone: visit.proxyPhone,
  };
}

/**
 * True when a save actually changes what happened at the door.
 *
 * Re-exported from shared-schemas so callers on this side have it to hand. It
 * lives there because it is a rule about the domain rather than about IndexedDB
 * — and because there is a Jest runner there and none here.
 */
export { visitStateChanged };

/**
 * Why a queued record has not gone through, carried on the record itself.
 *
 * Common to all three kinds, because "this one is stuck and here is why" is the
 * same question whatever is stuck. It used to be a bare `lastError` string that
 * nothing ever rendered: the sync wrote a reason onto the row and the worker
 * saw a number in a badge go up. A reason nobody reads is not a reason.
 */
interface QueuedFailure {
  /** The server's own sentence, in Arabic. */
  lastError?: string;
  /** What kind of problem it is — drives the "how do I fix this" text. */
  lastErrorCode?: SyncFailureCode;
  /** When it last failed, so a fresh complaint can be told from a stale one. */
  lastFailedAt?: string;
}

/** A visit waiting to be pushed. Dates are ISO strings — IndexedDB keeps
 *  `Date` objects, but the outbox is also read straight into a JSON body. */
export interface QueuedVisit
  extends Omit<RecordVisitInput, 'visitedAt' | 'nextVisitAt'>,
    QueuedFailure {
  kind: 'visit';
  visitedAt: string;
  nextVisitAt?: string;
}

export interface QueuedDraft extends QueuedFailure {
  kind: 'draft';
  clientId: string;
  parcelNumber: string;
  payload: FieldDraftPayload;
  updatedAt: string;
}

/**
 * A household the worker has taken back.
 *
 * Carries its own `clientId` — the outbox is keyed on that, and a discard
 * sharing a key with the draft it names would overwrite it in the queue. The
 * household is `draftClientId`, exactly as a visit names its household.
 */
export interface QueuedDiscard extends Omit<DiscardDraftInput, 'discardedAt'>, QueuedFailure {
  kind: 'discard';
  discardedAt: string;
}

export type OutboxEntry = QueuedVisit | QueuedDraft | QueuedDiscard;

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

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_WORKLIST)) {
        db.createObjectStore(STORE_WORKLIST, { keyPath: 'parcelNumber' });
      } else if (event.oldVersion < 2) {
        // v1 stored a single `draft` per parcel and a `registeredCount`
        // alongside the list it counted. Rather than migrate a shape that a
        // pull replaces wholesale in seconds anyway, drop it — this is the
        // "safe *only* because the outbox survives" trade the version note
        // above describes, and the outbox is untouched here.
        request.transaction?.objectStore(STORE_WORKLIST).clear();
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
      /**
       * Households this device is finished with, keyed by draft `clientId`.
       *
       * The pull merges the server's drafts with the device's own, because a
       * draft written offline is not on the server yet and must not vanish
       * from the screen. That union has no way, on its own, to represent a
       * draft the server has *deliberately stopped sending* — and the server
       * stops sending a draft the moment it becomes a real citizen record.
       *
       * So a promoted household came back on the next pull as outstanding
       * work, pinning its parcel in «المسودات» with no way to clear it. A
       * tombstone is the missing third state: not "the server forgot", but
       * "this is done, never re-add it".
       */
      if (!db.objectStoreNames.contains(STORE_RETIRED)) {
        db.createObjectStore(STORE_RETIRED, { keyPath: 'clientId' });
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
 * Read-modify-write one parcel inside a single transaction.
 *
 * Every worklist mutation goes through here so none of them can reintroduce the
 * pattern this file used to repeat six times: open, get, hand-merge `draft`
 * against `drafts`, put, close. Six copies of a merge is six chances for one of
 * them to be subtly different from the others, and they were.
 */
async function mutateParcel(
  parcelNumber: string,
  change: (current: CachedParcel) => CachedParcel,
): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_WORKLIST, 'readwrite');
      const store = tx.objectStore(STORE_WORKLIST);
      const get = store.get(parcelNumber);
      get.onsuccess = () => {
        const current = get.result as CachedParcel | undefined;
        if (current) store.put(change(withDefaults(current)));
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * A row read from the store, with the arrays guaranteed present.
 *
 * The v2 upgrade clears the worklist, so a stored row should already have both.
 * A second tab still open on the previous build can write one that does not,
 * and a `.map` on undefined at a doorstep is not a thing worth risking to save
 * two lines.
 */
function withDefaults(parcel: CachedParcel): CachedParcel {
  return {
    ...parcel,
    drafts: parcel.drafts ?? [],
    registeredCitizens: parcel.registeredCitizens ?? [],
  };
}

/**
 * Apply a locally-recorded visit to the cached worklist immediately.
 *
 * Without this the worker records "nobody home", the row does not change, and
 * they have no way to tell which doors they have already done today — the list
 * would only update after a sync, which may be hours away. The server will
 * overwrite this on the next pull; until then it is the honest local picture.
 *
 * `draftClientId` says *what the visit was about*, and it is required rather
 * than optional so that a caller cannot forget to decide. A visit about one
 * household writes that household's state; a visit about the building — a
 * locked gate, a demolition — writes the parcel's own, and never a household's.
 *
 * The earlier version let it default to "the first draft on the parcel", so
 * «المبنى مقفل بالكامل» was filed against apartment 1 — and the device, which
 * received the real `undefined`, recorded it against nobody. The same visit
 * meant two different things on the two sides of the sync.
 */
export async function applyVisitLocally(
  parcelNumber: string,
  visit: DraftVisitState & {
    /** The household this visit was about. `null` means the parcel as a whole. */
    draftClientId: string | null;
  },
): Promise<void> {
  await mutateParcel(parcelNumber, (current) => {
    if (visit.draftClientId) {
      return {
        ...current,
        // The parcel's own outcome is deliberately untouched: one finished
        // apartment says nothing about the building it stands in. Only the
        // knock count is a fact about the door.
        visitCount: current.visitCount + 1,
        drafts: current.drafts.map((draft) =>
          draft.clientId === visit.draftClientId ? applyVisitState(draft, visit) : draft,
        ),
      };
    }
    return {
      ...current,
      lastOutcome: visit.lastOutcome,
      lastDisposition: visit.lastOutcome ? OUTCOME_DISPOSITION[visit.lastOutcome] : null,
      lastVisitedAt: visit.lastVisitedAt,
      nextVisitAt: visit.nextVisitAt,
      visitCount: current.visitCount + 1,
    };
  });
}

/** Put one household into a parcel's list, newest edit first. */
function upsertDraft(drafts: readonly CachedDraft[], draft: CachedDraft): CachedDraft[] {
  const index = drafts.findIndex((d) => d.clientId === draft.clientId);
  if (index < 0) return [draft, ...drafts];
  const next = [...drafts];
  next[index] = draft;
  return next;
}

/**
 * Queue a household's form and reflect it on the worklist, in one transaction.
 *
 * No visit is recorded. Correcting a typo in a finished record is an edit to a
 * draft, not a second knock on the door — see `visitStateChanged`, which is how
 * the form screen decides between this and `saveDraftAndVisitLocally`.
 */
export async function saveDraftLocally(parcelNumber: string, draft: CachedDraft): Promise<void> {
  await writeDoorstep(parcelNumber, draft, null);
}

/**
 * Queue a household's form *and* the visit that produced it, in one
 * transaction.
 *
 * One transaction over both stores, rather than three sequential ones. The
 * previous version's docstring said "atomically" while doing an `enqueue` for
 * the draft, an `enqueue` for the visit and a worklist write, each opening and
 * closing its own connection — three points at which a phone that ran out of
 * battery on a doorstep could leave a queued visit referencing a draft that was
 * never queued.
 */
export async function saveDraftAndVisitLocally(
  parcelNumber: string,
  draft: CachedDraft,
  visit: DraftVisitState & { latitude?: number; longitude?: number },
): Promise<void> {
  await writeDoorstep(parcelNumber, draft, visit);
}

async function writeDoorstep(
  parcelNumber: string,
  draft: CachedDraft,
  visit: (DraftVisitState & { latitude?: number; longitude?: number }) | null,
): Promise<void> {
  const stored: CachedDraft = visit ? applyVisitState(draft, visit) : draft;
  const queuedDraft: QueuedDraft = {
    kind: 'draft',
    clientId: draft.clientId,
    parcelNumber,
    payload: draft.payload,
    updatedAt: draft.updatedAt ?? new Date().toISOString(),
  };

  const queuedVisit: QueuedVisit | null =
    visit && visit.lastOutcome
      ? {
          kind: 'visit',
          clientId: crypto.randomUUID(),
          parcelNumber,
          outcome: visit.lastOutcome,
          visitedAt: visit.lastVisitedAt ?? new Date().toISOString(),
          ...(visit.note ? { note: visit.note } : {}),
          ...(visit.nextVisitAt ? { nextVisitAt: visit.nextVisitAt } : {}),
          ...(visit.proxyName ? { proxyName: visit.proxyName } : {}),
          ...(visit.proxyPhone ? { proxyPhone: visit.proxyPhone } : {}),
          ...(visit.latitude !== undefined ? { latitude: visit.latitude } : {}),
          ...(visit.longitude !== undefined ? { longitude: visit.longitude } : {}),
          draftClientId: draft.clientId,
        }
      : null;

  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_WORKLIST, STORE_OUTBOX], 'readwrite');
      const outbox = tx.objectStore(STORE_OUTBOX);
      // Re-queuing the draft under its own `clientId` replaces the stored row,
      // so a draft that was rejected loses its complaint by being fixed.
      outbox.put(queuedDraft);

      if (queuedVisit) {
        /*
         * A corrected visit supersedes the malformed one it is correcting.
         *
         * Visits get a fresh id each time, so the rejected one would otherwise
         * sit in the queue forever *next to* its own fix — the worker adds the
         * missing note, saves, and the warning stays, because the thing being
         * complained about is a different row. Two rows, one visit, one of them
         * permanently unsendable.
         *
         * Scoped to `INVALID_RECORD` and to this household. Those are exactly
         * the rejections a re-save is an answer to; a visit refused because the
         * parcel is not in this worker's share is not corrected by writing it
         * again, and dropping it would lose a genuine record of work.
         */
        const queued = outbox.getAll();
        queued.onsuccess = () => {
          for (const row of (queued.result ?? []) as OutboxEntry[]) {
            if (
              row.kind === 'visit' &&
              row.draftClientId === draft.clientId &&
              row.lastErrorCode === 'INVALID_RECORD'
            ) {
              outbox.delete(row.clientId);
            }
          }
          outbox.put(queuedVisit);
        };
      }

      const worklist = tx.objectStore(STORE_WORKLIST);
      const get = worklist.get(parcelNumber);
      get.onsuccess = () => {
        const current = get.result as CachedParcel | undefined;
        if (!current) return;
        const base = withDefaults(current);
        worklist.put({
          ...base,
          // Again: a household's outcome is not the building's. Only the knock
          // count moves, and only when a knock actually happened.
          visitCount: queuedVisit ? base.visitCount + 1 : base.visitCount,
          drafts: upsertDraft(base.drafts, stored),
        });
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Take back a household that should never have existed.
 *
 * «مواطن جديد» tapped twice; a tenant entered against the neighbouring
 * building. Until this existed the mistake was permanent, and because an open
 * draft counts as unfinished work it also held its whole parcel in «مستحقة» —
 * sending the worker back to a real door indefinitely for a record that was a
 * typo.
 *
 * Four writes, one transaction, because a half-done discard is worse than none:
 *
 *  1. **Queue it.** Not a local delete. Once pushed, the server holds the
 *     `FieldDraft`, and removing it here alone would hide it from this device
 *     while it stayed in the supervisor's follow-up queue forever — the exact
 *     device/server divergence the rest of this file exists to prevent.
 *  2. **Drop what is still queued about it.** A draft that never left, and any
 *     visits naming it. Pushing a household and then un-pushing it in the same
 *     sync is work for nothing; the server treats the resulting discard of an
 *     unknown id as a no-op, which is the right answer.
 *  3. **Remove it from the worklist**, so the screen is right immediately.
 *  4. **Tombstone it**, so the next pull does not hand it back — the server
 *     will have stopped sending it, and without this that is indistinguishable
 *     from a household the server has not been told about yet.
 *
 * Visits already *sent* are deliberately kept. They are the record of knocks
 * that genuinely happened at that door, and they survive being wrong about who
 * lived behind it.
 */
export async function discardDraftLocally(
  parcelNumber: string,
  draftClientId: string,
  reason: string,
): Promise<void> {
  const entry: QueuedDiscard = {
    kind: 'discard',
    clientId: crypto.randomUUID(),
    draftClientId,
    parcelNumber,
    reason: reason.trim(),
    discardedAt: new Date().toISOString(),
  };

  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_WORKLIST, STORE_OUTBOX, STORE_RETIRED], 'readwrite');

      const outbox = tx.objectStore(STORE_OUTBOX);
      const queued = outbox.getAll();
      queued.onsuccess = () => {
        for (const row of (queued.result ?? []) as OutboxEntry[]) {
          const aboutThisHousehold =
            (row.kind === 'draft' && row.clientId === draftClientId) ||
            (row.kind === 'visit' && row.draftClientId === draftClientId);
          if (aboutThisHousehold) outbox.delete(row.clientId);
        }
        outbox.put(entry);
      };

      tx.objectStore(STORE_RETIRED).put({
        clientId: draftClientId,
        retiredAt: entry.discardedAt,
      } satisfies RetiredDraft);

      const worklist = tx.objectStore(STORE_WORKLIST);
      const get = worklist.get(parcelNumber);
      get.onsuccess = () => {
        const current = get.result as CachedParcel | undefined;
        if (!current) return;
        const base = withDefaults(current);
        worklist.put({
          ...base,
          drafts: base.drafts.filter((draft) => draft.clientId !== draftClientId),
        });
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Mark parcels somebody else registered while this device was offline.
 *
 * Marked, not deleted. Deleting was right when a parcel meant one household;
 * a cadastral number is a building, and the other four apartments in it are
 * still this worker's job.
 *
 * `registered` only — no counter. The count of registered households is
 * `registeredCitizens.length`, and the pull that follows every push replaces
 * that list with the server's. A second, separately-incremented number could
 * only ever disagree with it.
 */
export async function markParcelsRegistered(parcelNumbers: readonly string[]): Promise<void> {
  for (const parcelNumber of parcelNumbers) {
    await mutateParcel(parcelNumber, (current) => ({ ...current, registered: true }));
  }
}

/**
 * Retire the households this sync filed as real citizen records.
 *
 * Two writes, and both are needed. The parcel loses the draft and gains the
 * citizen, so the screen is right immediately; the tombstone makes it *stay*
 * right, because the next pull merges local drafts back in and would otherwise
 * resurrect this one — the server having stopped sending it is exactly what
 * being promoted looks like from here.
 */
export async function markDraftsPromoted(
  promoted: readonly PromotedDraftInfo[],
): Promise<void> {
  if (promoted.length === 0) return;
  await retireDrafts(promoted.map((item) => item.draftClientId));

  for (const item of promoted) {
    await mutateParcel(item.parcelNumber, (current) => {
      const already = current.registeredCitizens.some((c) => c.id === item.citizenId);
      return {
        ...current,
        registered: true,
        registeredCitizens: already
          ? current.registeredCitizens
          : [
              ...current.registeredCitizens,
              {
                id: item.citizenId,
                name: item.citizenName ?? 'مواطن مسجّل',
                phone: null,
                // Never a placeholder. An empty reference number renders as no
                // reference number; a fabricated one renders as a real record
                // the municipality cannot find.
                referenceNumber: item.referenceNumber || null,
              },
            ],
        drafts: current.drafts.filter((draft) => draft.clientId !== item.draftClientId),
      };
    });
  }
}

interface RetiredDraft {
  clientId: string;
  retiredAt: string;
}

/** Tombstone these households: finished, and never to be pulled back. */
export async function retireDrafts(clientIds: readonly string[]): Promise<void> {
  if (clientIds.length === 0) return;
  const retiredAt = new Date().toISOString();
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_RETIRED, 'readwrite');
      const store = tx.objectStore(STORE_RETIRED);
      for (const clientId of clientIds) store.put({ clientId, retiredAt } satisfies RetiredDraft);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** The tombstones, for the pull to subtract from what it merges back in. */
export async function readRetiredDraftIds(): Promise<Set<string>> {
  const rows = await run<RetiredDraft[]>(STORE_RETIRED, 'readonly', (store) => store.getAll());
  return new Set(rows.map((row) => row.clientId));
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
export async function markFailed(
  clientId: string,
  error: string,
  code: SyncFailureCode = 'SERVER_ERROR',
): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    const store = tx.objectStore(STORE_OUTBOX);
    const get = store.get(clientId);
    get.onsuccess = () => {
      const current = get.result as OutboxEntry | undefined;
      if (current) {
        store.put({
          ...current,
          lastError: error,
          lastErrorCode: code,
          lastFailedAt: new Date().toISOString(),
        });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * Give up on one queued record and drop it.
 *
 * The last resort, and deliberately not easy to reach: a rejected record is
 * never discarded automatically, because throwing away someone's morning
 * because the server disliked it is worse than a queue that will not drain.
 *
 * But "never" leaves a worker with a badge that counts up forever and a sync
 * that reports the same rejection every time — which is its own way of losing
 * the record, just noisier. Some failures genuinely cannot be resolved from a
 * phone (`SYNC_FAILURE_GUIDANCE[...].droppable`), and for those the honest
 * thing is to let it go, once, with a confirmation that says what is being
 * lost.
 */
export async function dropQueued(clientId: string): Promise<void> {
  await dequeue([clientId]);
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
    const tx = db.transaction(
      [STORE_WORKLIST, STORE_OUTBOX, STORE_RETIRED, STORE_META],
      'readwrite',
    );
    tx.objectStore(STORE_WORKLIST).clear();
    tx.objectStore(STORE_OUTBOX).clear();
    /*
     * The tombstones go too, and they have to.
     *
     * A retired id suppresses that household on every future pull. Left behind
     * when a different inspector signs in on the same phone, it would silently
     * hide one of *their* drafts — a household that exists on the server,
     * appears in their supervisor's follow-up queue, and simply never renders
     * on the device. That is the hardest possible bug to notice, so the set is
     * scoped to the session that created it.
     *
     * It is also the only thing here that grows without bound within a session,
     * and it grows by one small row per household filed — a year of full-time
     * work is a few hundred kilobytes, which is not worth pruning logic.
     */
    tx.objectStore(STORE_RETIRED).clear();
    tx.objectStore(STORE_META).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return true;
}
