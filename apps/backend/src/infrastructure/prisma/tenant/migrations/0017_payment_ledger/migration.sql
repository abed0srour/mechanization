-- The payment ledger: an append-only record of money actually moving.
--
-- Schema-unqualified: the migrator sets `search_path` to the target tenant
-- schema before running this, so one file migrates every municipality.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
--
-- Until now a municipality's entire record of a payment was one mutable row.
-- `citizen_payments.paidAmount` held a running total, `paymentMethod` was
-- overwritten by each settlement, and `whishTransactionRef` / `collectedById`
-- were deliberately *cleared* when the method changed — correct for a model
-- that keeps only a balance, and fatal for the questions a municipality is
-- actually asked:
--
--   * "Reprint the receipt for the instalment paid in March."
--   * "Which collector took this, and on what round?"
--   * "Reconcile a collector's satchel against the register for today."
--   * "This was refused at review — what happened to the cash?"
--
-- None of them are answerable from a running total. This table is the answer:
-- one row per movement of money, never updated, never deleted. The balance on
-- `citizen_payments` becomes a cache of SUM(amount) over these rows rather than
-- the source of truth.

-- ── Receipt numbering ───────────────────────────────────────────────────────
--
-- A sequence rather than MAX(receiptNumber) + 1: two clerks settling at the
-- same moment would read the same maximum and issue the same number to two
-- different citizens. A sequence hands out each value exactly once even under
-- concurrency, and never reuses one after a rollback — a gap in the receipt
-- book is a question a municipality can answer ("that transaction was rolled
-- back"), while two receipts bearing the same number is one it cannot.
CREATE SEQUENCE IF NOT EXISTS "payment_receipt_seq" START 1;

CREATE TABLE "payment_transactions" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "paymentId"     UUID NOT NULL,

    -- Signed. Positive is money received; negative is a reversal of an earlier
    -- entry. Storing a correction as a new opposing row rather than as an edit
    -- is the whole point of an append-only ledger: what happened stays on the
    -- record, and the correction is visible as its own act with its own actor
    -- and timestamp.
    "amount"        DECIMAL(14,2) NOT NULL,
    "currency"      TEXT NOT NULL DEFAULT 'LBP',
    "method"        "PaymentMethod" NOT NULL,

    -- Printed on the receipt. Unique across the municipality, never reused.
    "receiptNumber" TEXT NOT NULL,

    -- The provider's handle, when the money came through Whish. Kept per
    -- transaction rather than per invoice, which is what makes a part-Whish,
    -- part-cash invoice describable at all.
    "externalRef"   TEXT,

    -- The collector who physically holds the money, when method is COLLECTOR.
    "collectedById" UUID,
    -- The staff member who entered the row — usually a clerk at a desk
    -- recording what a collector handed in. Distinct from `collectedById` on
    -- purpose; conflating them makes "what does this collector still hold"
    -- unanswerable.
    "recordedById"  UUID,

    -- Set when this row reverses an earlier one. Unique, so a transaction can
    -- be reversed at most once — a second reversal of the same entry would
    -- credit the citizen twice.
    "reversalOfId"  UUID,
    "note"          TEXT,

    -- When the money moved, which is not always when the row was written: a
    -- collector's round is entered at the end of the day.
    "occurredAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
    "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_transactions_paymentId_fkey"
        FOREIGN KEY ("paymentId") REFERENCES "citizen_payments"("id") ON DELETE CASCADE,
    -- RESTRICT, not SET NULL.
    --
    -- SET NULL is an UPDATE, and this table refuses updates — so erasing a
    -- staff member would fail deep inside a cascade with "payment_transactions
    -- is append-only", which names neither the account nor the reason.
    --
    -- RESTRICT is also the honest rule: a person who took money on behalf of
    -- the municipality cannot be erased from the record of taking it.
    -- `StaffService.remove` already refuses to hard-delete an account with
    -- history and offers deactivation instead; ledger rows are exactly that
    -- kind of history, and `countStaffHistory` counts them.
    CONSTRAINT "payment_transactions_collectedById_fkey"
        FOREIGN KEY ("collectedById") REFERENCES "users"("id") ON DELETE RESTRICT,
    CONSTRAINT "payment_transactions_recordedById_fkey"
        FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT,
    CONSTRAINT "payment_transactions_reversalOfId_fkey"
        FOREIGN KEY ("reversalOfId") REFERENCES "payment_transactions"("id") ON DELETE RESTRICT,
    -- A zero-value movement is not a movement.
    CONSTRAINT "payment_transactions_amount_nonzero" CHECK ("amount" <> 0)
);

