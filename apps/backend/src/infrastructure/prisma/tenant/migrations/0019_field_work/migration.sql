-- Field work: assignment, visit, draft.
--
-- Schema-unqualified on purpose: the migrator sets `search_path` to the target
-- tenant schema, so this one file builds the tables inside every municipality.
--
-- == The problem ============================================================
--
-- The register is filled by someone walking a sector door to door, and most
-- doors do not produce a finished record on the first knock. Until now the
-- system had no way to record that at all: `adminCreateCitizenSchema` requires
-- name, gender, nationality, resident status, marital status, phone, family
-- size and at least one fully branch-valid property, and `users.firstName` is
-- NOT NULL underneath it. A worker who got half the answers had exactly two
-- options — invent the rest, or throw the visit away.
--
-- Worse, there was no denominator. Nothing recorded that a house was *supposed*
-- to be visited, so a door nobody was ever sent to was indistinguishable from a
-- door where nobody answered.
--
-- == The shape ==============================================================
--
-- A visit keys on a **parcel number, not a citizen**. The commonest outcome is
-- that there is no citizen yet, and minting a half-empty `users` row to hold
-- "nobody home" would put a person on the register whom nobody has met and who
-- never consented to being there. `zones.parcelNumbers` and
-- `property_entries.propertyNumber` already key on the deed's printed number
-- rather than on `parcels.id`, for the matching reason that a cadastre
-- re-import rebuilds that table wholesale; this follows them.
--
-- A draft is JSON, not a loosened citizen. The register's guarantees are worth
-- more than the convenience of one table, so the salvage sits beside it and is
-- put through the untouched create validator at promotion time.

CREATE TYPE "VisitOutcome" AS ENUM (
    'COMPLETED',
    'PARTIAL',
    'NOBODY_HOME',
    'ACCESS_BLOCKED',
    'NOT_DECISION_MAKER',
    'SEASONAL',
    'ABROAD',
    'DOCUMENTS_MISSING',
    'ESTATE_UNSETTLED',
    'DISPUTED',
    'REFUSED',
    'ALREADY_REGISTERED',
    'DEMOLISHED',
    'ADDRESS_INVALID',
    'MERGED_PARCEL'
);

-- What the municipality does next about an outcome. Written by the server from
-- a fixed mapping, never sent by the device: a worker able to pick both the
-- reason and its consequence can mark a sector finished by relabelling every
-- refusal as closed.
CREATE TYPE "VisitDisposition" AS ENUM ('DONE', 'RETRY', 'WAITING', 'CLOSED');

-- ─────────────────────────────  Assignments  ─────────────────────────────

CREATE TABLE "field_assignments" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "zoneId"       UUID         NOT NULL,
    "inspectorId"  UUID         NOT NULL,
    "assignedById" UUID,

    -- Which parcels of the zone this worker holds.
    --
    -- Empty means "everything in the zone that no other active assignment has
    -- explicitly claimed" — the remainder. A sector worked by one person is
    -- therefore just an empty array, and splitting it between three is two
    -- explicit lists plus, at most, one remainder holder.
    --
    -- This is what lets several workers share a zone without giving up the
    -- guarantee the offline story rests on: the parcels are *partitioned*, so
    -- no two devices ever hold the same door even though neither can see the
    -- other's work.
    "parcelNumbers" TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],

    "note"         TEXT,
    "dueAt"        TIMESTAMP(3),
    "releasedAt"   TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_assignments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "field_assignments"
    ADD CONSTRAINT "field_assignments_zoneId_fkey"
    FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT, not CASCADE. Who held which sector is an accountability record —
