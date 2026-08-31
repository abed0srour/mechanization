'use client';

import type { SyncBatchInput } from '@mechanization/shared-schemas';
import { getTenantConfig, getWorklist, syncFieldWork, logApiError } from './api-client';
import {
  dequeue,
  loadWorklist,
  markFailed,
  readMeta,
  readOutbox,
  removeParcels,
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
  /** Doors that were registered by someone else and left the worklist. */
  superseded: string[];
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

/** Split the outbox into the batch shape the server takes. */
function toBatch(entries: readonly OutboxEntry[]): SyncBatchInput {
  const drafts: SyncBatchInput['drafts'] = [];
  const visits: SyncBatchInput['visits'] = [];

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

    const { kind, lastError, visitedAt, nextVisitAt, ...rest } = entry;
    void kind;
    void lastError;
    visits.push({
      ...rest,
      visitedAt: new Date(visitedAt),
      ...(nextVisitAt ? { nextVisitAt: new Date(nextVisitAt) } : {}),
    });
  }

  return { drafts, visits };
}

/**
 * The server caps a batch at 200 of each. A worker who has been offline for a
 * week can exceed that, and the honest handling is to send the oldest first in
 * several passes rather than to fail the whole queue — partial progress on a
 * bad connection is the normal outcome here, not the exceptional one.
 */
const BATCH_LIMIT = 200;

export async function pushOutbox(tenant: string, token: string): Promise<SyncReport> {
  const report: SyncReport = {
    pushed: 0,
    duplicates: 0,
    rejected: 0,
    superseded: [],
    conflicted: [],
    pulled: 0,
  };

  let remaining = await readOutbox();
  // Oldest work first, so a queue too large for one batch drains in the order
  // it was collected.
  remaining = remaining.slice().sort(byQueuedAt);

  while (remaining.length > 0) {
    const slice = remaining.slice(0, BATCH_LIMIT);
    const batch = toBatch(slice);

    const result = await syncFieldWork(tenant, token, batch);
    const confirmed: string[] = [];

    for (const record of [...result.drafts, ...result.visits]) {
      if (record.ok) {
        confirmed.push(record.clientId);
        if (record.duplicate) report.duplicates += 1;
        else report.pushed += 1;
      } else {
        report.rejected += 1;
        await markFailed(record.clientId, record.error ?? 'تعذّر الحفظ');
      }
    }

    await dequeue(confirmed);
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

  const parcels: CachedParcel[] = worklist.parcels.map((parcel) => ({
    parcelNumber: parcel.parcelNumber,
    zoneId: parcel.zoneId,
    zoneCode: parcel.zoneCode,
    latitude: parcel.latitude,
    longitude: parcel.longitude,
    registered: parcel.registered,
    lastOutcome: parcel.lastOutcome,
    lastDisposition: parcel.lastDisposition,
    lastVisitedAt: parcel.lastVisitedAt,
    nextVisitAt: parcel.nextVisitAt,
    visitCount: parcel.visitCount,
    draft: parcel.draft,
  }));

  await saveWorklist(parcels, {
    lastPulledAt: worklist.generatedAt,
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
    if (report.superseded.length > 0) await removeParcels(report.superseded);
    report.pulled = await pullWorklist(tenant, token, inspectorId);
    return report;
  } catch (caught) {
    logApiError(caught);
    return {
      pushed: 0,
      duplicates: 0,
      rejected: 0,
      superseded: [],
      conflicted: [],
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

/** Outbox entries carry their own timestamps; drafts and visits sort together. */
function byQueuedAt(a: OutboxEntry, b: OutboxEntry): number {
  const at = a.kind === 'draft' ? a.updatedAt : a.visitedAt;
  const bt = b.kind === 'draft' ? b.updatedAt : b.visitedAt;
  return at.localeCompare(bt);
}
