-- الحي (neighborhood) on every property, and الحالة الاجتماعية (marital status)
-- on every citizen.
--
-- Schema-unqualified: the migrator sets `search_path` to the target tenant
-- schema before running this, so one file builds every municipality.

CREATE TYPE "MaritalStatus" AS ENUM ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED');

-- Nullable: staff rows (kind = STAFF) never have one, same as gender/nationality.
ALTER TABLE "users" ADD COLUMN "maritalStatus" "MaritalStatus";

-- Not nullable, but property_entries already has rows from before this field
-- existed — a bare NOT NULL would fail against them. Backfilling with a
-- transient default and then dropping it is the standard way to add a
-- required column to a populated table: existing rows get an obvious
-- placeholder a clerk can spot and correct, new rows must supply a real value.
ALTER TABLE "property_entries" ADD COLUMN "neighborhood" TEXT NOT NULL DEFAULT '';
ALTER TABLE "property_entries" ALTER COLUMN "neighborhood" DROP DEFAULT;
