import { z } from 'zod';
import { adminCreateCitizenSchema } from './admin-citizen.schema';
import { uuid } from './primitives';

/**
 * ─────────────────────────  Field work (العمل الميداني)  ─────────────────────
 *
 * The register is not filled by citizens walking into the municipality; it is
 * filled by someone walking a sector door to door. Most of those doors do not
 * produce a complete record on the first knock, and the thing that was missing
 * from this system was any way to say so.
 *
 * Three ideas, and the distinction between them is the whole design:
 *
 *   **Assignment** — who is responsible for which sector. This is the
 *   *denominator*. Without it "why didn't I fill this one" is unanswerable,
 *   because a house nobody was ever sent to looks exactly like a house where
 *   nobody answered.
 *
 *   **Visit** — one attempt at one parcel, with a typed outcome. It hangs off a
 *   **parcel number, not a citizen**, because the commonest outcome by far is
 *   that there is no citizen yet: nobody opened the door. Inventing a half-empty
 *   `User` row to hold "nobody home" would put a person on the register whom
 *   nobody has met, corrupt every count, and create a record about someone who
 *   never consented to one.
 *
 *   **Draft** — whatever was salvaged, as an opaque blob. Deliberately *not* a
 *   loosened `User`: see `fieldDraftPayloadSchema`.
 */

/**
 * Why this door did not produce a finished record.
 *
 * A free-text reason would have been useless — you cannot queue on it, report
 * on it, or route it — and the note field below exists for the specifics. What
 * matters is that each value carries a *disposition*, because "come back later"
 * is three different workflows wearing one label.
 */
export const VISIT_OUTCOME = [
  /** A full record was filed from this visit. */
  'COMPLETED',
  /** Some data taken, not enough to file. A draft must be attached. */
  'PARTIAL',
  'NOBODY_HOME',
  /** Could not reach the door at all — road closed, dog, locked compound. */
  'ACCESS_BLOCKED',
  /** Someone answered who cannot speak for the property: a spouse, a minor. */
  'NOT_DECISION_MAKER',
  /** Present only part of the year. `nextVisitAt` is the point of this one. */
  'SEASONAL',
  /** The person lives outside Lebanon. NOT an incomplete record — see below. */
  'ABROAD',
  /** Cooperative, but the ID / deed / contract was not on hand. */
  'DOCUMENTS_MISSING',
  /** Owner deceased, estate undivided (شيوع), heirs not agreed. */
  'ESTATE_UNSETTLED',
  /** Ownership under litigation — the data exists but is contested. */
  'DISPUTED',
  'REFUSED',
  /** Already on the register, usually filed online. Not this worker's to do. */
  'ALREADY_REGISTERED',
  'DEMOLISHED',
  /** The cadastre has this number but no such address exists on the ground. */
  'ADDRESS_INVALID',
  /** Absorbed into another parcel; that number is where the work belongs. */
  'MERGED_PARCEL',
] as const;

export const visitOutcomeSchema = z.enum(VISIT_OUTCOME, {
  errorMap: () => ({ message: 'نتيجة الزيارة مطلوبة' }),
});
export type VisitOutcome = z.infer<typeof visitOutcomeSchema>;

/**
 * What the municipality should *do* about an outcome. This is what coverage
 * reports and worklists are actually built on; the outcome is the
 * human-readable reason, the disposition is the machine-readable consequence.
 */
export const VISIT_DISPOSITION = [
  /** Finished. Nothing owed. */
  'DONE',
  /** Back into the same worker's route — another knock will plausibly work. */
  'RETRY',
  /**
   * Blocked on someone who is not the field worker: a proxy, a document, a
   * court, an heir. Needs a clock and an owner, not another knock.
   */
  'WAITING',
  /**
   * Terminal, and removed from the denominator.
   *
   * This category is why coverage can ever reach 100%. Without it a demolished
   * building sits in "not yet visited" forever and staff stop believing the
   * number — which is how coverage dashboards die.
   */
  'CLOSED',
] as const;

export const visitDispositionSchema = z.enum(VISIT_DISPOSITION);
export type VisitDisposition = z.infer<typeof visitDispositionSchema>;

/**
 * The mapping is fixed in code, not chosen by the worker.
 *
 * Letting the person in the field pick both the reason and its consequence is
 * how "refused" quietly becomes "closed" and a sector reports itself finished.
 */
export const OUTCOME_DISPOSITION: Record<VisitOutcome, VisitDisposition> = {
  COMPLETED: 'DONE',

  PARTIAL: 'RETRY',
  NOBODY_HOME: 'RETRY',
  ACCESS_BLOCKED: 'RETRY',
  NOT_DECISION_MAKER: 'RETRY',

  SEASONAL: 'WAITING',
  ABROAD: 'WAITING',
  DOCUMENTS_MISSING: 'WAITING',
  ESTATE_UNSETTLED: 'WAITING',
  DISPUTED: 'WAITING',
  /**
   * Refusal is WAITING, not CLOSED, on purpose. A refusal is not a fact about
   * the property; it is the point at which the case stops being field work and
   * becomes the municipality's — a formal notice, not a fourth knock.
   */
  REFUSED: 'WAITING',

  ALREADY_REGISTERED: 'CLOSED',
  DEMOLISHED: 'CLOSED',
  ADDRESS_INVALID: 'CLOSED',
  MERGED_PARCEL: 'CLOSED',
};

