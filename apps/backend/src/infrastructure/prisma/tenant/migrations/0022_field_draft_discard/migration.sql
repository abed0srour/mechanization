-- Let a field worker take back a household that should never have existed.
--
-- «مواطن جديد» tapped twice, a tenant entered against the neighbouring
-- building, a family recorded under the wrong door. Before this there was no
-- way to undo any of it: the household stayed on the worklist forever, and
-- because an open draft counts as unfinished work it also held its whole parcel
-- in «مستحقة» — a door the worker was sent back to indefinitely for a record
-- that was a typo.
--
-- Soft, not a DELETE. `field_visits.draftId` is ON DELETE SET NULL, so removing
-- the row would cut loose the visits that reference it — and those are the
-- record of knocks that genuinely happened at that door, which survive the
-- mistake about who lived behind it. A discarded draft keeps its visits, its
-- author and its timestamps, and simply stops being work.
--
-- `discardReason` is NOT NULL-enforced here but is required by
-- `discardDraftSchema` on the way in. The column is nullable because rows that
-- predate this migration have no reason to give, and backfilling a sentence
-- nobody wrote would be worse than a null.
ALTER TABLE "field_drafts"
    ADD COLUMN "discardedAt"   TIMESTAMP(3),
    ADD COLUMN "discardReason" TEXT;

-- The worklist's hottest read — "open households on these parcels" — now
-- carries two null checks instead of one.
CREATE INDEX "field_drafts_parcelNumber_promotedAt_discardedAt_idx"
    ON "field_drafts"("parcelNumber", "promotedAt", "discardedAt");
