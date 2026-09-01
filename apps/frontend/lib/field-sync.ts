'use client';

import {
  discardDraftSchema,
  mergeDraftLists,
  recordVisitSchema,
  upsertDraftSchema,
  type PromotionFailure,
  type SyncBatchInput,
} from '@mechanization/shared-schemas';
import { getTenantConfig, getWorklist, syncFieldWork, logApiError } from './api-client';
import {
  dequeue,
  loadWorklist,
  markDraftsPromoted,
  markFailed,
  markParcelsRegistered,
  readMeta,
  readOutbox,
  readRetiredDraftIds,
  saveWorklist,
  updateMeta,
  type CachedParcel,
  type OutboxEntry,
} from './field-db';

/**
 * ──────────────────────────────  Sync  ────────────────────────────────────
 *
 * Push, then pull, and never the other way round.
 *
 * Pulling first would overwrite the cached worklist with a server view that
 * does not yet know about this morning's forty visits, and the device would
 * spend the gap between the two showing doors as un-visited that the worker
 * remembers doing. Pushing first means the pull already reflects the work.
 *
 * Nothing here is automatic-on-a-timer. Sync runs when the worker asks, when
 * the browser reports the connection came back, and when the field screen
 * mounts — three moments a person can predict. A background timer syncing on a
 * metered village connection is not a favour.
 */

export interface SyncReport {
  pushed: number;
  /** Records the server already had. Expected after a retried push, not a fault. */
  duplicates: number;
  /** Still queued, with an error the worker can see. */
  rejected: number;
  /** Households taken back as mistakes and accepted by the server. */
  discarded: number;
  /** Doors somebody else registered while this device was offline. */
  superseded: string[];
  /**
   * Households the sync filed as real citizen records.
   *
   * Worth telling the worker about by name: this is the moment their morning
   * turned into rows on the municipality's register, and it is the only
   * feedback they get that it worked.
   */
  promoted: Array<{ parcelNumber: string; citizenName?: string; referenceNumber: string }>;
  /**
   * Households that were supposed to be filed and were not.
   *
   * The screen shows these loudly. A worker who was told at the door that a
   * household was «منجز» must not find out weeks later that the register never
   * received it — the whole promise of the COMPLETED outcome is that the sync
   * either files the record or says why it could not.
   */
  promotionFailures: PromotionFailure[];
  /**
   * Doors another worker had already collected.
   *
   * Should always be empty — shares are partitioned so two devices never hold
   * the same door — so anything here means a share moved while this device was
   * offline. Surfaced to the worker rather than swallowed, because it is a
   * supervisor's problem to fix and a duplicate nobody notices becomes two
   * citizen records to merge.
   */
  conflicted: string[];
  pulled: number;
  error?: string;
}

/**
 * Split the outbox into the batch shape the server takes.
 *
 * The three lists are applied server-side in the order drafts → visits →
 * discards, which is what lets a worker create a household, record a visit
 * against it and then realise it was the wrong door, all inside one offline
 * session, and have the envelope come out right.
 */
function toBatch(entries: readonly OutboxEntry[]): SyncBatchInput {
  const drafts: SyncBatchInput['drafts'] = [];
  const visits: SyncBatchInput['visits'] = [];
  const discards: NonNullable<SyncBatchInput['discards']> = [];

  for (const entry of entries) {
    if (entry.kind === 'draft') {
      drafts.push({
        clientId: entry.clientId,
        parcelNumber: entry.parcelNumber,
        payload: entry.payload,
        updatedAt: new Date(entry.updatedAt),
      });
      continue;
    }

    if (entry.kind === 'discard') {
      discards.push({
        clientId: entry.clientId,
        draftClientId: entry.draftClientId,
        parcelNumber: entry.parcelNumber,
        reason: entry.reason,
        discardedAt: new Date(entry.discardedAt),
      });
      continue;
    }

    const { kind, lastError, visitedAt, nextVisitAt, ...rest } = entry;
    void kind;
    void lastError;
    visits.push({
      ...rest,
      visitedAt: new Date(visitedAt),
      ...(nextVisitAt ? { nextVisitAt: new Date(nextVisitAt) } : {}),
    });
  }

  return { drafts, visits, discards };
}

/**
 * The server caps a batch at 200 of each. A worker who has been offline for a
 * week can exceed that, and the honest handling is to send the oldest first in
 * several passes rather than to fail the whole queue — partial progress on a
 * bad connection is the normal outcome here, not the exceptional one.
 */
const BATCH_LIMIT = 200;