/**
 * Outcomes that must justify themselves in writing.
 *
 * Two kinds: those that take a parcel out of the denominator on nothing but the
 * worker's word, and those that record something about a person which they
 * would dispute. Closing a parcel is the one field action that cannot be
 * corrected by visiting again, so it should cost a sentence.
 *
 * `ALREADY_REGISTERED` is the deliberate exemption. It also closes the parcel,
 * but its justification is already in the database — a claim naming that number
 * either exists or it does not, and `coverage()` counts such a parcel as
 * complete whatever the visit said. Demanding a note for a fact the server can
 * check itself is friction that buys nothing.
 */
export const OUTCOME_REQUIRES_NOTE: readonly VisitOutcome[] = [
  'DEMOLISHED',
  'ADDRESS_INVALID',
  'MERGED_PARCEL',
  'REFUSED',
  'DISPUTED',
];

/**
 * `ABROAD` deserves its own note here because it is the one everybody models
 * wrongly.
 *
 * Someone in Sydney who owns a building in the village is not an incomplete
 * record — they are a **complete and valuable** one that cannot be finished at
 * a door. Filing them as "revisit" parks real revenue in a queue no route will
 * ever drain. Their disposition is WAITING and their resolution is a proxy
 * (وكيل, a relative, a caretaker) or a link sent to them directly, which is why
 * `proxyName`/`proxyPhone` exist on the visit and why `contactPhone` was
 * widened to accept a foreign number.
 */

// ────────────────────────────────  Draft  ────────────────────────────────

/**
 * Whatever was salvaged at the door, held as an opaque blob.
 *
 * This is the single most important decision in the file, so it is worth being
 * explicit about the alternative that was rejected: **making the citizen fields
 * optional.**
 *
 * `User.firstName`/`lastName` are NOT NULL, `personalDetailsSchema` requires
 * seven fields plus two more for a Lebanese national, `contactDetailsSchema`
 * requires three, and `propertyEntriesSchema` requires at least one fully
 * branch-valid property. Relaxing any of that to let a half-record through
 * would degrade every *complete* record too — the validator is shared, so there
 * is no way to be lenient for drafts and strict for filings while they are the
 * same schema.
 *
 * So a draft is stored as JSON, validated by nothing at rest, and passed
 * through the untouched `adminCreateCitizenSchema` at promotion. The register
 * keeps exactly the guarantees it has today; the salvage lives beside it rather
 * than inside it.
 */
export const fieldDraftPayloadSchema = z.object({
  personal: z.record(z.unknown()).optional(),
  contact: z.record(z.unknown()).optional(),
  properties: z.array(z.record(z.unknown())).max(25).optional(),
});

export type FieldDraftPayload = z.infer<typeof fieldDraftPayloadSchema>;

/** One thing still missing before this draft could be filed. */
export interface DraftGap {
  /** Dot-path into the payload — `personal.civilRecordNumber`, `properties.0.units`. */
  path: string;
  /** The Arabic message the real validator produced. */
  message: string;
}

/**
 * What this draft still needs, derived by running the **real** create validator
 * and reading its complaints.
 *
 * Deliberately not a hand-maintained checklist of required fields. A second
 * list would drift from `adminCreateCitizenSchema` the first time a field
 * became conditional, and then the worker would return to a door armed with the
 * wrong questions — which is worse than no list at all, because they would
 * believe it.
 *
 * An empty array means the draft is filable as it stands.
 */
export function draftGaps(payload: FieldDraftPayload): DraftGap[] {
  const result = adminCreateCitizenSchema.safeParse({
    personal: payload.personal ?? {},
    contact: payload.contact ?? {},
    properties: payload.properties ?? [],
  });

  if (result.success) return [];

  // One gap per path: Zod reports the same missing field twice when two rules
  // depend on it (a missing `identityDocNumber` is both "required" and half of
  // the passport-or-residency rule), and a worker does not need to be told
  // twice.
  const seen = new Set<string>();
  const gaps: DraftGap[] = [];
  for (const issue of result.error.issues) {
    const path = issue.path.join('.');
    if (seen.has(path)) continue;
    seen.add(path);
    gaps.push({ path, message: issue.message });
  }
  return gaps;
}

/** True when the salvaged data is complete enough to become a real record. */
export function isDraftFilable(payload: FieldDraftPayload): boolean {
  return draftGaps(payload).length === 0;
}

// ────────────────────────────────  Visit  ────────────────────────────────

/**
 * Free-text observation about the visit.
 *
 * Capped hard and kept short on purpose. This is the highest-risk field in the
 * feature: it is a record *about a person* written by a stranger at their door,
 * with no consent and no declaration behind it — see open decision #1. It
 * exists because "REFUSED" alone cannot tell the municipality that the refusal
 * was about a boundary dispute with the neighbour. It is not a place for
 * anything about the household beyond the visit itself, and the UI says so.
 */