-- the audit of a disputed registration eventually asks it — so removing a staff
-- row must not be able to erase it. Staff are deactivated rather than deleted in
-- this system anyway (`users.isActive`), and the staff screen already refuses a
-- permanent delete for anyone with history; this makes that guarantee structural
-- rather than a check one code path remembers to run.
ALTER TABLE "field_assignments"
    ADD CONSTRAINT "field_assignments_inspectorId_fkey"
    FOREIGN KEY ("inspectorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "field_assignments"
    ADD CONSTRAINT "field_assignments_assignedById_fkey"
    FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The two constraints the offline duplicate story rests on.
--
-- A zone may be worked by several people at once — a large sector split between
-- three collectors is the normal case — so exclusivity cannot live at the zone
-- level. It lives at the *parcel* level instead, and these two indexes are what
-- make the partition hold:
--
--  1. One active assignment per (zone, inspector). The same person cannot hold
--     two overlapping claims on one sector, which would otherwise make "which
--     of my assignments owns number 412" ambiguous.
--
--  2. At most one *remainder* holder per zone — one active assignment with an
--     empty `parcelNumbers`. Two remainder holders would both be handed every
--     unclaimed parcel, which is exactly the duplicate this design exists to
--     prevent. Explicit subsets are checked for overlap in the service, where a
--     refusal can name the offending numbers; this index catches the one case
--     SQL can express on its own, and is the backstop if that check is ever
--     bypassed.
--
-- Both partial, because a released assignment is kept rather than deleted —
-- "who held these parcels in March" is a question the audit of a disputed
-- record eventually asks — and a plain unique index would let a sector be
-- handed on exactly once and never again.
--
-- Prisma's schema language cannot express either, which is why they live here
-- and the model carries only plain @@index entries.
CREATE UNIQUE INDEX "field_assignments_active_zone_inspector_key"
    ON "field_assignments"("zoneId", "inspectorId")
    WHERE "releasedAt" IS NULL;

CREATE UNIQUE INDEX "field_assignments_active_zone_remainder_key"
    ON "field_assignments"("zoneId")
    WHERE "releasedAt" IS NULL AND cardinality("parcelNumbers") = 0;

-- Answers "which active assignment claims this parcel number", asked on every
-- assignment save to reject an overlap. GIN over the array makes it a lookup
-- rather than a scan of every assignment, matching `zones_parcelNumbers_idx`.
CREATE INDEX "field_assignments_parcelNumbers_idx"
    ON "field_assignments" USING GIN ("parcelNumbers");

CREATE INDEX "field_assignments_zoneId_releasedAt_idx"
    ON "field_assignments"("zoneId", "releasedAt");

CREATE INDEX "field_assignments_inspectorId_releasedAt_idx"
    ON "field_assignments"("inspectorId", "releasedAt");

-- ───────────────────────────────  Drafts  ────────────────────────────────

CREATE TABLE "field_drafts" (
    "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
    -- Generated on the device. See field_visits."clientId" below.
    "clientId"          UUID         NOT NULL,
    "parcelNumber"      TEXT         NOT NULL,
    "inspectorId"       UUID         NOT NULL,
    -- { personal?, contact?, properties? } — the shape the create validator
    -- takes, with nothing required of it at rest.
    "payload"           JSONB        NOT NULL,
    -- Dot-paths of what is still missing, recomputed on every write from the
    -- real validator. Stored rather than derived on read so the follow-up queue
    -- can filter on "needs only documents" without re-parsing every draft.
    "gaps"              TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "deviceUpdatedAt"   TIMESTAMP(3) NOT NULL,
    "promotedCitizenId" UUID,
    "promotedAt"        TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "field_drafts_clientId_key" ON "field_drafts"("clientId");
CREATE INDEX "field_drafts_parcelNumber_idx" ON "field_drafts"("parcelNumber");
CREATE INDEX "field_drafts_inspectorId_promotedAt_idx"
    ON "field_drafts"("inspectorId", "promotedAt");

ALTER TABLE "field_drafts"
    ADD CONSTRAINT "field_drafts_inspectorId_fkey"
    FOREIGN KEY ("inspectorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "field_drafts"
    ADD CONSTRAINT "field_drafts_promotedCitizenId_fkey"
    FOREIGN KEY ("promotedCitizenId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ───────────────────────────────  Visits  ────────────────────────────────

CREATE TABLE "field_visits" (
    "id"           UUID               NOT NULL DEFAULT gen_random_uuid(),

    -- The idempotency key for the entire sync path, generated on the device
    -- before the visit is recorded. A phone that pushed a batch, lost signal
    -- before reading the response and retried an hour later must not create the
    -- visit twice; the unique index below is what makes the second push a
    -- no-op. It is also what lets the device work with no server at all — it
    -- never has to wait for one to allocate an id.
    "clientId"     UUID               NOT NULL,

    "parcelNumber" TEXT               NOT NULL,
    "outcome"      "VisitOutcome"     NOT NULL,
    "disposition"  "VisitDisposition" NOT NULL,
    "inspectorId"  UUID               NOT NULL,

    -- Device clock at the door, and server receipt time. The two can be a full
    -- day apart; the gap between them is the only honest measure of how long a
    -- worker was offline.
    "visitedAt"    TIMESTAMP(3)       NOT NULL,
    "syncedAt"     TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Capped at 500 chars by the schema. The highest-risk column in this
    -- migration: a record about a person, written by a stranger at their door,
    -- with no declaration behind it. Open decision #1 governs retention, and
    -- this should expire sooner than the register does.
    "note"         TEXT,

    "nextVisitAt"  TIMESTAMP(3),

    -- Optional, and it must stay optional — mandatory location on every visit
    -- is staff surveillance, which is the municipality's call to make openly
    -- rather than a schema's to make silently.
    "latitude"     DOUBLE PRECISION,
    "longitude"    DOUBLE PRECISION,

    "proxyName"    TEXT,
    "proxyPhone"   TEXT,

    "draftId"      UUID,
    "citizenId"    UUID,
    "createdAt"    TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_visits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "field_visits_clientId_key" ON "field_visits"("clientId");

-- Serves "the latest visit per parcel", which every worklist and coverage
-- number is built from.
CREATE INDEX "field_visits_parcelNumber_visitedAt_idx"
    ON "field_visits"("parcelNumber", "visitedAt");

-- Serves the follow-up queue: what is due, and when.
CREATE INDEX "field_visits_disposition_nextVisitAt_idx"
    ON "field_visits"("disposition", "nextVisitAt");

CREATE INDEX "field_visits_inspectorId_visitedAt_idx"
    ON "field_visits"("inspectorId", "visitedAt");

-- The one that matters most. A visit log is a record of work done, and
-- CASCADE here would mean deleting one employee silently rewrote the coverage
-- history of every sector they ever walked — the numbers would change with no
-- trace of why. RESTRICT makes that impossible instead of merely unlikely.
ALTER TABLE "field_visits"
    ADD CONSTRAINT "field_visits_inspectorId_fkey"
    FOREIGN KEY ("inspectorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "field_visits"
    ADD CONSTRAINT "field_visits_draftId_fkey"
    FOREIGN KEY ("draftId") REFERENCES "field_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SET NULL rather than CASCADE: a visit is a record of work done, and it should
-- outlive the deletion of the record it created.
ALTER TABLE "field_visits"
    ADD CONSTRAINT "field_visits_citizenId_fkey"
    FOREIGN KEY ("citizenId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
