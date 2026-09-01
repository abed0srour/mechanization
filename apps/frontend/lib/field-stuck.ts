'use client';

import {
  SYNC_FAILURE_GUIDANCE,
  ar,
  type SyncFailureCode,
  type SyncFailureGuidance,
} from '@mechanization/shared-schemas';
import type { CachedParcel, OutboxEntry } from './field-db';

/**
 * ───────────────────  What is stuck, why, and what to do  ────────────────────
 *
 * A rejected record is never dropped from the outbox. That is the right rule —
 * discarding a worker's morning because the server disliked it would be worse —
 * but it was only half implemented: the reason was written onto the row and
 * rendered nowhere. What a worker saw was a badge counting up and a sync that
 * said «رُفض ٣» every time, with no way to learn which three, why, or what to
 * do next. The queue was a black box that only ever grew.
 *
 * This turns each stuck row into the three things needed to act on it:
 *
 *   **what** — the household and the door, by name and number, not a uuid;
 *   **why**  — the server's own sentence;
 *   **how**  — who can fix it and the next step, from `SYNC_FAILURE_GUIDANCE`.
 *
 * The third is the one that was missing entirely, and it is the one that turns
 * a complaint into a task.
 */

export interface StuckRecord {
  /** The outbox key — what a retry, a fix or a drop addresses. */
  clientId: string;
  kind: OutboxEntry['kind'];
  parcelNumber: string;
  /** The household this row is about, when it names one. */
  draftClientId: string | null;
  /** A person's name where we have one, so a row is not a uuid. */
  citizenName: string | null;
  /** «زيارة» / «بيانات مواطن» / «حذف مواطن» — what kind of work is stuck. */
  what: string;
  /** The server's own sentence about this record. */
  serverMessage: string;
  code: SyncFailureCode;
  guidance: SyncFailureGuidance;
  failedAt: string | null;
}

const WHAT: Record<OutboxEntry['kind'], string> = {
  visit: 'نتيجة زيارة',
  draft: 'بيانات مواطن',
  discard: 'حذف مواطن',
};

function householdOf(entry: OutboxEntry): string | null {
  if (entry.kind === 'draft') return entry.clientId;
  if (entry.kind === 'discard') return entry.draftClientId;
  return entry.draftClientId ?? null;
}

/**
 * Name the household from the worklist rather than from the queued row.
 *
 * A queued visit carries a `draftClientId` and nothing else about the person,
 * so «زيارة إلى 8f3a-…» is what a naive row would say. The worklist still holds
 * the household — a rejected record does not remove it — so the name is there
 * to be found, and a worker who is told «أحمد خليل، العقار ٤١٢» knows
 * immediately which door this is about.
 */
function nameFor(entry: OutboxEntry, parcels: readonly CachedParcel[]): string | null {
  const householdId = householdOf(entry);
  if (!householdId) return null;
  const parcel = parcels.find((p) => p.parcelNumber === entry.parcelNumber);
  const draft = parcel?.drafts.find((d) => d.clientId === householdId);
  return draft?.citizenName ?? null;
}

/** Every queued record the server has refused, newest failure first. */
export function stuckRecords(
  outbox: readonly OutboxEntry[],
  parcels: readonly CachedParcel[],
): StuckRecord[] {
  return outbox
    .filter((entry) => Boolean(entry.lastError))
    .map((entry) => {
      const code = entry.lastErrorCode ?? 'SERVER_ERROR';
      const outcome = entry.kind === 'visit' ? ar.visitOutcome[entry.outcome] : null;
      return {
        clientId: entry.clientId,
        kind: entry.kind,
        parcelNumber: entry.parcelNumber,
        draftClientId: householdOf(entry),
        citizenName: nameFor(entry, parcels),
        what: outcome ? `${WHAT[entry.kind]} (${outcome})` : WHAT[entry.kind],
        serverMessage: entry.lastError ?? '',
        code,
        guidance: SYNC_FAILURE_GUIDANCE[code],
        failedAt: entry.lastFailedAt ?? null,
      } satisfies StuckRecord;
    })
    .sort((a, b) => (b.failedAt ?? '').localeCompare(a.failedAt ?? ''));
}
