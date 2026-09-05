-- الأسرة, and the identity fields that make one person tellable from another.
--
-- Two changes that only look separate. The register could not say who lives in
-- a house — only how many — and it could not reliably say which of two people
-- with the same name it was holding. Both are answered at the same doorstep, by
-- the same officer, in the same visit, and neither can be answered afterwards
-- from a desk. That is the whole reason they land together and before collection
-- rather than after it.
--
-- Nothing here changes a bill. Every column is nullable, every table starts
-- empty, and `familySize` keeps working exactly as it did.

-- ────────────────────────────  Identity fields  ────────────────────────────

-- اسم الأم and تاريخ الولادة.
--
-- The register's only uniqueness key for a person is
-- (نوع الوثيقة, رقم الوثيقة), which a citizen who presents a هوية one year and
-- an إخراج قيد the next walks straight through — becoming two people with two
-- sets of property cards. These are the two fields a clerk staring at a
-- near-duplicate can actually decide on, and اسم الأم is the stronger of them:
-- it is the one identity fact that crosses the patriline, so it separates
-- brothers from each other and cousins from each other where اسم الأب, الشهرة
-- and the سجل all agree.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "motherName" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "dateOfBirth" DATE;

-- محل القيد.
--
-- `civilRecordNumber` has been stored on its own since the beginning, and on its
-- own it is half a value: a سجل number is unique only inside its own محلة, and
-- every village in Lebanon has a سجل ٤٥. Two unrelated residents therefore
-- collide on it by default, which makes the field worse than useless for telling
-- records apart — it actively suggests matches that are not there.
--
-- Free text, like `system_settings.district`, because Lebanon's caza boundaries
-- are a political fact this system has no business asserting a canonical list of.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "registrationPlaceTown" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "registrationPlaceDistrict" TEXT;

-- A second contact, and whose it is.
--
-- The `@@unique` on this table already records that a household commonly shares
-- one phone. When that number dies the municipality has no way to reach the
-- household at all, and the رقم مرجعي on a slip is the last thread. The relation
-- is stored with the number because a bare second number nobody can place is one
-- a clerk will not ring.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "altPhone" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "altPhoneRelation" TEXT;

-- ──────────────────────────────  Household  ──────────────────────────────

-- Guarded rather than a plain CREATE TYPE: this file runs once per municipality
-- schema, and a loop interrupted part-way has to be safe to re-run over the
-- tenants it already reached.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'HouseholdRelation' AND n.nspname = CURRENT_SCHEMA()
  ) THEN
    CREATE TYPE "HouseholdRelation" AS ENUM (
      'HEAD', 'SPOUSE', 'CHILD', 'PARENT', 'SIBLING', 'RELATIVE', 'OTHER'
    );
  END IF;
END
$$;