const visitNote = z.string().trim().max(500, 'الملاحظة طويلة جداً').optional();

/**
 * A visit as recorded on the device — which is where every visit is recorded,
 * online or not.
 *
 * `clientId` is generated offline and is the **idempotency key** for the whole
 * sync path. A worker's phone that pushed a batch, lost signal before reading
 * the response, and retried an hour later must not create two visits; the
 * server upserts on this and the second push is a no-op. It is also why the
 * device can keep working with no server round-trip at all: it does not need
 * the server to allocate it an id.
 */
export const recordVisitSchema = z
  .object({
    clientId: uuid,

    /**
     * رقم العقار. Text rather than a foreign key, matching `Zone.parcelNumbers`
     * — a cadastre re-import rebuilds the parcel table wholesale, and a visit
     * log that cascaded away on a routine survey correction would be worthless
     * as a record of work done.
     */
    parcelNumber: z.string().trim().min(1, 'رقم العقار مطلوب').max(40),

    outcome: visitOutcomeSchema,

    /** When the knock happened — device clock, not server receipt time. */
    visitedAt: z.coerce.date(),

    note: visitNote,

    /**
     * When to come back. Meaningful for RETRY and WAITING; the UI defaults it
     * per outcome (a SEASONAL resident gets next summer, not next Tuesday).
     */
    nextVisitAt: z.coerce.date().optional(),

    /**
     * Where the device was when the visit was recorded.
     *
     * Optional, and it must stay optional. Mandatory location on every visit is
     * staff surveillance — it is the obvious answer to a worker marking doors
     * "not home" from a café, and it needs the municipality's decision and the
     * worker's knowledge, not a silent default in a schema. Captured when the
     * device offers it and the tenant has turned it on.
     */
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),

    /**
     * Someone who can supply the data on the resident's behalf. The resolution
     * path for ABROAD, ESTATE_UNSETTLED and NOT_DECISION_MAKER — without it
     * those three are just three ways of writing "stuck".
     */
    proxyName: z.string().trim().max(60).optional(),
    proxyPhone: z.string().trim().max(20).optional(),

    /** Set when this visit produced or advanced a draft. */
    draftClientId: uuid.optional(),

    /**
     * Set when the visit finished a record then and there — either a citizen
     * already on file, or one this batch created.
     */
    citizenId: uuid.optional(),
  })
  .superRefine((data, ctx) => {
    if (OUTCOME_REQUIRES_NOTE.includes(data.outcome) && !data.note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'هذه النتيجة تتطلب ملاحظة توضّح السبب',
      });
    }

    // "Partial" with nothing attached is indistinguishable from "nobody home",
    // and the difference is the entire point of recording it.
    if (data.outcome === 'PARTIAL' && !data.draftClientId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['draftClientId'],
        message: 'اختر «لم يكن موجوداً» إن لم تُسجَّل أي بيانات',
      });
    }

    if (data.outcome === 'COMPLETED' && !data.citizenId && !data.draftClientId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outcome'],
        message: 'لا يمكن إنهاء الزيارة دون تسجيل بيانات المواطن',
      });
    }
  });

export type RecordVisitInput = z.infer<typeof recordVisitSchema>;

/** A draft as pushed from the device. */
export const upsertDraftSchema = z.object({
  clientId: uuid,
  parcelNumber: z.string().trim().min(1).max(40),
  payload: fieldDraftPayloadSchema,
  /** Device clock. Last write wins between two pushes of the same draft. */
  updatedAt: z.coerce.date(),
});

export type UpsertDraftInput = z.infer<typeof upsertDraftSchema>;

/**
 * ─────────────────────  Taking back a household that was a mistake  ──────────
 *
 * «مواطن جديد» tapped twice; a tenant entered against the neighbouring
 * building; a family recorded at the wrong door. Until this existed there was
 * no way to undo any of it — and because an open draft counts as unfinished
 * work, the mistake also pinned its whole parcel in «مستحقة», sending the
 * worker back to a real door indefinitely for a record that was a typo.
 *
 * It travels through the outbox like everything else rather than through its
 * own endpoint, because the moment a mistake is noticed is the moment it was
 * made — at a doorstep, with no signal. A discard that needed the network would
 * be a discard nobody could perform.
 *
 * Deliberately *not* a delete, on either side: the visits recorded against this
 * household are the record of knocks that genuinely happened at that door, and
 * they survive being wrong about who lived behind it.
 */
