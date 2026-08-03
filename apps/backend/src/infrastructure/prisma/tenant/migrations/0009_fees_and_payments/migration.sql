-- Fee notices, the per-citizen invoices they fan out into, and the
-- municipality settings the citizen portal reads its payment instructions from.
--
-- Schema-unqualified: the migrator sets `search_path` to the target tenant
-- schema before running this, so one file builds every municipality.

CREATE TYPE "FeeFrequency"  AS ENUM ('ONCE', 'MONTHLY', 'HALF_YEARLY', 'ANNUALLY');
CREATE TYPE "FeeTargetType" AS ENUM ('ALL_CITIZENS', 'BUILDING_CATEGORY', 'INDIVIDUAL_CITIZEN');
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PENDING_REVIEW', 'PAID', 'OVERDUE');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'WHISH_MONEY');

-- One row per municipality. `singleton` is UNIQUE so an upsert always lands on
-- the same row — two Whish numbers would leave the portal guessing which to
-- print on a citizen's payment instructions.
CREATE TABLE "system_settings" (
  "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
  "singleton"         BOOLEAN      NOT NULL DEFAULT true,
  "whishMoneyNumber"  TEXT,
  "cashOfficeHours"   TEXT,
  "cashOfficeAddress" TEXT,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  "updatedById"       UUID,
  CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "system_settings_singleton_key" ON "system_settings" ("singleton");

CREATE TABLE "fee_notices" (
  "id"              UUID           NOT NULL DEFAULT gen_random_uuid(),
  "title"           TEXT           NOT NULL,
  "amount"          DECIMAL(14, 2) NOT NULL,
  "currency"        TEXT           NOT NULL DEFAULT 'LBP',
  "frequency"       "FeeFrequency" NOT NULL,
  "targetType"      "FeeTargetType" NOT NULL,
  "targetCategory"  TEXT,
  "targetCitizenId" UUID,
  "dueDate"         TIMESTAMP(3)   NOT NULL,
  "instructions"    TEXT,
  "issuedById"      UUID,
  "createdAt"       TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fee_notices_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fee_notices_targetType_idx" ON "fee_notices" ("targetType");

ALTER TABLE "fee_notices"
  ADD CONSTRAINT "fee_notices_targetCitizenId_fkey"
  FOREIGN KEY ("targetCitizenId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fee_notices"
  ADD CONSTRAINT "fee_notices_issuedById_fkey"
  FOREIGN KEY ("issuedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- `title` and `amount` are copied off the notice rather than joined: correcting
-- next month's fee must not rewrite what someone already paid last month.
CREATE TABLE "citizen_payments" (
  "id"                  UUID            NOT NULL DEFAULT gen_random_uuid(),
  "citizenId"           UUID            NOT NULL,
  "feeNoticeId"         UUID,
  "title"               TEXT            NOT NULL,
  "amount"              DECIMAL(14, 2)  NOT NULL,
  "currency"            TEXT            NOT NULL DEFAULT 'LBP',
  "dueDate"             TIMESTAMP(3)    NOT NULL,
  "paymentStatus"       "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
  "paymentMethod"       "PaymentMethod",
  "whishTransactionRef" TEXT,
  "receiptPath"         TEXT,
  "paidAt"              TIMESTAMP(3),
  "reviewedById"        UUID,
  "reviewNote"          TEXT,
  "createdAt"           TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3)    NOT NULL,
  CONSTRAINT "citizen_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "citizen_payments_citizenId_paymentStatus_idx"
  ON "citizen_payments" ("citizenId", "paymentStatus");
CREATE INDEX "citizen_payments_paymentStatus_dueDate_idx"
  ON "citizen_payments" ("paymentStatus", "dueDate");

-- Makes re-issuing a monthly notice idempotent rather than doubling every
-- resident's bill. Postgres treats NULLs as distinct, so the ad-hoc charges
-- that carry no notice are unaffected by it.
CREATE UNIQUE INDEX "citizen_payments_citizenId_feeNoticeId_key"
  ON "citizen_payments" ("citizenId", "feeNoticeId");

ALTER TABLE "citizen_payments"
  ADD CONSTRAINT "citizen_payments_citizenId_fkey"
  FOREIGN KEY ("citizenId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "citizen_payments"
  ADD CONSTRAINT "citizen_payments_feeNoticeId_fkey"
  FOREIGN KEY ("feeNoticeId") REFERENCES "fee_notices" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "citizen_payments"
  ADD CONSTRAINT "citizen_payments_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
