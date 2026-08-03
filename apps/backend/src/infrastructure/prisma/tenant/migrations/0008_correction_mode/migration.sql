-- How a rejected claim gets fixed: by the citizen online, or in person at the
-- municipality with an optional appointment.
--
-- Schema-unqualified: the migrator sets `search_path` to the target tenant
-- schema before running this, so one file builds every municipality.

-- Defaults to true so every already-rejected row keeps the behaviour it had
-- when it was written — the citizen could always correct and resubmit.
ALTER TABLE "registrations"
  ADD COLUMN "citizenCanCorrect" BOOLEAN NOT NULL DEFAULT true;

-- Null means "no appointment set", which is the normal case even when an
-- in-person visit is required.
ALTER TABLE "registrations"
  ADD COLUMN "revisitAt" TIMESTAMP(3);
