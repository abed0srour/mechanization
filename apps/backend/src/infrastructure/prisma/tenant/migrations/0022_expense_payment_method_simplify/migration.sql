-- Narrows ExpensePaymentMethod to how this municipality actually pays out:
-- CASH or a Whish transfer. BANK_TRANSFER/CHEQUE/OTHER never reflected real
-- practice here.
--
-- Schema-unqualified: the migrator sets `search_path` to the target tenant
-- schema before running this, so one file builds every municipality.

ALTER TYPE "ExpensePaymentMethod" RENAME TO "ExpensePaymentMethod_old";
CREATE TYPE "ExpensePaymentMethod" AS ENUM ('CASH', 'WHISH_MONEY');

ALTER TABLE "expenses" ALTER COLUMN "paymentMethod" DROP DEFAULT;
-- Any row already on a dropped value (there should be none — this table is
-- new) falls back to CASH rather than blocking the migration.
ALTER TABLE "expenses" ALTER COLUMN "paymentMethod" TYPE "ExpensePaymentMethod"
  USING (
    CASE "paymentMethod"::text
      WHEN 'CASH' THEN 'CASH'
      WHEN 'WHISH_MONEY' THEN 'WHISH_MONEY'
      ELSE 'CASH'
    END
  )::"ExpensePaymentMethod";
ALTER TABLE "expenses" ALTER COLUMN "paymentMethod" SET DEFAULT 'CASH';

DROP TYPE "ExpensePaymentMethod_old";