export const discardDraftSchema = z.object({
  /**
   * The discard's own id, generated on the device — the idempotency key for
   * this record in the outbox and in the response, exactly as `clientId` works
   * for a draft or a visit. Distinct from the household it names, so a queued
   * discard cannot collide with the queued draft it is about.
   */
  clientId: uuid,
  /** The household being taken back. Names an existing draft. */
  draftClientId: uuid,
  parcelNumber: z.string().trim().min(1, 'رقم العقار مطلوب').max(40),
  /**
   * Why, in the worker's own words, and required.
   *
   * Removing a household from the queue on one person's say-so is the same
   * class of act as closing a parcel with `DEMOLISHED`, and
   * `OUTCOME_REQUIRES_NOTE` already settled that such an act costs a sentence.
   * Ten characters is not a real bar to anyone with a reason; it is a bar to
   * «.» and to a mis-tap on a confirm button.
   */
  reason: z
    .string()
    .trim()
    .min(10, 'اذكر سبب الحذف بجملة قصيرة')
    .max(300, 'السبب طويل — اختصره'),
  /** Device clock at the moment it was discarded. */
  discardedAt: z.coerce.date(),
});

export type DiscardDraftInput = z.infer<typeof discardDraftSchema>;

// ─────────────────────────────────  Sync  ────────────────────────────────

/**
 * One push of everything the device accumulated while it was offline.
 *
 * Drafts travel before visits in the same envelope because a visit may
 * reference a draft by `draftClientId`; sending them as two requests would put
 * a window between them in which the server holds a visit pointing at a draft
 * it has never seen.
 *
 * Discards travel last, and the order is load-bearing in the same way. A worker
 * can create a household, record a visit against it and then realise it was the
 * wrong door — all inside one offline session, all in one envelope. Applied in
 * this order the server creates it, records the visit, and then marks it
 * discarded; in any other order the discard lands on a row that does not exist
 * yet and the mistake survives the correction.
 *
 * Batched rather than one-request-per-record because a worker who spent a day
 * in a sector with no signal comes back with a hundred of them, and a hundred
 * round trips over a village connection is how a sync gets abandoned halfway.
 */
export const syncBatchSchema = z.object({
  drafts: z.array(upsertDraftSchema).max(200),
  visits: z.array(recordVisitSchema).max(200),
  /**
   * Optional so that a device running an older build — one that has never heard
   * of discards — still validates against this schema. Every other field here
   * predates that concern; this one is the first addition since the contract
   * went to real phones.
   */
  discards: z.array(discardDraftSchema).max(200).optional(),
});

export type SyncBatchInput = z.infer<typeof syncBatchSchema>;

/**
 * ─────────────────────  Why one record would not go through  ─────────────────
 *
 * A rejected record stays in the outbox forever by design — discarding a
 * worker's day because the server disliked it would be worse. But "stays
 * forever" is only defensible if the worker can find out *why* and what to do
 * about it, and until now the answer was an Arabic sentence rendered nowhere.
 *
 * A code rather than only a message, because the two questions have different
 * answers. The message says what happened; the code is what lets the device say
 * **who can fix it and how** — and that is the half a worker at a door actually
 * needs. Matching on the message text would have worked until the first time
 * somebody reworded it.
 */
export type SyncFailureCode =
  /** The parcel is not in this worker's share. Only a supervisor can fix it. */
  | 'PARCEL_NOT_ASSIGNED'
  /** The household is already a citizen on the register; it cannot be discarded. */
  | 'DRAFT_ALREADY_FILED'
  /** The record breaks its own schema — a missing required note, usually. */
  | 'INVALID_RECORD'
  /** Anything the server did not expect. Genuinely a bug, and reported as one. */
  | 'SERVER_ERROR';

/** What went wrong, and who can do something about it. */
export interface SyncFailureGuidance {
  /** One line naming the problem, for a list row. */
  title: string;
  /** What the worker should actually do next. */
  resolution: string;
  /**
   * Whether the worker can fix this themselves at all.
   *
   * The distinction matters more than it looks: telling someone to fix
   * something only their supervisor can change is how a queue sits untouched
   * for a fortnight while everybody assumes somebody else is on it.
   */
  actor: 'worker' | 'supervisor';
  /** True when the record can safely be dropped instead of fixed. */
  droppable: boolean;
}

export const SYNC_FAILURE_GUIDANCE: Record<SyncFailureCode, SyncFailureGuidance> = {
  PARCEL_NOT_ASSIGNED: {
    title: 'هذا العقار ليس ضمن قطاعك',
    resolution:
      'راجع المشرف ليضيف العقار إلى تكليفك، ثم اضغط «مزامنة» مرة أخرى. سيُرسل تلقائياً بعد التعديل.',
    actor: 'supervisor',
    droppable: false,
  },
  DRAFT_ALREADY_FILED: {
    title: 'هذا المواطن مسجَّل رسمياً — لا يمكن حذفه',
    resolution: 'أصبح سجلاً في البلدية. إن كان التسجيل خاطئاً فالتعديل يتم من البلدية لا من الجهاز.',
    actor: 'supervisor',
    droppable: true,
  },
  INVALID_RECORD: {
    title: 'السجل غير مكتمل ولا يقبله الخادم',
    resolution: 'افتح السجل وأكمل الحقل الناقص — غالباً ملاحظة مطلوبة لهذه النتيجة — ثم احفظه.',
    actor: 'worker',
    droppable: false,
  },
  SERVER_ERROR: {
    title: 'خطأ غير متوقع من الخادم',
    resolution: 'حاول المزامنة لاحقاً. إن تكرر الأمر أبلغ المشرف برقم العقار.',
    actor: 'supervisor',
    droppable: false,
  },
};

