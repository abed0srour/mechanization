-- Which محصّل took the money, when the method is COLLECTOR.
--
-- Schema-unqualified: the migrator sets `search_path` to the target tenant
-- schema before running this, so one file migrates every municipality.
--
-- `0013` added COLLECTOR as a payment method on the grounds that counter cash
-- is already in the safe while collector cash is with a person until handed in.
-- That distinction is only useful if the person is named, which is what this
-- column adds — `reviewedById` records whoever *typed* the row, normally a
-- clerk entering a round at the end of the day, not the collector himself.
--
-- Nullable, and no backfill: every row written before this existed was taken at
-- the counter or by transfer, so there is no collector to name. Guessing one
-- would invent a custody record that never happened.
--
-- ON DELETE SET NULL rather than CASCADE — deleting a staff account must never
-- delete the payments they collected. The money was still received.
ALTER TABLE "citizen_payments"
  ADD COLUMN "collectedById" UUID;

ALTER TABLE "citizen_payments"
  ADD CONSTRAINT "citizen_payments_collectedById_fkey"
  FOREIGN KEY ("collectedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The reconciliation query this exists to answer: what each collector holds.
CREATE INDEX "citizen_payments_collectedById_idx"
  ON "citizen_payments" ("collectedById");
