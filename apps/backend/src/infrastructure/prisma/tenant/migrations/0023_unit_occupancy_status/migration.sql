-- شاغل and شاغر: who occupies a property, and whether anybody does.
--
-- Two words one Arabic dot apart, describing opposite things, and the register
-- could write down neither. Occupancy was OWNER or TENANT, so the شاغل بتسامح
-- — the son in his father's flat, the caretaker on the ground floor — was
-- filed as a tenant, putting a lease in the register that does not exist. And
-- a unit had no state at all, so a landlord's empty third floor and his
-- occupied second were the same row to everything that read them.
--
-- Nothing here changes a bill. `chargesUnoccupied` defaults to true, which is
-- exactly what the biller did yesterday: record the status, do not read it.

-- The third occupancy. `ADD VALUE IF NOT EXISTS` as a plain top-level
-- statement — idempotent, and the form Postgres permits inside the transaction
-- a migration runs in, provided nothing in this file goes on to *use* the new
-- label. Nothing does.
ALTER TYPE "OccupancyType" ADD VALUE IF NOT EXISTS 'FREE_OCCUPANT';

-- حالة الوحدة.
--
-- RENTED is the value that is not obvious and is the reason the other three
-- can be trusted. A مبنى of ten flats is filed once by its owner and again,
-- flat by flat, by each tenant — the same apartment under two citizens, which
-- is correct, because ownership and occupancy are different facts. Under a
-- PER_UNIT notice that is two charges for one flat unless something marks
-- which row is the tenancy. This is that something.
--
-- The CREATE is guarded rather than plain `CREATE TYPE`: this migration runs
-- once per municipality schema, and a partially-applied loop has to be safe to
-- re-run over the tenants it already reached.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'UnitStatus' AND n.nspname = CURRENT_SCHEMA()
  ) THEN
    CREATE TYPE "UnitStatus" AS ENUM ('OWNER_OCCUPIED', 'RENTED', 'VACANT', 'UNDER_CONSTRUCTION');
  END IF;
END
$$;

-- Nullable, with no default and no backfill.
--
-- A default would be a guess about every unit already in the register, and the
-- guess that would matter — 'OWNER_OCCUPIED' on a landlord's whole portfolio —
-- is wrong for most of it. Null says what is true: nobody was asked. Every
-- reader treats it as occupied and therefore chargeable, so an unanswered
-- question costs nothing and claims nothing.
ALTER TABLE "property_entries" ADD COLUMN IF NOT EXISTS "unitStatus" "UnitStatus";
ALTER TABLE "building_units"  ADD COLUMN IF NOT EXISTS "unitStatus" "UnitStatus";

-- Whether a notice charges for units recorded شاغرة or قيد الإنجاز.
--
-- TRUE is the behaviour that exists today, so this column changes no bill on
-- the day it lands. Setting it FALSE exempts the empty units of everyone the
-- notice targets, which is a council decision about إعفاء الوحدات الشاغرة and
-- needs the by-law it rests on named first — the same bar §11 sets for moving
-- a fee off FLAT at all.
ALTER TABLE "fee_notices"
  ADD COLUMN IF NOT EXISTS "chargesUnoccupied" BOOLEAN NOT NULL DEFAULT true;
