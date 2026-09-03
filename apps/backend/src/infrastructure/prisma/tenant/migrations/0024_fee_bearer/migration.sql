-- Who a fee is levied on, replacing a boolean that could only ask half of it.
--
-- 0023 added `chargesUnoccupied`: "does this notice charge empty units?". That
-- is a symptom of the real question rather than the question, and it cannot
-- reach the other half — whether a landlord is billed for the flats other
-- people live in. The register bills against a `citizenId`, and a مبنى is filed
-- once by its owner and again, flat by flat, by each tenant; under a per-unit
-- notice the same apartment was therefore charged twice, to two people. No
-- municipality would choose that. It survived because nothing could tell an
-- owner's own home from an owner's let flat.
--
-- Lebanese practice states the rule the boolean was groping at: a شاغرة unit
-- loses رسوم الإشغال والنفايات and keeps الرسوم التأسيسية كالأرصفة والمجاري.
-- Those are two fees with different bearers, not one fee with an exception.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'FeeBearer' AND n.nspname = CURRENT_SCHEMA()
  ) THEN
    CREATE TYPE "FeeBearer" AS ENUM ('OCCUPANT', 'OWNER');
  END IF;
END
$$;

-- OCCUPANT as the default is not a guess about existing notices — it is the
-- value under which they keep billing exactly what they billed. حالة الوحدة is
-- nullable and unrecorded everywhere it has not been surveyed, and an unmarked
-- unit reads as occupied by its owner, so an OCCUPANT-borne notice charges the
-- owner for all of their units and each tenant for their own. That is the old
-- arithmetic. The double-charge corrects itself only as landlords actually mark
-- units مؤجرة, which is the one mechanism that does not require guessing on
-- their behalf.
ALTER TABLE "fee_notices"
  ADD COLUMN IF NOT EXISTS "bearer" "FeeBearer" NOT NULL DEFAULT 'OCCUPANT';

-- The boolean goes rather than being left as a dead column. It has no reader
-- after this migration, and a nullable leftover that once decided money is the
-- kind of thing someone reinstates a query against two years from now.
--
-- Dropped rather than migrated into the new column because there is nothing to
-- carry across: `chargesUnoccupied = false` said "exempt empty units", which
-- OCCUPANT now does on its own, and `true` said "charge them", which is OWNER
-- for an owner-borne fee and simply wrong for an occupant-borne one. Any notice
-- that had been switched off deliberately is one a council decided on, and it
-- deserves to be re-stated in the vocabulary that can express it rather than
-- silently reinterpreted here.
ALTER TABLE "fee_notices" DROP COLUMN IF EXISTS "chargesUnoccupied";