CREATE UNIQUE INDEX "payment_transactions_receiptNumber_key"
    ON "payment_transactions"("receiptNumber");
CREATE UNIQUE INDEX "payment_transactions_reversalOfId_key"
    ON "payment_transactions"("reversalOfId");

-- The ledger for one invoice, in order — the receipt history and the balance
-- both read this.
CREATE INDEX "payment_transactions_paymentId_occurredAt_idx"
    ON "payment_transactions"("paymentId", "occurredAt");
-- End-of-day reconciliation: what did this collector take, and when.
CREATE INDEX "payment_transactions_collectedById_occurredAt_idx"
    ON "payment_transactions"("collectedById", "occurredAt");
-- "What did the municipality take today", across every collector and clerk.
CREATE INDEX "payment_transactions_occurredAt_idx"
    ON "payment_transactions"("occurredAt");

-- ── The webhook lookup ──────────────────────────────────────────────────────
--
-- `settleFromWhishCallback` matches an invoice on `whishTransactionRef`, which
-- had no index at all — a sequential scan over every payment in the
-- municipality, on every callback the provider sends.
CREATE INDEX IF NOT EXISTS "citizen_payments_whishTransactionRef_idx"
    ON "citizen_payments"("whishTransactionRef");

-- ── Append-only, at the database ────────────────────────────────────────────
--
-- Same guarantee, and the same reasoning, as `audit_log_entries`: a financial
-- record the application can rewrite is worth exactly as much as the
-- application's good behaviour, and an auditor cannot verify that. Corrections
-- are reversing rows, which this permits; edits and deletes are not, which it
-- does not.
--
-- Its own function rather than reusing `reject_audit_mutation()`, so the error
-- names the table the operation was actually attempted against.
CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'payment_transactions is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_transactions_no_update
    BEFORE UPDATE ON "payment_transactions"
    FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TRIGGER payment_transactions_no_delete
    BEFORE DELETE ON "payment_transactions"
    FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- Every invoice already carrying money gets one opening entry, so the ledger
-- balances against `paidAmount` from the first day and no invoice appears to
-- have been paid out of nothing.
--
-- This is the honest limit of the migration: the detail it reconstructs is only
-- what the old model kept. An invoice settled in three instalments becomes a
-- single opening row for the total, because the two earlier instalments were
-- never recorded anywhere and cannot be recovered. The note says so on every
-- row, so nobody later mistakes a reconstructed opening balance for an observed
-- payment.
INSERT INTO "payment_transactions" (
    "paymentId", "amount", "currency", "method", "receiptNumber",
    "externalRef", "collectedById", "recordedById", "note", "occurredAt"
)
SELECT
    p."id",
    p."paidAmount",
    p."currency",
    COALESCE(p."paymentMethod", 'CASH'),
    'OPEN-' || lpad(nextval('payment_receipt_seq')::text, 6, '0'),
    p."whishTransactionRef",
    p."collectedById",
    p."reviewedById",
    'رصيد افتتاحي — مُرحّل من السجل السابق قبل إنشاء دفتر الحركات',
    COALESCE(p."paidAt", p."updatedAt")
FROM "citizen_payments" p
WHERE p."paidAmount" > 0;
