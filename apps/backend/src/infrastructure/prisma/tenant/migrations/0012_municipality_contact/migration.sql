-- The municipality's own contact numbers.
--
-- Schema-unqualified: the migrator sets `search_path` to the target tenant
-- schema before running this, so one file migrates every municipality.
--
-- `whatsappNumber` is the office account a clerk is expected to be signed into
-- when they send a receipt, and the number printed on that receipt for the
-- citizen to reply to. It does **not** control who a `wa.me` link sends *from*
-- — nothing in a link can, the sender is always whichever WhatsApp account the
-- browser is signed into. See the note on the settings screen.
--
-- Both nullable: a municipality that has not published a number must not have
-- the portal invent a plausible-looking one, exactly as with whishMoneyNumber.
ALTER TABLE "system_settings"
  ADD COLUMN "contactPhone"   TEXT,
  ADD COLUMN "whatsappNumber" TEXT;
