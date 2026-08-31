import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  OUTCOME_DISPOSITION,
  adminCreateCitizenSchema,
  draftGaps,
  splitEvenly,
  type AssignZoneInput,
  type FieldDraftPayload,
  type SyncBatchInput,
  type SyncBatchResult,
  type SyncRecordResult,
  type VisitDisposition,
  type VisitOutcome,
  type ZoneCoverage,
} from '@mechanization/shared-schemas';
import { TenantContextService } from '../../../infrastructure/context/tenant-context.service';
import { withConnectionRetry } from '../../../infrastructure/prisma/with-connection-retry';
import { ConflictError, NotFoundError, ValidationError } from '../../common/exceptions';
import { CitizensService } from '../citizens/citizens.service';
import { Prisma } from '../../../generated/tenant-client';

/**
 * ────────────────────────  Field work (العمل الميداني)  ──────────────────────
 *
 * Everything here exists to answer one question the system could not previously
 * even represent: **why is this house not on the register yet?**
 *
 * The three concepts and why they are separate are documented on the schemas in
 * `@mechanization/shared-schemas/field-work.schema`. What this service adds is
 * the two rules that keep them honest:
 *
 *  1. **Disposition is computed, never accepted.** The device sends an outcome;
 *     the server derives what happens next from `OUTCOME_DISPOSITION`. A worker
 *     who could send both would be able to close a sector by relabelling every
 *     refusal.
 *
 *  2. **A worker may only write inside their own share.** Assignment is the
 *     mechanism that makes offline duplicates nearly impossible, and it is
 *     worth nothing if the sync endpoint accepts a visit to any parcel in the
 *     municipality.
 *
 * A zone may be worked by several people at once, so that share is a set of
 * *parcels*, not a zone: `resolveShares` partitions a zone's parcels between
 * its active assignments, and every read and write below goes through it. Two
 * devices are therefore never handed the same door even though neither can see
 * the other's work until it syncs.
 */

/** How many offending numbers a refusal names before it summarises, as in ZonesService. */
const MAX_NAMED_PARCELS = 5;

/** "عقارات مكلَّفة لـ ندى: 401، 402 و3 غيرها" — names a few, then counts. */
function namedClashes(clashes: readonly string[], claimedBy: ReadonlyMap<string, string>): string {
  const named = clashes.slice(0, MAX_NAMED_PARCELS);
  const rest = clashes.length - named.length;
  const holder = claimedBy.get(clashes[0]!) ?? '';
  return `عقارات مكلَّفة لـ ${holder}: ${named.join('، ')}${rest > 0 ? ` و${rest} غيرها` : ''}`;
}

export interface AssignmentSummary {
  id: string;
  zoneId: string;
  zoneName: string;
  zoneCode: string;
  /** Parcels in the whole zone. */
  zoneParcelCount: number;
  /** Parcels in *this* worker's share of it. */
  parcelCount: number;
  /** True when this is the holder of everything nobody else claimed. */
  isRemainder: boolean;
  inspectorId: string;
  inspectorName: string;
  note: string | null;
  dueAt: Date | null;
  releasedAt: Date | null;
  createdAt: Date;
}

/** One door on a worker's list, with everything needed to work it offline. */
export interface WorklistParcel {
  parcelNumber: string;
  zoneId: string;
  zoneCode: string;
  latitude: number | null;
  longitude: number | null;
  /** A citizen is already registered here — nothing to collect. */
  registered: boolean;
  lastOutcome: VisitOutcome | null;
  lastDisposition: VisitDisposition | null;
  lastVisitedAt: Date | null;
  nextVisitAt: Date | null;
  visitCount: number;
  /**
   * An unfinished draft to resume, carried in full so the device can keep
   * editing it with no network at all.
   */
  draft: { clientId: string; payload: FieldDraftPayload; gaps: string[] } | null;
}

export interface Worklist {
  /** Server clock at the moment the bundle was built, shown as "synced at". */
  generatedAt: Date;
  zones: Array<{ id: string; name: string; code: string; color: string; dueAt: Date | null }>;
  parcels: WorklistParcel[];
}

export interface FollowUpItem {
  parcelNumber: string;
  outcome: VisitOutcome;
  disposition: VisitDisposition;
  visitedAt: Date;
  nextVisitAt: Date | null;
  note: string | null;
  proxyName: string | null;
  proxyPhone: string | null;
  inspectorId: string;
  inspectorName: string;
  attempts: number;
  draftGapCount: number | null;
}

/** `SELECT DISTINCT ON` result — the newest visit for each parcel. */
interface LatestVisitRow {
  parcelNumber: string;
  outcome: VisitOutcome;
  disposition: VisitDisposition;
  visitedAt: Date;
  nextVisitAt: Date | null;
  attempts: bigint;
}

