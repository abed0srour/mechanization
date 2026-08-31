-- Add isSeen column to citizen_payments table across all tenant schemas.

ALTER TABLE "citizen_payments"
  ADD COLUMN IF NOT EXISTS "isSeen" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "citizen_payments_paymentStatus_isSeen_idx"
  ON "citizen_payments"("paymentStatus", "isSeen");
