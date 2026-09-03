-- Multiple structures on one parcel, and fees assessed per unit rather than per
-- citizen.
--
-- Two changes that look unrelated and are the same change. The register could
-- always record that a citizen holds six shops; the biller could not read it,
-- and charged the same for six as for one, because a notice's amount *was* the
-- invoice and the only question ever asked of a citizen's holdings was a
-- boolean — do they have at least one of these.

-- The unit taxonomy, widened. A rate schedule can only distinguish what this
-- enum distinguishes, so محل and مستودع sharing a value meant a municipality
-- could not charge them differently even where its own by-laws do.
--
-- `ADD VALUE IF NOT EXISTS` as plain top-level statements: idempotent on their
-- own, and the form Postgres allows inside the transaction a migration runs in.
-- Nothing in this file uses the new labels — that is the other half of the rule.
ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'INDEPENDENT_HOUSE';
ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'OFFICE';
ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'WAREHOUSE';

-- What a notice's amount is per.
--
-- FLAT is the original behaviour and the default, so every notice already
-- written keeps billing exactly what it did — this migration changes nobody's
-- bill on its own. Moving a notice off FLAT changes what residents owe, which
-- is a council decision with a legal basis behind it, not a deploy.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'FeeBasis' AND n.nspname = CURRENT_SCHEMA()
  ) THEN
    CREATE TYPE "FeeBasis" AS ENUM ('FLAT', 'PER_UNIT', 'PER_AREA');
  END IF;
END
$$;

ALTER TABLE "fee_notices"
  ADD COLUMN IF NOT EXISTS "basis" "FeeBasis" NOT NULL DEFAULT 'FLAT';

-- How one invoice was arrived at: `{ basis, rate, unitCount, totalArea, lines }`.
--
-- Stored rather than recomputed on read. A citizen who sells a shop the week
-- after being billed would otherwise open an invoice whose lines no longer add
-- up to the amount they are being asked to pay — a bill has to stay true to the
-- moment it was raised. Null for a flat charge, which explains itself.
ALTER TABLE "citizen_payments"
  ADD COLUMN IF NOT EXISTS "assessment" JSONB;
