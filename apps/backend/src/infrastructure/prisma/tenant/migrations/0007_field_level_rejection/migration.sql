-- Field-level rejection: which specific fields a reviewer flagged as wrong,
-- alongside the `rejectionReason` note that already existed.
--
-- Schema-unqualified: the migrator sets `search_path` to the target tenant
-- schema before running this, so one file builds every municipality.

-- Dot-paths an applicant's form can resolve back to an input, e.g.
-- 'personal.firstName' or 'property.0.propertyNumber'. Defaulted to an empty
-- array rather than nullable: "no fields flagged" and "not rejected" are both
-- honestly represented by zero rows, and a nullable array would add a third
-- state (NULL) meaning the same thing.
ALTER TABLE "registrations"
  ADD COLUMN "rejectedFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
