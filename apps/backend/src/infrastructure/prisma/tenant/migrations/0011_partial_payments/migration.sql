-- Partial cash payments.
--
-- Schema-unqualified: the migrator sets `search_path` to the target tenant
-- schema before running this, so one file migrates every municipality.
--
-- Until now an invoice was all-or-nothing — `settleInPerson` flipped the whole
-- row to PAID — which meant a citizen who walked in with half the money could
-- not be recorded as having paid anything at all. The clerk's only options were
-- to refuse the money or to mark a debt settled that was not.
--
-- `paidAmount` separates *what was raised* (`amount`, immutable, what the
-- notice said) from *what has actually been received*. That split is why this
-- is a new column rather than a mutation of `amount`: reducing `amount` on
-- receipt would destroy the record of what was originally owed, and every
-- report that sums it would silently change its answer after the fact.
ALTER TABLE "citizen_payments"
  ADD COLUMN "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- A row already marked PAID was settled in full under the old rule, so what it
-- received is its full amount. Without this backfill every historical payment
-- would read as "0 collected, full amount outstanding" the moment this column
-- starts being trusted — the collection rate on the dashboard would drop to
-- zero overnight and every settled invoice would reappear as a debt.
UPDATE "citizen_payments"
   SET "paidAmount" = "amount"
 WHERE "paymentStatus" = 'PAID';