-- The household as a row of its own.
--
-- The obvious alternative was a `headOfHouseholdId` on `users` pointing at
-- another user, and it is wrong in four ways that only show up later: nothing
-- prevents a cycle, it cannot describe two co-equal adults, promoting a
-- newly-arrived husband to head means re-pointing every dependent row, and there
-- is no single thing to merge two families *into*. A row makes membership one
-- nullable column, headship one nullable column on the household, and a merge a
-- single UPDATE — which is what makes a wrong link undoable rather than
-- permanent.
CREATE TABLE IF NOT EXISTS "households" (
  "id"        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable, and a real state: a roster filed for a house whose head was out is
  -- a household with members and nobody yet designated.
  "headId"    UUID,
  "label"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One household per head. Two rows naming the same رب أسرة is the merge failure
-- this whole feature exists to prevent, so it is refused by the database rather
-- than by whichever service remembered to check.
CREATE UNIQUE INDEX IF NOT EXISTS "households_headId_key"
  ON "households" ("headId");

-- SET NULL rather than CASCADE on both sides below, and deliberately: deleting a
-- citizen must never take a household — or the other people in it — with them.
--
-- Idempotence by exception rather than by a catalog lookup. `pg_constraint` has
-- no schema column to filter on directly — `connamespace` is the *constraint's*
-- namespace and comparing it needs a cast this file cannot rely on across
-- versions — while `duplicate_object` is raised by the server itself and means
-- exactly the one thing a re-run needs to tolerate.
DO $$
BEGIN
  ALTER TABLE "households"
    ADD CONSTRAINT "households_headId_fkey"
    FOREIGN KEY ("headId") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "householdId" UUID;

DO $$
BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_householdId_fkey"
    FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

CREATE INDEX IF NOT EXISTS "users_householdId_idx" ON "users" ("householdId");

-- أفراد الأسرة — the roster that replaces the count.
--
-- `familySize` recorded that six people live here and destroyed the only chance
-- anyone would get to learn who they are. It also could not be deduplicated: a
-- husband and a wife who each register are two rows each declaring the same six,
-- which is why `sum("familySize")` on the dashboard has been reporting roughly
-- twice the town.
--
-- `fullName` is undivided on purpose. This name is recited by one person about
-- another, and splitting it into الاسم / اسم الأب / الشهرة at the door produces
-- an invented middle field. The linkage features compare token sets, so nothing
-- downstream needs the split.
CREATE TABLE IF NOT EXISTS "household_members" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "householdId"     UUID NOT NULL,
  "fullName"        TEXT NOT NULL,
  "relationToHead"  "HouseholdRelation" NOT NULL,
  -- A year, not a date. A relative reliably knows the year and reliably invents
  -- the day, and an invented birth date is worse than an absent one because it
  -- is what identity is scored on.
  "birthYear"       INTEGER,
  "gender"          "Gender",
  -- A son in Abidjan is on the family roster and is not in the town. Every
  -- population figure filters on this; the roster itself does not.
  "residesHere"     BOOLEAN NOT NULL DEFAULT true,
  "linkedCitizenId" UUID,
  "linkedVia"       TEXT,
  "linkedAt"        TIMESTAMP(3),
  "linkedById"      UUID,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  ALTER TABLE "household_members"
    ADD CONSTRAINT "household_members_householdId_fkey"
    FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

-- SET NULL, not CASCADE: erasing a citizen must not delete the roster row that
-- describes them. Somebody said that person lives in this house, and that stays
-- true — what stops being true is the claim that this file is them.
DO $$
BEGIN
  ALTER TABLE "household_members"
    ADD CONSTRAINT "household_members_linkedCitizenId_fkey"
    FOREIGN KEY ("linkedCitizenId") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

-- One citizen occupies at most one roster slot. A man is one person in one
-- household, and two rows claiming him is exactly the quiet merge error the
-- resolver refuses to commit — so the database refuses it too.
CREATE UNIQUE INDEX IF NOT EXISTS "household_members_linkedCitizenId_key"
  ON "household_members" ("linkedCitizenId");

-- The folded copy of the roster name, so a slot can be *found* by a name typed
-- any of the ways Arabic writes it.
--
-- The same GENERATED column and the same schema-local `search_normalize` the
-- users and payments tables have used since 0018, for the same reason: both
-- sides of a comparison have to be in one alphabet or the match silently stops
-- happening. It matters more here than anywhere else, because this name was
-- written down by a relative rather than copied off a document — «علي» for
-- عليّ, «نصر الله» for نصرالله — and it is the primary blocking key the
-- resolver uses to find candidate slots at all.
ALTER TABLE "household_members"
  ADD COLUMN IF NOT EXISTS "searchText" TEXT
  GENERATED ALWAYS AS (search_normalize("fullName")) STORED;

CREATE INDEX IF NOT EXISTS "household_members_searchText_idx"
  ON "household_members" ("searchText");

-- The roster read, and the "which slots are still unfilled" query every
-- resolution blocks on.
CREATE INDEX IF NOT EXISTS "household_members_householdId_linkedCitizenId_idx"
  ON "household_members" ("householdId", "linkedCitizenId");

-- ──────────────────────────────  What is not done  ──────────────────────────
--
-- `users.familySize` is left in place and left populated.
--
-- Not because it is still the authority — where a roster exists, the roster is
-- the count — but because dropping it would silently rewrite every record
-- collected before today into a household of unknown size. The integer is the
-- only thing those rows know about themselves, and a municipality mid-collection
-- would watch its population figure fall to zero for the streets it had already
-- walked. Readers prefer the roster and fall back to the integer; the column
-- goes when a tenant's roster coverage is complete, which is a decision per
-- municipality rather than a migration.
--
-- `users."searchText"` is NOT extended to cover "motherName".
--
-- It is a GENERATED column (migration 0018) and redefining it rewrites the whole
-- table, which is not a thing to do in the same migration that adds five columns
-- to it. The consequence is real and worth stating plainly: until that is done, a
-- clerk cannot *search* by mother's name, even though the resolver scores on it.