/** Per-record outcome, so the device knows exactly what to drop from its queue. */
export interface SyncRecordResult {
  clientId: string;
  ok: boolean;
  /** Present on failure — shown to the worker, and kept in the queue. */
  error?: string;
  /** Present on failure. Drives the "how do I fix this" text on the device. */
  code?: SyncFailureCode;
  /**
   * Set when the server already had this `clientId`. Not an error: it is the
   * expected result of a retried push, and the device should clear it.
   */
  duplicate?: boolean;
}

/**
 * A draft the server turned into a real citizen record during this sync.
 *
 * The device needs this to stop showing the draft as outstanding work. It
 * cannot infer it: the draft it pushed and the citizen that came out the other
 * side share no identifier the device generated, which is exactly why the
 * server has to name the pair.
 */
export interface PromotedDraftInfo {
  draftClientId: string;
  citizenId: string;
  parcelNumber: string;
  referenceNumber: string;
  citizenName?: string;
}

/**
 * A draft that was *supposed* to become a citizen record and did not.
 *
 * Reported rather than swallowed. The worker was told at the door that this
 * household was finished; if the register disagreed — a duplicate national id,
 * a rule the doorstep validator does not model — that is a thing they and a
 * supervisor have to see, not a silent gap between what the device shows and
 * what the municipality holds.
 */
export interface PromotionFailure {
  draftClientId: string;
  parcelNumber: string;
  /** Arabic, already phrased for the worker. */
  error: string;
}

export interface SyncBatchResult {
  drafts: SyncRecordResult[];
  visits: SyncRecordResult[];
  /**
   * One result per discard.
   *
   * `duplicate: true` covers both idempotent cases and neither is an error: a
   * household the server has never seen (discarded before it was ever pushed)
   * and one already discarded (a retried batch). Both mean "there is nothing
   * here any more", which is what was asked for.
   */
  discards: SyncRecordResult[];
  /** Drafts automatically filed as official citizens during this sync. */
  promotedDrafts: PromotedDraftInfo[];
  /** Drafts whose automatic filing failed, and why. */
  promotionFailures: PromotionFailure[];
  /**
   * Parcels that somebody *else* registered while this device was offline — the
   * citizen filed through the public wizard, or another worker got there first.
   *
   * Never includes a parcel this batch's own promotions registered: a worker
   * finishing a household must not be told a stranger beat them to it.
   *
   * The device marks these registered rather than deleting them. Deleting was
   * right when a parcel meant one household; it is wrong now that a cadastral
   * number is a whole building, because the other four apartments in it are
   * still this worker's job.
   */
  supersededParcels: string[];
  /**
   * Parcels in this push that another worker had already visited.
   *
   * Should be empty: the parcel partition is designed so two devices never hold
   * the same door. It is reported rather than assumed away because a partition
   * can be broken by a human — a supervisor reassigning a sector mid-shift
   * while a device is offline with a stale worklist — and a duplicate that
   * surfaces at sync is recoverable, where one discovered at promotion is two
   * citizen records to merge.
   */
  conflictedParcels: string[];
}

// ──────────────────────────────  Worklist  ───────────────────────────────

/**
 * ─────────────────────  One shape, three date representations  ───────────────
 *
 * The worklist crosses two boundaries — Prisma → HTTP → IndexedDB — and dates
 * change representation at each: `Date` in the service, an ISO string once JSON
 * has been through it, an ISO string again on the device.
 *
 * Everything else about the shape is identical, and it used to be declared
 * three times. Predictably the three drifted: the service returned per-draft
 * visit state that its own declared return type did not mention, the frontend's
 * DTO still described the single-draft world, and the sync layer papered over
 * the gap with `as` casts. The casts are what hid the drift.
 *
 * So the shape is written once, parameterised by how dates are spelled. The
 * service instantiates it at `Date`, the API client and the device at `string`,
 * and a field added here is a compile error in every consumer that has not
 * caught up — which is the entire point.
 */

/**
 * One citizen/household being worked at a door.
 *
 * A cadastral number is a *building*, not a house: an apartment block is one
 * number shared by every owner and tenant inside it. So the unit of field work
 * is this — a person and their case — and a parcel carries a list of them.
 * Visit state hangs here, not on the parcel, because apartment 1 being finished
 * says nothing about apartment 2 being empty.
 */
export interface FieldDraftSummary<TDate = string> {
  clientId: string;
  payload: FieldDraftPayload;
  /**
   * The gap list as of the last write, for cheap list rendering only.
   *
   * Never branch on it. `draftGaps(payload)` is the truth and is the same
   * validator promotion runs; this is a cache that a stale pull can contradict.
   */
  gaps: string[];
  /** Derived from the payload at write time, so a list row need not parse it. */
  citizenName: string | null;
  updatedAt: TDate | null;