function emptyReport(): SyncReport {
  return {
    pushed: 0,
    duplicates: 0,
    rejected: 0,
    discarded: 0,
    superseded: [],
    promoted: [],
    promotionFailures: [],
    conflicted: [],
    pulled: 0,
  };
}

/**
 * ────────────────  Keeping one bad record out of everyone's way  ─────────────
 *
 * The sync endpoint validates the **whole envelope** with `syncBatchSchema`
 * through a `ZodValidationPipe`. One malformed record therefore does not fail
 * by itself — it 422s the entire request, and since nothing is ever dropped
 * from the outbox, it does so again on every subsequent sync. A single visit
 * saved without its required note by an older build is enough to freeze a
 * worker's whole queue permanently, with a generic error and nothing naming the
 * culprit.
 *
 * So every record is put through its own schema here, before batching. Anything
 * that fails is marked with a reason and held back, and the rest goes. The held
 * record is not lost — it appears in «بانتظار الإرسال» with what is wrong and
 * how to fix it, which is the whole point of catching it here rather than
 * discovering it as a 422.
 */
function validateForPush(entry: OutboxEntry): { ok: true } | { ok: false; error: string } {
  const result =
    entry.kind === 'draft'
      ? upsertDraftSchema.safeParse({
          clientId: entry.clientId,
          parcelNumber: entry.parcelNumber,
          payload: entry.payload,
          updatedAt: new Date(entry.updatedAt),
        })
      : entry.kind === 'discard'
        ? discardDraftSchema.safeParse({
            clientId: entry.clientId,
            draftClientId: entry.draftClientId,
            parcelNumber: entry.parcelNumber,
            reason: entry.reason,
            discardedAt: new Date(entry.discardedAt),
          })
        : recordVisitSchema.safeParse({
            ...entry,
            visitedAt: new Date(entry.visitedAt),
            ...(entry.nextVisitAt ? { nextVisitAt: new Date(entry.nextVisitAt) } : {}),
          });

  if (result.success) return { ok: true };
  // The validator's own Arabic, which names the field rather than the record.
  const issue = result.error.issues[0];
  return { ok: false, error: issue?.message ?? 'السجل غير صالح' };
}

export async function pushOutbox(tenant: string, token: string): Promise<SyncReport> {
  const report: SyncReport = emptyReport();

  const queued = await readOutbox();

  const sendable: OutboxEntry[] = [];
  for (const entry of queued) {
    const check = validateForPush(entry);
    if (check.ok) {
      sendable.push(entry);
      continue;
    }
    report.rejected += 1;
    await markFailed(entry.clientId, check.error, 'INVALID_RECORD');
  }

  // Oldest work first, so a queue too large for one batch drains in the order
  // it was collected.
  let remaining = sendable.sort(byQueuedAt);

  while (remaining.length > 0) {
    const slice = remaining.slice(0, BATCH_LIMIT);
    const batch = toBatch(slice);

    const result = await syncFieldWork(tenant, token, batch);
    const confirmed: string[] = [];

    for (const record of [...result.drafts, ...result.visits, ...(result.discards ?? [])]) {
      if (record.ok) {
        confirmed.push(record.clientId);
        if (record.duplicate) report.duplicates += 1;
        else report.pushed += 1;
      } else {
        report.rejected += 1;
        await markFailed(record.clientId, record.error ?? 'تعذّر الحفظ', record.code);
      }
    }

    await dequeue(confirmed);

    const promoted = result.promotedDrafts ?? [];
    if (promoted.length > 0) {
      await markDraftsPromoted(promoted);
      report.promoted.push(
        ...promoted.map((item) => ({
          parcelNumber: item.parcelNumber,
          citizenName: item.citizenName,
          referenceNumber: item.referenceNumber,
        })),
      );
    }

    // `duplicate` here is not a retry — it is a household discarded before it
    // was ever pushed, which is the commonest case and a success.
    report.discarded += (result.discards ?? []).filter((r) => r.ok).length;
    report.promotionFailures.push(...(result.promotionFailures ?? []));
    report.superseded.push(...result.supersededParcels);
    report.conflicted.push(...result.conflictedParcels);

    remaining = remaining.slice(BATCH_LIMIT);
    // Everything in this slice failed and stayed queued — retrying the same
    // records in a loop would spin forever.
    if (confirmed.length === 0 && remaining.length === 0) break;
  }

  await updateMeta({ lastPushedAt: new Date().toISOString() });
  return report;
}

