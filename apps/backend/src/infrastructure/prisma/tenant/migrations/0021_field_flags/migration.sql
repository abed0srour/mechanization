-- «غير مؤكَّد / بانتظار المعلومة» — fields a field officer could not establish,
-- and the reason each one is missing.

-- A record with unestablished fields is not pending adjudication and not
-- rejected: the citizen is registered, searchable and billable. REQUIRES_REVIEW
-- says only that named parts of it were never collected, which is what makes
-- the work queue possible.
--
-- `ADD VALUE IF NOT EXISTS` rather than a guarded DO block: it is idempotent on
-- its own, and it is a plain top-level statement, which is the form Postgres
-- allows inside the transaction each migration runs in. Nothing in this file
-- uses the new label — that is the other half of the same rule.
ALTER TYPE "ReportStatus" ADD VALUE IF NOT EXISTS 'REQUIRES_REVIEW';

-- The flags themselves: `[{ "path": "personal.civilRecordNumber", "reason": "…" }]`.
--
-- Denormalised onto the registration for the same reason `rejectedFields` is —
-- it is written as one blob when the record is filed and read as one blob when
-- someone opens it to finish. A row per flag would buy a queryability nothing
-- here asks for; "which records need review" is answered by `status`.
ALTER TABLE "registrations"
  ADD COLUMN IF NOT EXISTS "flaggedFields" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- The browser's own name for a submission, minted before it is ever sent.
--
-- A record filed with no connection carries this id through every retry, so a
-- queued submission whose response was lost to the same bad network that
-- queued it is recognised on arrival and answered with the registration it
-- already created. Without it, "did that save?" has no answer that does not
-- risk registering the person twice.
ALTER TABLE "registrations"
  ADD COLUMN IF NOT EXISTS "clientSubmissionId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "registrations_clientSubmissionId_key"
  ON "registrations"("clientSubmissionId");

-- الحي and رقم العقار become nullable, because they are exactly the two a field
-- officer standing at the property most often cannot supply: the deed is with a
-- relative in another town, or the settlement has no cadastral number at all.
-- They stay required by `propertyEntrySchema` for every record filed without a
-- flag against them — this only makes the column able to hold the absence the
-- flag records.
ALTER TABLE "property_entries" ALTER COLUMN "neighborhood" DROP NOT NULL;
ALTER TABLE "property_entries" ALTER COLUMN "propertyNumber" DROP NOT NULL;