  /**
   * The last visit *to this household*, which is the whole feature.
   *
   * All seven fields are non-optional and explicitly nullable. Optional fields
   * were how "clear the return date" became "keep the old return date": every
   * merge in the sync path was written as `patch.x ?? current.x`, and `??`
   * cannot tell "leave this alone" from "set this to nothing". Required-and-
   * nullable removes the ambiguity at the type level.
   */
  lastOutcome: VisitOutcome | null;
  lastDisposition: VisitDisposition | null;
  lastVisitedAt: TDate | null;
  nextVisitAt: TDate | null;
  note: string | null;
  proxyName: string | null;
  proxyPhone: string | null;
}

/**
 * Somebody already on the register at this parcel.
 *
 * Shown at the door so a worker does not collect a household the municipality
 * already holds — the single most common wasted visit, and the one that creates
 * duplicate citizen records when it is not caught.
 *
 * No review status: `Registration.status` is vestigial in this system (see the
 * note where `ReportStatus` used to live in `enums.ts`). A row exists because a
 * clerk or a promotion put it there, and that is all "registered" means here —
 * the same rule `coverage()` counts by, deliberately.
 */
export interface RegisteredCitizenSummary {
  id: string;
  name: string;
  phone: string | null;
  referenceNumber: string | null;
}

/** One door on a worker's list, with everything needed to work it offline. */
export interface WorklistParcel<TDate = string> {
  parcelNumber: string;
  zoneId: string;
  zoneCode: string;
  latitude: number | null;
  longitude: number | null;
  /** At least one claim already names this number. */
  registered: boolean;
  /** Everyone the register already holds here. `registered` is `.length > 0`. */
  registeredCitizens: RegisteredCitizenSummary[];
  /**
   * The last visit to the *parcel as a whole* — a locked gate, a demolished
   * building, an address that does not exist. Distinct from a household's own
   * state: those live on `drafts`.
   */
  lastOutcome: VisitOutcome | null;
  lastDisposition: VisitDisposition | null;
  lastVisitedAt: TDate | null;
  nextVisitAt: TDate | null;
  visitCount: number;
  /** Every open household on this parcel, newest edit first. */
  drafts: Array<FieldDraftSummary<TDate>>;
}

export interface Worklist<TDate = string> {
  generatedAt: TDate;
  zones: Array<{ id: string; name: string; code: string; color: string; dueAt: TDate | null }>;
  parcels: Array<WorklistParcel<TDate>>;
}

// ────────────────────────────  Where a case stands  ──────────────────────

/**
 * ───────────────────────────  One state, four names  ─────────────────────────
 *
 * The worker's tabs — لم تُزَر / مستحقة / بانتظار / منجزة — have to *partition*
 * the list. If a door can be counted twice, or in none of them, the counts stop
 * being trustworthy and the tabs stop being a plan for the day.
 *
 * They stopped partitioning the moment a parcel grew several households: "done"
 * was still asked of the parcel while "waiting" was asked of its drafts, so a
 * building whose apartments were all finished could appear in neither. Hence
 * one function, used by every filter, every count and every badge.
 *
 * The ordering is a priority, and it is the worker's own: anything owed today
 * outranks anything owed later, which outranks anything finished. A building
 * with three closed apartments and one due tomorrow is a building to visit
 * tomorrow, not a finished building.
 */
export type CaseState =
  /** Nothing recorded at all. */
  | 'todo'
  /** Owed now: the return date has arrived, or a retry has no date at all. */
  | 'due'
  /** Owed later, or owed by somebody else — a وكيل, a document, a decision. */
  | 'waiting'
  /** Finished or abandoned; no further visit will change it. */
  | 'closed';

function returnDateReached(nextVisitAt: Date | string | null, now: Date): boolean {
  if (!nextVisitAt) return false;
  const at = nextVisitAt instanceof Date ? nextVisitAt : new Date(nextVisitAt);
  return !Number.isNaN(at.getTime()) && at.getTime() <= now.getTime();
}

interface VisitStateLike {
  lastOutcome: VisitOutcome | null;
  lastDisposition: VisitDisposition | null;
  nextVisitAt: Date | string | null;
}

function dispositionState(state: VisitStateLike, now: Date): CaseState | null {
  const disposition = state.lastDisposition ?? null;
  if (!disposition) return null;
  if (disposition === 'DONE' || disposition === 'CLOSED') return 'closed';
  // A scheduled return that has come round is due, whichever side it was
  // waiting on. This is the whole mechanism behind «بانتظار مستندات» surfacing
  // by itself on the day the citizen promised the paperwork.
  if (returnDateReached(state.nextVisitAt, now)) return 'due';
  // RETRY with no date is "come back, I did not say when" — which means today.
  if (disposition === 'RETRY') return state.nextVisitAt ? 'waiting' : 'due';
  return 'waiting';
}

/**
 * Where one household stands.
 *
 * An open draft with no outcome yet is `due`, not `todo`: somebody started
 * writing this household down and stopped. That is unfinished work, and the
 * one thing worse than never having knocked is a half-filled form nobody
 * returns to.
 */
export function draftCaseState(draft: VisitStateLike, now: Date = new Date()): CaseState {
  return dispositionState(draft, now) ?? 'due';
}

