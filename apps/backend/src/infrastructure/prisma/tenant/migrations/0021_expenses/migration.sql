-- Municipal expenses — money the municipality spends, the mirror of
-- citizen_payments (money it receives).
--
-- Schema-unqualified: the migrator sets `search_path` to the target tenant
-- schema before running this, so one file builds every municipality.

CREATE TYPE "ExpenseCategory" AS ENUM (
  'SALARIES', 'UTILITIES', 'MAINTENANCE', 'INFRASTRUCTURE',
  'FUEL', 'EQUIPMENT', 'ADMINISTRATIVE', 'OTHER'
);
CREATE TYPE "ExpensePaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER');

CREATE TABLE "expenses" (
  "id"            UUID                   NOT NULL DEFAULT gen_random_uuid(),
  "category"      "ExpenseCategory"      NOT NULL DEFAULT 'OTHER',
  "description"   TEXT                   NOT NULL,
  "amount"        DECIMAL(14, 2)         NOT NULL,
  "currency"      TEXT                   NOT NULL DEFAULT 'LBP',
  "expenseDate"   TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payee"         TEXT,
  "paymentMethod" "ExpensePaymentMethod" NOT NULL DEFAULT 'CASH',
  "reference"     TEXT,
  "notes"         TEXT,
  "createdById"   UUID,
  "createdAt"     TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)           NOT NULL,
  "deletedAt"     TIMESTAMP(3),
  CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- The list screen's default view: active expenses, newest first, optionally
-- narrowed to one category.
CREATE INDEX "expenses_category_expenseDate_idx" ON "expenses" ("category", "expenseDate");
CREATE INDEX "expenses_expenseDate_idx" ON "expenses" ("expenseDate");

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