/**
 * Split a zone's parcels between the people currently working it.
 *
 * The rule in one line: an assignment with an explicit `parcelNumbers` holds
 * exactly those; the one with an empty list holds everything left over.
 *
 * This is the single place the partition is computed. `worklistFor`,
 * `allowedParcels` and `coverage` all call it rather than each deriving "who
 * holds what" their own way — three implementations would be three chances for
 * the worklist a device downloads to disagree with the check the sync endpoint
 * runs against it, and a worker whose visits are rejected as outside a sector
 * they were shown is the worst failure this feature has.
 *
 * Exported, and a plain function rather than a method, because it is the piece
 * worth testing on its own: it is pure, and every guarantee about two workers
 * never holding the same door reduces to it.
 */
export function partitionZone(
  zoneParcels: readonly string[],
  assignments: ReadonlyArray<{ id: string; parcelNumbers: string[] }>,
): Map<string, string[]> {
  const inZone = new Set(zoneParcels);
  const claimed = new Set<string>();
  const shares = new Map<string, string[]>();

  for (const assignment of assignments) {
    if (assignment.parcelNumbers.length === 0) continue;
    // Intersected with the zone rather than trusted: a cadastre re-import can
    // drop a number a stale assignment still names, and handing a worker a
    // parcel their zone no longer contains would put a door on their list that
    // the sync check then refuses.
    const share = assignment.parcelNumbers.filter((n) => inZone.has(n));
    shares.set(assignment.id, share);
    for (const parcelNumber of share) claimed.add(parcelNumber);
  }

  const remainder = assignments.find((a) => a.parcelNumbers.length === 0);
  if (remainder) {
    shares.set(
      remainder.id,
      zoneParcels.filter((n) => !claimed.has(n)),
    );
  }
  return shares;
}

