-- 0025_inspector_commission_and_payouts
-- Track the Field Inspector who created each citizen registration
-- and support recording commission payouts ( per registered property).
-- and support recording commission payouts ($1 per registered property).

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS createdById UUID;
ALTER TABLE "registrations" ADD COLUMN IF NOT EXISTS "createdById" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'registrations_createdById_fkey'
  ) THEN
    ALTER TABLE registrations
      ADD CONSTRAINT registrations_createdById_fkey
      FOREIGN KEY (createdById) REFERENCES users(id)
    ALTER TABLE "registrations"
      ADD CONSTRAINT "registrations_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS registrations_createdById_idx ON registrations(createdById);
CREATE INDEX IF NOT EXISTS "registrations_createdById_idx" ON "registrations"("createdById");

CREATE TABLE IF NOT EXISTS inspector_payouts (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  inspectorId UUID NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  paidAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note TEXT,
  reference TEXT,
  recordedById UUID,
  createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inspector_payouts_pkey PRIMARY KEY (id)
CREATE TABLE IF NOT EXISTS "inspector_payouts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "inspectorId" UUID NOT NULL,
  "amount" DECIMAL(10, 2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT,
  "reference" TEXT,
  "recordedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inspector_payouts_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inspector_payouts_inspectorId_fkey'
  ) THEN
    ALTER TABLE inspector_payouts
      ADD CONSTRAINT inspector_payouts_inspectorId_fkey
      FOREIGN KEY (inspectorId) REFERENCES users(id)
    ALTER TABLE "inspector_payouts"
      ADD CONSTRAINT "inspector_payouts_inspectorId_fkey"
      FOREIGN KEY ("inspectorId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inspector_payouts_recordedById_fkey'
  ) THEN
    ALTER TABLE inspector_payouts
      ADD CONSTRAINT inspector_payouts_recordedById_fkey
      FOREIGN KEY (recordedById) REFERENCES users(id)
    ALTER TABLE "inspector_payouts"
      ADD CONSTRAINT "inspector_payouts_recordedById_fkey"
      FOREIGN KEY ("recordedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS inspector_payouts_inspectorId_paidAt_idx ON inspector_payouts(inspectorId, paidAt);
CREATE INDEX IF NOT EXISTS "inspector_payouts_inspectorId_paidAt_idx" ON "inspector_payouts"("inspectorId", "paidAt");
