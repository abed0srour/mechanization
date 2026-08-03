-- Recurring fee billing: a period stamp on every invoice, and an off switch
-- on the notice that generates them.
--
-- Schema-unqualified: the migrator sets `search_path` to the target tenant
-- schema before running this, so one file builds every municipality.

-- Which period an invoice covers: '2026-07', '2026-H2', '2026', or 'ONCE'.
-- Defaulted rather than nullable, because Postgres treats NULLs as distinct in
-- a unique index — a nullable column here would silently allow the duplicate
-- rows the index exists to prevent.
ALTER TABLE "citizen_payments"
  ADD COLUMN "periodKey" TEXT NOT NULL DEFAULT 'ONCE';

-- Stops the recurring biller re-issuing a notice, without touching any
-- invoice it has already raised.
ALTER TABLE "fee_notices"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- The old key allowed one invoice per (citizen, notice) for all time, which
-- made a monthly fee chargeable exactly once. Widening it to include the
-- period is what turns "already billed" into "already billed *this month*".
DROP INDEX IF EXISTS "citizen_payments_citizenId_feeNoticeId_key";

CREATE UNIQUE INDEX "citizen_payments_citizenId_feeNoticeId_periodKey_key"
  ON "citizen_payments" ("citizenId", "feeNoticeId", "periodKey");