@Injectable()
export class FieldWorkService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly citizens: CitizensService,
    private readonly events: EventEmitter2,
  ) {}

  private get db() {
    return this.tenantContext.prisma;
  }

  private record(input: {
    tenantSlug: string;
    action: string;
    entityId: string;
    entityType: 'FieldAssignment' | 'FieldVisit' | 'FieldDraft';
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    actor: { id: string; role: string };
  }): void {
    this.events.emit('field-work.changed', {
      tenantSlug: input.tenantSlug,
      action: input.action,
      entityId: input.entityId,
      entityType: input.entityType,
      before: input.before,
      after: input.after,
      actorId: input.actor.id,
      actorRole: input.actor.role,
    });
  }

  // ──────────────────────────────  Assignment  ─────────────────────────────

  /**
   * Hand a sector, or shares of it, to one or more field workers.
   *
   * Several people may work one zone at the same time. What may not happen is
   * two of them being handed the same door, so this refuses rather than
   * silently resolving — each conflict below would otherwise surface later as
   * two records for one household, discovered at promotion when merging is
   * expensive:
   *
   *  - somebody already assigned to this zone, which makes "which of my
   *    assignments owns 412" unanswerable;
   *  - a parcel already claimed by another active share;
   *  - a second remainder holder, since both would be handed every unclaimed
   *    parcel in the zone.
   *
   * `SPLIT` divides what is currently unclaimed into contiguous, equal shares —
   * one explicit share per worker, so the group's own partition is fixed at the
   * moment of assignment rather than being recomputed as people come and go.
   *
   * All of it in one transaction: assigning three people and having the third
   * fail on a conflict would otherwise leave a sector half handed out, with no
   * indication which half.
   */
  async assign(
    tenantSlug: string,
    input: AssignZoneInput,
    actor: { id: string; role: string },
  ): Promise<AssignmentSummary[]> {
    const zone = await this.db.zone.findUnique({ where: { id: input.zoneId } });
    if (!zone) throw new NotFoundError('القطاع غير موجود');

    const inspectors = await this.db.user.findMany({
      where: { id: { in: input.inspectorIds }, kind: 'STAFF' },
      select: { id: true, isActive: true, firstName: true, lastName: true },
    });
    if (inspectors.length !== input.inspectorIds.length) {
      throw new NotFoundError('أحد الموظفين غير موجود');
    }
    const inactive = inspectors.find((row) => !row.isActive);
    if (inactive) {
      throw new ValidationError(
        `لا يمكن تكليف موظف غير مُفعّل: ${inactive.firstName} ${inactive.lastName}`.trim(),
      );
    }

    const active = await this.db.fieldAssignment.findMany({
      where: { zoneId: input.zoneId, releasedAt: null },
      include: { inspector: { select: { firstName: true, lastName: true } } },
    });

    const already = active.find((row) => input.inspectorIds.includes(row.inspectorId));
    if (already) {
      const name = `${already.inspector.firstName} ${already.inspector.lastName}`.trim();
      throw new ConflictError(`${name} مكلَّف بهذا القطاع بالفعل — عدّل التكليف القائم`);
    }

    const shares = this.resolveShares(zone.parcelNumbers, active, input);

    const created = await this.db.$transaction(
      shares.map((parcelNumbers, index) =>
        this.db.fieldAssignment.create({
          data: {
            zoneId: input.zoneId,
            inspectorId: input.inspectorIds[index]!,
            assignedById: actor.id,
            parcelNumbers,
            note: input.note ?? null,
            dueAt: input.dueAt ?? null,
          },
          include: {
            zone: { select: { name: true, code: true, parcelNumbers: true } },
            inspector: { select: { firstName: true, lastName: true } },
          },
        }),
      ),
    );

    this.record({
      tenantSlug,
      action: 'FIELD_ASSIGNMENT_CREATED',
      entityType: 'FieldAssignment',
      entityId: created[0]?.id ?? input.zoneId,
      after: {
        zoneCode: zone.code,
        mode: input.mode,
        inspectors: input.inspectorIds.length,
        shares: shares.map((share) => share.length),
      },
      actor,
    });

    return created.map(toAssignmentSummary);
  }

  /**
   * The parcel list each new assignment gets, or a refusal naming why not.
   *
   * Split out from `assign` because it is the whole of the decision and none of
   * the I/O — every rule about who may hold what lives here, where it can be
   * read in one screen.
   */
  private resolveShares(
    zoneParcels: readonly string[],
    active: ReadonlyArray<{ parcelNumbers: string[]; inspector: { firstName: string; lastName: string } }>,
    input: AssignZoneInput,
  ): string[][] {
    const claimedBy = new Map<string, string>();
    for (const row of active) {
      const name = `${row.inspector.firstName} ${row.inspector.lastName}`.trim();
      for (const parcelNumber of row.parcelNumbers) claimedBy.set(parcelNumber, name);
    }
    const remainderHolder = active.find((row) => row.parcelNumbers.length === 0);

    if (input.mode === 'REMAINDER') {
      if (remainderHolder) {
        const name =
          `${remainderHolder.inspector.firstName} ${remainderHolder.inspector.lastName}`.trim();
        throw new ConflictError(
          `${name} يغطّي بقية عقارات القطاع — حدّد العقارات المطلوبة لهذا الموظف`,
        );
      }
      // One empty list: the partition resolves it to "everything unclaimed" on
      // every read, so it keeps up as other shares are added and released.
      return [[]];
    }

    if (input.mode === 'EXPLICIT') {
      const wanted = [...new Set(input.parcelNumbers.map((n) => n.trim()).filter(Boolean))];
      const outside = wanted.filter((n) => !zoneParcels.includes(n));
      if (outside.length > 0) {
        throw new ValidationError(
          `عقارات خارج القطاع: ${outside.slice(0, MAX_NAMED_PARCELS).join('، ')}`,
        );
      }
      const clashes = wanted.filter((n) => claimedBy.has(n));
      if (clashes.length > 0) {
        throw new ConflictError(namedClashes(clashes, claimedBy));
      }
      return [wanted];
    }

    // SPLIT — divide what nobody holds yet.
    //
    // A remainder holder owns every unclaimed parcel by definition, so there is
    // nothing left to divide while one exists. Saying so is better than handing
    // out shares that silently shrink their sector to nothing.
    if (remainderHolder) {
      const name =
        `${remainderHolder.inspector.firstName} ${remainderHolder.inspector.lastName}`.trim();
      throw new ConflictError(
        `${name} يغطّي بقية القطاع — أنهِ تكليفه أولاً ليتم تقسيم القطاع`,
      );
    }

    const unclaimed = zoneParcels.filter((n) => !claimedBy.has(n));
    if (unclaimed.length < input.inspectorIds.length) {
      throw new ValidationError(
        `لا يكفي عدد العقارات غير المكلَّفة (${unclaimed.length}) لتقسيمها على ${input.inspectorIds.length} موظفين`,
      );
    }
    return splitEvenly(unclaimed, input.inspectorIds.length);
  }

  /** End a sector assignment, keeping the row as the record of who held it. */
  async release(
    tenantSlug: string,
    assignmentId: string,
    actor: { id: string; role: string },
  ): Promise<void> {
    const existing = await this.db.fieldAssignment.findUnique({ where: { id: assignmentId } });
    if (!existing) throw new NotFoundError('التكليف غير موجود');
    if (existing.releasedAt) throw new ValidationError('التكليف منتهٍ بالفعل');

    await this.db.fieldAssignment.update({
      where: { id: assignmentId },
      data: { releasedAt: new Date() },
    });

    this.record({
      tenantSlug,
      action: 'FIELD_ASSIGNMENT_RELEASED',
      entityType: 'FieldAssignment',
      entityId: assignmentId,
      before: { zoneId: existing.zoneId, inspectorId: existing.inspectorId },
      actor,
    });
  }

  async listAssignments(includeReleased = false): Promise<AssignmentSummary[]> {
    const rows = await withConnectionRetry(() =>
      this.db.fieldAssignment.findMany({
        where: includeReleased ? {} : { releasedAt: null },
        include: {
          zone: { select: { name: true, code: true, parcelNumbers: true } },
          inspector: { select: { firstName: true, lastName: true } },
        },
        orderBy: [{ releasedAt: 'asc' }, { createdAt: 'desc' }],
      }),
    );
    return rows.map(toAssignmentSummary);
  }

  // ───────────────────────────────  Worklist  ──────────────────────────────

  /**
   * Everything one worker needs to spend a day offline.
   *
   * Built as a single bundle rather than a paged list on purpose: the device
   * downloads this once while it still has signal, and from then on it must be
   * able to answer "what do I still need from number 412" with no network. A
   * sector is a few hundred parcels, so the whole thing is a small JSON
   * document — far cheaper than the alternative of a worker standing at a door
   * unable to load the form.
   */
  async worklistFor(inspectorId: string): Promise<Worklist> {
    const assignments = await this.db.fieldAssignment.findMany({
      where: { inspectorId, releasedAt: null },
      include: { zone: true },
    });

    /*
      Only this worker's share of each zone, not the whole zone.

      The partition needs every active assignment on the zone to be computed —
      the remainder holder's list is defined by what the others claimed — so the
      siblings are fetched even though none of their parcels end up here.
    */
    const zoneIds = [...new Set(assignments.map((a) => a.zoneId))];
    const siblings = await this.db.fieldAssignment.findMany({
      where: { zoneId: { in: zoneIds }, releasedAt: null },
      select: { id: true, zoneId: true, parcelNumbers: true },
    });

    const parcelToZone = new Map<string, { id: string; code: string; dueAt: Date | null }>();
    for (const assignment of assignments) {
      const share = partitionZone(
        assignment.zone.parcelNumbers,
        siblings.filter((row) => row.zoneId === assignment.zoneId),
      ).get(assignment.id);

      for (const parcelNumber of share ?? []) {
        parcelToZone.set(parcelNumber, {
          id: assignment.zone.id,
          code: assignment.zone.code,
          dueAt: assignment.dueAt,
        });
      }
    }

    const parcelNumbers = [...parcelToZone.keys()];
    if (parcelNumbers.length === 0) {
      return { generatedAt: new Date(), zones: [], parcels: [] };
    }

    const [coordinates, registered, latestVisits, drafts] = await Promise.all([
      this.db.parcel.findMany({
        where: { parcelNumber: { in: parcelNumbers } },
        select: { parcelNumber: true, latitude: true, longitude: true },
      }),
      // "Registered" means somebody's claim already names this parcel. Distinct
      // because an apartment block is one number shared by every resident.
      this.db.propertyEntry.findMany({
        where: { propertyNumber: { in: parcelNumbers } },
        select: { propertyNumber: true },
        distinct: ['propertyNumber'],
      }),
      this.latestVisits(parcelNumbers),
      this.db.fieldDraft.findMany({
        where: { parcelNumber: { in: parcelNumbers }, promotedAt: null },
        orderBy: { deviceUpdatedAt: 'desc' },
      }),
    ]);

    const coordinateOf = new Map(coordinates.map((p) => [p.parcelNumber, p]));
    const registeredSet = new Set(registered.map((p) => p.propertyNumber));
    const visitOf = new Map(latestVisits.map((v) => [v.parcelNumber, v]));
    // Newest draft wins where a parcel somehow has two — ordered above, so the
    // first one seen for a number is the one to resume.
    const draftOf = new Map<string, (typeof drafts)[number]>();
    for (const draft of drafts) {
      if (!draftOf.has(draft.parcelNumber)) draftOf.set(draft.parcelNumber, draft);
    }

    const parcels: WorklistParcel[] = parcelNumbers.map((parcelNumber) => {
      const zone = parcelToZone.get(parcelNumber)!;
      const visit = visitOf.get(parcelNumber);
      const draft = draftOf.get(parcelNumber);
      const point = coordinateOf.get(parcelNumber);

      return {
        parcelNumber,
        zoneId: zone.id,
        zoneCode: zone.code,
        latitude: point?.latitude ?? null,
        longitude: point?.longitude ?? null,
        registered: registeredSet.has(parcelNumber),
        lastOutcome: visit?.outcome ?? null,
        lastDisposition: visit?.disposition ?? null,
        lastVisitedAt: visit?.visitedAt ?? null,
        nextVisitAt: visit?.nextVisitAt ?? null,
        visitCount: visit ? Number(visit.attempts) : 0,
        draft: draft
          ? {
              clientId: draft.clientId,
              payload: draft.payload as FieldDraftPayload,
              gaps: draft.gaps,
            }
          : null,
      };
    });

    return {
      generatedAt: new Date(),
      zones: assignments.map((a) => ({
        id: a.zone.id,
        name: a.zone.name,
        code: a.zone.code,
        color: a.zone.color,
        dueAt: a.dueAt,
      })),
      parcels,
    };
  }

  /**
   * The newest visit per parcel, plus how many attempts that parcel has had.
   *
   * `DISTINCT ON` rather than a groupBy-then-refetch: Prisma cannot express
   * "the whole row at the maximum of a column", and doing it in two queries
   * means the second one can see a visit the first did not.
   */
  private async latestVisits(parcelNumbers: readonly string[]): Promise<LatestVisitRow[]> {
    if (parcelNumbers.length === 0) return [];
    return withConnectionRetry(() =>
      this.db.$queryRaw<LatestVisitRow[]>`
        SELECT DISTINCT ON (v."parcelNumber")
               v."parcelNumber",
               v."outcome",
               v."disposition",
               v."visitedAt",
               v."nextVisitAt",
               (SELECT COUNT(*) FROM "field_visits" c WHERE c."parcelNumber" = v."parcelNumber") AS "attempts"
          FROM "field_visits" v
         WHERE v."parcelNumber" IN (${Prisma.join(parcelNumbers)})
         ORDER BY v."parcelNumber", v."visitedAt" DESC
      `,
    );
  }

  // ─────────────────────────────────  Sync  ────────────────────────────────

  /**
   * Accept one batch of offline work.
   *
   * Every record is independent, exactly as in the spreadsheet importer: a
   * worker back from a day in a sector with no signal is pushing a hundred
   * visits, and one malformed record must not cost them the other ninety-nine.
   * The device keeps whatever failed and reports it.
   *
   * Idempotent throughout. `clientId` is generated on the device, so a push that
   * succeeded but whose response was lost to a dropped connection can be
   * retried safely — the second attempt reports `duplicate` and the device
   * clears its queue.
   */
  async sync(
    tenantSlug: string,
    batch: SyncBatchInput,
    actor: { id: string; role: string },
  ): Promise<SyncBatchResult> {
    const allowed = await this.allowedParcels(actor);

    const draftResults: SyncRecordResult[] = [];
    /** clientId → database id, so a visit in this batch can point at its draft. */
    const draftIds = new Map<string, string>();

    for (const draft of batch.drafts) {
      if (!allowed.has(draft.parcelNumber)) {
        draftResults.push({
          clientId: draft.clientId,
          ok: false,
          error: `العقار ${draft.parcelNumber} ليس ضمن قطاعك`,
        });
        continue;
      }

      try {
        const gaps = draftGaps(draft.payload).map((gap) => gap.path);
        const payload = draft.payload as unknown as Prisma.InputJsonValue;

        const existing = await this.db.fieldDraft.findUnique({
          where: { clientId: draft.clientId },
          select: { id: true, deviceUpdatedAt: true, promotedAt: true },
        });

        if (!existing) {
          const created = await this.db.fieldDraft.create({
            data: {
              clientId: draft.clientId,
              parcelNumber: draft.parcelNumber,
              inspectorId: actor.id,
              payload,
              gaps,
              deviceUpdatedAt: draft.updatedAt,
            },
            select: { id: true },
          });
          draftIds.set(draft.clientId, created.id);
          draftResults.push({ clientId: draft.clientId, ok: true });
          continue;
        }

        draftIds.set(draft.clientId, existing.id);

        // A promoted draft is history. Re-pushing it from a device that has not
        // refreshed its worklist must not resurrect it over the real record.
        if (existing.promotedAt) {
          draftResults.push({ clientId: draft.clientId, ok: true, duplicate: true });
          continue;
        }

        // Last write wins by device clock. Correct here specifically because
        // the only writer is the one worker the parcel is assigned to — this
        // would be the wrong rule for a shared document.
        if (existing.deviceUpdatedAt > draft.updatedAt) {
          draftResults.push({ clientId: draft.clientId, ok: true, duplicate: true });
          continue;
        }

        await this.db.fieldDraft.update({
          where: { id: existing.id },
          data: { payload, gaps, deviceUpdatedAt: draft.updatedAt },
        });
        draftResults.push({ clientId: draft.clientId, ok: true });
      } catch (caught) {
        draftResults.push({
          clientId: draft.clientId,
          ok: false,
          error: caught instanceof Error ? caught.message : 'تعذّر حفظ المسودة',
        });
      }
    }

    const visitResults: SyncRecordResult[] = [];
    const touchedParcels = new Set<string>();

    for (const visit of batch.visits) {
      if (!allowed.has(visit.parcelNumber)) {
        visitResults.push({
          clientId: visit.clientId,
          ok: false,
          error: `العقار ${visit.parcelNumber} ليس ضمن قطاعك`,
        });
        continue;
      }

      try {
        const existing = await this.db.fieldVisit.findUnique({
          where: { clientId: visit.clientId },
          select: { id: true },
        });
        if (existing) {
          visitResults.push({ clientId: visit.clientId, ok: true, duplicate: true });
          touchedParcels.add(visit.parcelNumber);
          continue;
        }

        // A visit may name a draft pushed in this same batch, or one the server
        // already holds from an earlier sync.
        let draftId: string | null = null;
        if (visit.draftClientId) {
          draftId =
            draftIds.get(visit.draftClientId) ??
            (
              await this.db.fieldDraft.findUnique({
                where: { clientId: visit.draftClientId },
                select: { id: true },
              })
            )?.id ??
            null;
        }

        await this.db.fieldVisit.create({
          data: {
            clientId: visit.clientId,
            parcelNumber: visit.parcelNumber,
            outcome: visit.outcome,
            // Derived, never taken from the device — see the class comment.
            disposition: OUTCOME_DISPOSITION[visit.outcome],
            inspectorId: actor.id,
            visitedAt: visit.visitedAt,
            note: visit.note ?? null,
            nextVisitAt: visit.nextVisitAt ?? null,
            latitude: visit.latitude ?? null,
            longitude: visit.longitude ?? null,
            proxyName: visit.proxyName ?? null,
            proxyPhone: visit.proxyPhone ?? null,
            draftId,
            citizenId: visit.citizenId ?? null,
          },
        });

        touchedParcels.add(visit.parcelNumber);
        visitResults.push({ clientId: visit.clientId, ok: true });
      } catch (caught) {
        visitResults.push({
          clientId: visit.clientId,
          ok: false,
          error: caught instanceof Error ? caught.message : 'تعذّر حفظ الزيارة',
        });
      }
    }

    this.record({
      tenantSlug,
      action: 'FIELD_SYNC',
      entityType: 'FieldVisit',
      entityId: actor.id,
      after: {
        visits: visitResults.filter((r) => r.ok && !r.duplicate).length,
        drafts: draftResults.filter((r) => r.ok && !r.duplicate).length,
        rejected: [...visitResults, ...draftResults].filter((r) => !r.ok).length,
      },
      actor,
    });

    const [supersededParcels, conflictedParcels] = await Promise.all([
      this.supersededAmong(touchedParcels),
      this.conflictsAmong(touchedParcels, actor.id),
    ]);

    return { drafts: draftResults, visits: visitResults, supersededParcels, conflictedParcels };
  }

  /**
   * Parcels in this push that somebody *else* had already visited.
   *
   * Should always be empty — the partition is designed so two devices never
   * hold the same door — so a non-empty result is a signal that something went
   * wrong upstream rather than a routine condition: most likely a supervisor
   * moved a share while this device was offline with a stale worklist. It is
   * surfaced instead of assumed away because a duplicate caught here is one
   * conversation, and the same duplicate caught at promotion is two citizen
   * records to merge by hand.
   */
  private async conflictsAmong(
    parcelNumbers: Set<string>,
    inspectorId: string,
  ): Promise<string[]> {
    if (parcelNumbers.size === 0) return [];
    const rows = await this.db.fieldVisit.findMany({
      where: {
        parcelNumber: { in: [...parcelNumbers] },
        inspectorId: { not: inspectorId },
        // A door someone else merely knocked on and found empty is not a
        // conflict; two people collecting the same household's data is.
        outcome: { in: ['COMPLETED', 'PARTIAL'] },
      },
      select: { parcelNumber: true },
      distinct: ['parcelNumber'],
    });
    return rows.map((row) => row.parcelNumber);
  }

  /**
   * Which of the parcels this device just worked are already registered.
   *
   * The one duplicate path per-worker assignment does not close: a citizen
   * filing through the public wizard while the worker is standing at their
   * door, offline and unable to see it. The device drops these from its
   * worklist rather than sending someone back to a finished house.
   */
  private async supersededAmong(parcelNumbers: Set<string>): Promise<string[]> {
    if (parcelNumbers.size === 0) return [];
    const rows = await this.db.propertyEntry.findMany({
      where: { propertyNumber: { in: [...parcelNumbers] } },
      select: { propertyNumber: true },
      distinct: ['propertyNumber'],
    });
    return rows.map((row) => row.propertyNumber);
  }

  /**
   * The parcel numbers this actor may write to.
   *
   * There is no privileged caller and no escape hatch: the sync endpoint is
   * `FIELD_INSPECTOR`-only, so every write is checked against the writer's own
   * share. An exemption for administrators would have been the one path by
   * which two records for one household could still appear, and there is no
   * reason for it — supervisors do not collect.
   *
   * An inspector holding no assignment gets an empty set and can write nothing,
   * which is the correct reading of "nobody has given you a sector yet".
   */
  private async allowedParcels(actor: { id: string; role: string }): Promise<Set<string>> {
    const mine = await this.db.fieldAssignment.findMany({
      where: { inspectorId: actor.id, releasedAt: null },
      select: { id: true, zoneId: true, zone: { select: { parcelNumbers: true } } },
    });
    if (mine.length === 0) return new Set();

    const siblings = await this.db.fieldAssignment.findMany({
      where: { zoneId: { in: [...new Set(mine.map((a) => a.zoneId))] }, releasedAt: null },
      select: { id: true, zoneId: true, parcelNumbers: true },
    });

    const allowed = new Set<string>();
    for (const assignment of mine) {
      const share = partitionZone(
        assignment.zone.parcelNumbers,
        siblings.filter((row) => row.zoneId === assignment.zoneId),
      ).get(assignment.id);
      for (const parcelNumber of share ?? []) allowed.add(parcelNumber);
    }
    return allowed;
  }

  // ──────────────────────────────  Reporting  ──────────────────────────────

  /**
   * Coverage per sector — the number the council actually asks for.
   *
   * `closed` is excluded from the denominator when the percentage is computed
   * by the caller. Without that a demolished building would sit in "not yet
   * visited" forever, coverage would never reach 100%, and staff would stop
   * believing the figure — which is how a coverage dashboard dies.
   */
  async coverage(): Promise<ZoneCoverage[]> {
    const zones = await this.db.zone.findMany({ orderBy: { code: 'asc' } });
    const allParcels = zones.flatMap((zone) => zone.parcelNumbers);
    if (allParcels.length === 0) {
      return zones.map((zone) => emptyCoverage(zone));
    }

    const [registered, latestVisits, assignments] = await Promise.all([
      this.db.propertyEntry.findMany({
        where: { propertyNumber: { in: allParcels } },
        select: { propertyNumber: true },
        distinct: ['propertyNumber'],
      }),
      this.latestVisits(allParcels),
      this.db.fieldAssignment.findMany({
        where: { releasedAt: null },
        include: { inspector: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const registeredSet = new Set(registered.map((row) => row.propertyNumber));
    const dispositionOf = new Map(latestVisits.map((v) => [v.parcelNumber, v.disposition]));

    const holdersOf = new Map<string, typeof assignments>();
    for (const assignment of assignments) {
      const list = holdersOf.get(assignment.zoneId) ?? [];
      list.push(assignment);
      holdersOf.set(assignment.zoneId, list);
    }

    return zones.map((zone) => {
      const holders = holdersOf.get(zone.id) ?? [];
      const shares = partitionZone(zone.parcelNumbers, holders);
      const counts = { completed: 0, retry: 0, waiting: 0, closed: 0, unvisited: 0 };

      for (const parcelNumber of zone.parcelNumbers) {
        // A registered parcel is complete whatever its last visit said — the
        // record exists, and that is the thing being counted.
        if (registeredSet.has(parcelNumber)) {
          counts.completed += 1;
          continue;
        }
        const disposition = dispositionOf.get(parcelNumber);
        if (!disposition) {
          counts.unvisited += 1;
        } else if (disposition === 'DONE') {
          // Marked done but no claim names the parcel — the registration was
          // deleted since. Counting it complete would hide a real gap.
          counts.unvisited += 1;
        } else if (disposition === 'RETRY') {
          counts.retry += 1;
        } else if (disposition === 'WAITING') {
          counts.waiting += 1;
        } else {
          counts.closed += 1;
        }
      }

      return {
        zoneId: zone.id,
        zoneName: zone.name,
        zoneCode: zone.code,
        inspectors: holders.map((holder) => ({
          assignmentId: holder.id,
          inspectorId: holder.inspectorId,
          inspectorName: `${holder.inspector.firstName} ${holder.inspector.lastName}`.trim(),
          parcelCount: shares.get(holder.id)?.length ?? 0,
          isRemainder: holder.parcelNumbers.length === 0,
          dueAt: holder.dueAt ? holder.dueAt.toISOString() : null,
        })),
        total: zone.parcelNumbers.length,
        ...counts,
      };
    });
  }

  /**
   * The follow-up queue: everything still open, soonest first.
   *
   * Sorted by `nextVisitAt` with nulls last, because a case with a date is one
   * somebody committed to and a case without one is a case nobody has decided
   * about yet — and the first is more urgent than the second exactly as often
   * as it is not.
   */
  async followUps(filter: { disposition?: VisitDisposition; limit?: number } = {}): Promise<
    FollowUpItem[]
  > {
    const limit = Math.min(filter.limit ?? 100, 500);

    const rows = await this.db.fieldVisit.findMany({
      where: {
        disposition: filter.disposition ?? { in: ['RETRY', 'WAITING'] },
      },
      include: {
        inspector: { select: { firstName: true, lastName: true } },
        draft: { select: { gaps: true, promotedAt: true } },
      },
      orderBy: [{ visitedAt: 'desc' }],
      take: limit * 4,
    });

    // One entry per parcel — the newest visit is the live state of that door,
    // and the older ones are history the detail view shows.
    const seen = new Set<string>();
    const items: FollowUpItem[] = [];
    for (const row of rows) {
      if (seen.has(row.parcelNumber)) continue;
      seen.add(row.parcelNumber);
      items.push({
        parcelNumber: row.parcelNumber,
        outcome: row.outcome,
        disposition: row.disposition,
        visitedAt: row.visitedAt,
        nextVisitAt: row.nextVisitAt,
        note: row.note,
        proxyName: row.proxyName,
        proxyPhone: row.proxyPhone,
        inspectorId: row.inspectorId,
        inspectorName: `${row.inspector.firstName} ${row.inspector.lastName}`.trim(),
        attempts: 0,
        draftGapCount: row.draft && !row.draft.promotedAt ? row.draft.gaps.length : null,
      });
      if (items.length >= limit) break;
    }

    const attempts = await this.db.fieldVisit.groupBy({
      by: ['parcelNumber'],
      where: { parcelNumber: { in: items.map((item) => item.parcelNumber) } },
      _count: { _all: true },
    });
    const attemptOf = new Map(attempts.map((a) => [a.parcelNumber, a._count._all]));
    for (const item of items) item.attempts = attemptOf.get(item.parcelNumber) ?? 1;

    return items.sort(byNextVisitNullsLast);
  }

  // ─────────────────────────────  Promotion  ───────────────────────────────

  /**
   * Turn a completed draft into a real citizen record.
   *
   * The draft is put through the **untouched** `adminCreateCitizenSchema` — the
   * same object the public wizard and the spreadsheet importer validate against
   * — so a record that entered the register through a doorstep cannot be weaker
   * than one that came through the form. That is the whole reason drafts are
   * stored as opaque JSON instead of as a loosened citizen row.
   *
   * The draft is kept, not deleted: it is the evidence of how many visits that
   * record actually took.
   */
  async promoteDraft(
    tenantSlug: string,
    draftId: string,
    actor: { id: string; role: string },
  ): Promise<{ citizenId: string; referenceNumber: string }> {
    const draft = await this.db.fieldDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundError('المسودة غير موجودة');
    if (draft.promotedAt) throw new ConflictError('المسودة مسجّلة بالفعل');

    const payload = draft.payload as FieldDraftPayload;
    const parsed = adminCreateCitizenSchema.safeParse({
      personal: payload.personal ?? {},
      contact: payload.contact ?? {},
      properties: payload.properties ?? [],
    });

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ValidationError(
        `المسودة غير مكتملة — ${issue?.message ?? 'يرجى استكمال البيانات'}`,
      );
    }

    const created = await this.citizens.create({
      tenantSlug,
      payload: parsed.data,
      actor,
    });

    await this.db.fieldDraft.update({
      where: { id: draftId },
      data: { promotedCitizenId: created.citizenId, promotedAt: new Date(), gaps: [] },
    });

    this.record({
      tenantSlug,
      action: 'FIELD_DRAFT_PROMOTED',
      entityType: 'FieldDraft',
      entityId: draftId,
      after: {
        parcelNumber: draft.parcelNumber,
        citizenId: created.citizenId,
        referenceNumber: created.referenceNumber,
      },
      actor,
    });

    return { citizenId: created.citizenId, referenceNumber: created.referenceNumber };
  }

  /** Every visit to one door, newest first — the history behind a follow-up. */
  async visitHistory(parcelNumber: string) {
    return this.db.fieldVisit.findMany({
      where: { parcelNumber },
      include: { inspector: { select: { firstName: true, lastName: true } } },
      orderBy: { visitedAt: 'desc' },
      take: 50,
    });
  }
}

function toAssignmentSummary(row: {
  id: string;
  zoneId: string;
  inspectorId: string;
  parcelNumbers: string[];
  note: string | null;
  dueAt: Date | null;
  releasedAt: Date | null;
  createdAt: Date;
  zone: { name: string; code: string; parcelNumbers: string[] };
  inspector: { firstName: string; lastName: string };
}): AssignmentSummary {
  return {
    id: row.id,
    zoneId: row.zoneId,
    zoneName: row.zone.name,
    zoneCode: row.zone.code,
    zoneParcelCount: row.zone.parcelNumbers.length,
    // An explicit share counts itself; the remainder holder's true count needs
    // the whole partition, which the list endpoint does not compute — the zone
    // total is the honest stand-in there, and `isRemainder` says which it is.
    parcelCount: row.parcelNumbers.length || row.zone.parcelNumbers.length,
    isRemainder: row.parcelNumbers.length === 0,
    inspectorId: row.inspectorId,
    inspectorName: `${row.inspector.firstName} ${row.inspector.lastName}`.trim(),
    note: row.note,
    dueAt: row.dueAt,
    releasedAt: row.releasedAt,
    createdAt: row.createdAt,
  };
}

function emptyCoverage(zone: {
  id: string;
  name: string;
  code: string;
  parcelNumbers: string[];
}): ZoneCoverage {
  return {
    zoneId: zone.id,
    zoneName: zone.name,
    zoneCode: zone.code,
    inspectors: [],
    total: zone.parcelNumbers.length,
    completed: 0,
    retry: 0,
    waiting: 0,
    closed: 0,
    unvisited: zone.parcelNumbers.length,
  };
}

/** Dated follow-ups first, in date order; undated ones after them. */
function byNextVisitNullsLast(a: FollowUpItem, b: FollowUpItem): number {
  if (a.nextVisitAt && b.nextVisitAt) return a.nextVisitAt.getTime() - b.nextVisitAt.getTime();
  if (a.nextVisitAt) return -1;
  if (b.nextVisitAt) return 1;
  return b.visitedAt.getTime() - a.visitedAt.getTime();
}