/**
 * Where a whole door stands, across every household behind it.
 *
 * `parcel.lastDisposition` here is the *parcel-level* visit only — a locked
 * gate, a demolished building — never a household's. A completed apartment
 * must not close the building it is in.
 */
export function parcelCaseState(
  parcel: {
    registered: boolean;
    lastOutcome: VisitOutcome | null;
    lastDisposition: VisitDisposition | null;
    nextVisitAt: Date | string | null;
    drafts: readonly VisitStateLike[];
  },
  now: Date = new Date(),
): CaseState {
  const parcelLevel = dispositionState(parcel, now);
  // A closed *parcel* closes everything on it: there is no apartment 2 in a
  // demolished building.
  if (parcelLevel === 'closed' && parcel.drafts.length === 0) return 'closed';
  if (parcel.lastDisposition === 'CLOSED') return 'closed';

  const households = parcel.drafts.map((draft) => draftCaseState(draft, now));
  if (households.includes('due') || parcelLevel === 'due') return 'due';
  if (households.includes('waiting') || parcelLevel === 'waiting') return 'waiting';
  if (parcel.registered || households.length > 0 || parcelLevel === 'closed') return 'closed';
  return 'todo';
}

// ────────────────────────  Reconciling a device's view  ──────────────────────

/**
 * Has anything about *the visit* changed, as opposed to about the form?
 *
 * The distinction is what keeps `field_visits` meaning something. Reopening a
 * finished household to correct a misspelt street is an edit to a draft; going
 * back to the door is a visit. Treating every save as the second inflated the
 * attempt count on every parcel, and made a fresh promotion attempt against a
 * citizen already on the register each time.
 *
 * A household with no outcome yet always counts as changed — the first save is
 * always a visit.
 */
export function visitStateChanged<TDate>(
  draft: Pick<
    FieldDraftSummary<TDate>,
    'lastOutcome' | 'nextVisitAt' | 'note' | 'proxyName' | 'proxyPhone'
  > | null,
  next: {
    lastOutcome: VisitOutcome | null;
    nextVisitAt: TDate | null;
    note: string | null;
    proxyName: string | null;
    proxyPhone: string | null;
  },
): boolean {
  if (!draft?.lastOutcome) return true;
  return (
    draft.lastOutcome !== next.lastOutcome ||
    String(draft.nextVisitAt ?? '') !== String(next.nextVisitAt ?? '') ||
    (draft.note ?? '') !== (next.note ?? '') ||
    (draft.proxyName ?? '') !== (next.proxyName ?? '') ||
    (draft.proxyPhone ?? '') !== (next.proxyPhone ?? '')
  );
}

/**
 * ───────────────────  Whose version of a household wins  ─────────────────────
 *
 * A pull replaces the worklist wholesale — the server is the truth about what
 * is assigned. Drafts are the exception: one entered at a door ten minutes ago
 * exists only on the device, and wholesale replacement would erase it before it
 * was ever pushed. So drafts, and only drafts, are merged.
 *
 * Three cases, and the third is the one that was missing:
 *
 *  1. **Server only.** Take it — another device, or an earlier sync.
 *  2. **Both.** Take whichever was edited later, *whole*. Not field-by-field:
 *     half of a stale draft merged into half of a fresh one is a record that
 *     existed on neither side. Last-write-wins by device clock is correct here
 *     specifically because the only writer is the one worker the parcel is
 *     assigned to, and it is the same rule the server applies on push.
 *  3. **Device only.** Take it — *unless* it is retired. A draft absent from
 *     the server is usually one the server has not been told about, which is
 *     why the union exists. But it is also exactly what a **promoted** draft
 *     looks like: the server stops sending a household the moment it becomes a
 *     real citizen record. Without the retired set the two are
 *     indistinguishable, and every pull resurrected finished work — pinning its
 *     parcel in the drafts list with no way to clear it.
 */
export function mergeDraftLists<TDate>(
  serverDrafts: ReadonlyArray<FieldDraftSummary<TDate>>,
  localDrafts: ReadonlyArray<FieldDraftSummary<TDate>>,
  retired: ReadonlySet<string> = new Set(),
): Array<FieldDraftSummary<TDate>> {
  const merged = new Map<string, FieldDraftSummary<TDate>>();

  for (const draft of serverDrafts) {
    if (retired.has(draft.clientId)) continue;
    merged.set(draft.clientId, draft);
  }

  for (const draft of localDrafts) {
    if (retired.has(draft.clientId)) continue;
    const fromServer = merged.get(draft.clientId);
    if (!fromServer || editedAt(draft) > editedAt(fromServer)) {
      merged.set(draft.clientId, draft);
    }
  }

  return [...merged.values()].sort((a, b) => editedAt(b) - editedAt(a));
}

function editedAt<TDate>(draft: FieldDraftSummary<TDate>): number {
  if (draft.updatedAt === null || draft.updatedAt === undefined) return 0;
  const at =
    draft.updatedAt instanceof Date ? draft.updatedAt : new Date(String(draft.updatedAt));
  const time = at.getTime();
  return Number.isNaN(time) ? 0 : time;
}