/** Replace the cached worklist with the server's current view. */
export async function pullWorklist(
  tenant: string,
  token: string,
  inspectorId: string,
): Promise<number> {
  /*
    The config rides along with the worklist rather than being fetched by the
    draft form.

    That form is the register's own — it asks the tenant which أنواع العقارات
    are accepted before rendering a single choice — so fetching it at a doorstep
    would make the whole screen depend on a network the worker does not have.
    A sync is the one moment they are known to be online, so it is the moment to
    take it. A failure here must not cost the worklist, which is the far more
    valuable half.
  */
  const [worklist, config] = await Promise.all([
    getWorklist(tenant, token),
    getTenantConfig(tenant).catch(() => null),
  ]);

  const [existingLocal, retired] = await Promise.all([loadWorklist(), readRetiredDraftIds()]);
  const localByParcel = new Map(existingLocal.map((p) => [p.parcelNumber, p]));

  const parcels: CachedParcel[] = worklist.parcels.map((parcel) => {
    const local = localByParcel.get(parcel.parcelNumber);
    return {
      parcelNumber: parcel.parcelNumber,
      zoneId: parcel.zoneId,
      zoneCode: parcel.zoneCode,
      latitude: parcel.latitude,
      longitude: parcel.longitude,
      /*
       * The server's answer, full stop — not OR-ed with the device's.
       *
       * The push that precedes every pull has already filed this morning's
       * completions, so the bundle being merged here knows about them. Keeping
       * a local `true` alive across pulls made the flag one-way: a parcel
       * marked registered by a superseded report that later turned out to be
       * about a different building could never be un-marked, on that device,
       * ever.
       */
      registered: parcel.registered,
      registeredCitizens: parcel.registeredCitizens,
      lastOutcome: parcel.lastOutcome,
      lastDisposition: parcel.lastDisposition,
      lastVisitedAt: parcel.lastVisitedAt,
      nextVisitAt: parcel.nextVisitAt,
      visitCount: parcel.visitCount,
      /*
       * The one field the server does not simply win.
       *
       * A household entered at a door ten minutes ago exists only here; the
       * retired set is what stops a *promoted* one being mistaken for it. The
       * rule itself lives in shared-schemas, next to the server's copy of it,
       * where it can be tested.
       */
      drafts: mergeDraftLists(parcel.drafts, local?.drafts ?? [], retired),
    };
  });

  await saveWorklist(parcels, {
    lastPulledAt: worklist.generatedAt
      ? new Date(worklist.generatedAt).toISOString()
      : new Date().toISOString(),
    inspectorId,
    tenant,
    // Kept from the previous pull when this one could not reach it: a stale
    // property-type list beats a form that will not render.
    ...(config ? { config } : {}),
  });

  return parcels.length;
}


/**
 * The whole cycle. Safe to call when offline — it reports the failure and
 * leaves every queued record exactly where it was.
 */
export async function syncNow(
  tenant: string,
  token: string,
  inspectorId: string,
): Promise<SyncReport> {
  try {
    const report = await pushOutbox(tenant, token);
    if (report.superseded.length > 0) await markParcelsRegistered(report.superseded);
    report.pulled = await pullWorklist(tenant, token, inspectorId);
    return report;
  } catch (caught) {
    logApiError(caught);
    return {
      ...emptyReport(),
      pulled: (await loadWorklist()).length,
      error:
        caught instanceof Error
          ? caught.message
          : 'تعذّرت المزامنة. سيبقى العمل محفوظاً على الجهاز.',
    };
  }
}

/**
 * A different inspector signing in on the same device must not inherit the
 * previous one's sector — but they also must not silently destroy unsynced work
 * belonging to that person. The caller shows this as a blocking warning.
 */
export async function foreignQueueOwner(inspectorId: string): Promise<string | null> {
  const meta = await readMeta();
  if (!meta.inspectorId || meta.inspectorId === inspectorId) return null;
  const pending = await readOutbox();
  return pending.length > 0 ? meta.inspectorId : null;
}

/**
 * Outbox entries carry their own timestamps; all three kinds sort together.
 *
 * This orders the *batching* — which records make it into which envelope when a
 * week's queue exceeds the server's cap — not the order they are applied. That
 * is fixed at drafts → visits → discards inside each envelope, by
 * `syncBatchSchema`, so a household created and then taken back in the same
 * offline session comes out right however the queue happened to be sliced.
 */
function queuedAt(entry: OutboxEntry): string {
  if (entry.kind === 'draft') return entry.updatedAt;
  if (entry.kind === 'discard') return entry.discardedAt;
  return entry.visitedAt;
}

function byQueuedAt(a: OutboxEntry, b: OutboxEntry): number {
  return queuedAt(a).localeCompare(queuedAt(b));
}