// ──────────────────────────────  Assignment  ─────────────────────────────

/**
 * Handing a share of a sector to a field worker.
 *
 * A zone is the unit the municipality talks in, but it is not always the unit
 * of work: a sector of six hundred parcels gets split between three collectors,
 * and all three are working it at once.
 *
 * So exclusivity is held per *parcel*, not per zone. The active assignments of
 * a zone partition its parcels between them, which is what preserves the
 * property the whole offline design leans on — two devices are never handed the
 * same door, even though neither can see the other's work until they sync.
 *
 * `parcelNumbers` empty means **the remainder**: everything in the zone no
 * other active assignment has explicitly claimed. One person on a whole sector
 * is therefore just an empty list, and a zone may have at most one remainder
 * holder (a partial unique index in migration 0019 — two of them would both be
 * handed every unclaimed parcel, which is the exact duplicate this prevents).
 */
/**
 * How a zone is divided when it is handed out.
 *
 *  `SPLIT`     — several workers at once, one explicit share each, cut evenly
 *                from whatever nobody has claimed yet. This is what "assign
 *                three people to قطاع أ" actually means: the sector is
 *                partitioned, not shared, so all three can work it at the same
 *                time without ever meeting at the same door.
 *  `REMAINDER` — one worker takes everything unclaimed, now and in future. The
 *                common case, and what a single worker on a whole sector is.
 *  `EXPLICIT`  — one worker takes exactly the numbers given.
 */
export const ASSIGN_MODE = ['SPLIT', 'REMAINDER', 'EXPLICIT'] as const;
export const assignModeSchema = z.enum(ASSIGN_MODE);
export type AssignMode = z.infer<typeof assignModeSchema>;

export const assignZoneSchema = z
  .object({
    zoneId: uuid,
    /** One id, or several to divide the sector between. */
    inspectorIds: z
      .array(uuid)
      .min(1, 'اختر موظفاً واحداً على الأقل')
      .max(20, 'عدد الموظفين كبير جداً'),
    mode: assignModeSchema,
    /** `EXPLICIT` only — the numbers this one worker takes. */
    parcelNumbers: z.array(z.string().trim().min(1).max(40)).max(5000).default([]),
    note: z.string().trim().max(300).optional(),
    /** Optional target date, shown on each worker's queue as a deadline. */
    dueAt: z.coerce.date().optional(),
  })
  .superRefine((data, ctx) => {
    // Two people cannot both hold "everything unclaimed", and two people cannot
    // both hold one hand-typed list. Only SPLIT is meaningful for a group, and
    // saying so here keeps the server from having to guess which of them the
    // caller meant.
    if (data.mode !== 'SPLIT' && data.inspectorIds.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mode'],
        message: 'اختر «تقسيم بالتساوي» عند تكليف أكثر من موظف',
      });
    }
    if (data.mode === 'EXPLICIT' && data.parcelNumbers.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parcelNumbers'],
        message: 'أدخل رقم عقار واحد على الأقل',
      });
    }
    if (new Set(data.inspectorIds).size !== data.inspectorIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['inspectorIds'],
        message: 'لا يمكن تكليف الموظف نفسه مرتين',
      });
    }
  });

export type AssignZoneInput = z.infer<typeof assignZoneSchema>;

/**
 * Cut a list of parcels into `count` shares as evenly as it divides.
 *
 * Contiguous slices rather than round-robin: cadastral numbering broadly
 * follows the street, so consecutive numbers are usually neighbouring doors.
 * Dealing them out alternately would send three people walking the same street
 * past each other all morning.
 *
 * Shared with the UI so the dialog can show what each worker will get before
 * anyone commits to it.
 */
export function splitEvenly<T>(items: readonly T[], count: number): T[][] {
  if (count <= 0) return [];
  const shares: T[][] = [];
  const base = Math.floor(items.length / count);
  // The first `extra` shares take one more, so 10 parcels between 3 people is
  // 4/3/3 rather than 3/3/3 and one parcel nobody was sent to.
  const extra = items.length % count;

  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const size = base + (index < extra ? 1 : 0);
    shares.push(items.slice(cursor, cursor + size));
    cursor += size;
  }
  return shares;
}

/** Coverage for one sector — the number the council actually asks for. */
export interface ZoneCoverage {
  zoneId: string;
  zoneName: string;
  zoneCode: string;
  /** Everyone currently working this sector, with the share each holds. */
  inspectors: Array<{
    assignmentId: string;
    inspectorId: string;
    inspectorName: string;
    /** How many parcels this person's share covers. */
    parcelCount: number;
    /** True for the holder of everything nobody else explicitly claimed. */
    isRemainder: boolean;
    dueAt: string | null;
  }>;
  /** Parcels in the zone, i.e. the denominator. */
  total: number;
  /** Registered — a citizen record exists against the parcel. */
  completed: number;
  /** Visited, still open, another knock expected. */
  retry: number;
  /** Visited, blocked on someone else. */
  waiting: number;
  /** Terminal — excluded from `total` when the percentage is computed. */
  closed: number;
  /** Never visited by anyone. */
  unvisited: number;
}
