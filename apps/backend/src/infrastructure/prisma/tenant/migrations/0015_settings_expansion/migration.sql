-- The settings screen's remaining sections, given somewhere to live.
--
-- Schema-unqualified: the migrator sets `search_path` to the target tenant
-- schema before running this, so one file migrates every municipality.
--
-- Until now `system_settings` held five contact fields, which is why the
-- profile, finance, numbering and backup sections of the settings screen were
-- kept in the administrator's browser. Everything below is what those four
-- sections need in order to be the same for every clerk in the building.
--
-- All nullable or defaulted, so the existing singleton row in every provisioned
-- schema stays valid without a backfill.

-- ── Municipality profile ────────────────────────────────────────────────────
--
-- `nameAr`/`nameEn` duplicate the registry's copy on purpose. The registry row
-- routes a request to this schema and belongs to whoever provisions
-- municipalities; this copy is what the municipality prints on its own
-- documents, and fixing a misspelt name on a receipt must not require an
-- operator to edit the routing table.
ALTER TABLE "system_settings"
  ADD COLUMN "nameAr"       TEXT,
  ADD COLUMN "nameEn"       TEXT,
  ADD COLUMN "contactEmail" TEXT,
  ADD COLUMN "website"      TEXT,
  ADD COLUMN "governorate"  TEXT,
  ADD COLUMN "district"     TEXT,
  ADD COLUMN "town"         TEXT;

-- The crest, inlined as a data URI.
--
-- There is no object store in this deployment and nothing to serve a file from,
-- so a URL would have nowhere to point. Capped at 512 KB by the request schema.
-- It is excluded from the settings payload citizens receive — half a megabyte
-- of base64 on the pay dialog of every citizen on a 3G connection is the cost
-- that would otherwise be paid on every page load.
ALTER TABLE "system_settings"
  ADD COLUMN "logoDataUri" TEXT;

-- ── Finance defaults ────────────────────────────────────────────────────────
--
-- Defaults applied when a fee is issued, never a re-pricing of one already
-- issued: `citizen_payments` denormalises its own amount precisely so that
-- changing a rate here cannot rewrite what a citizen already owes.
--
-- `defaultRatePercent` and `exchangeRate` are NUMERIC rather than DOUBLE
-- PRECISION. Both multiply money the moment an issuer reads them, and the
-- database is the system of record for that even while the API hands them out
-- as JSON numbers for display.
ALTER TABLE "system_settings"
  ADD COLUMN "defaultFeeFrequency"   "FeeFrequency" NOT NULL DEFAULT 'ANNUALLY',
  ADD COLUMN "defaultDueDays"        INTEGER        NOT NULL DEFAULT 30,
  ADD COLUMN "priceDisplay"          TEXT           NOT NULL DEFAULT 'compact',
  ADD COLUMN "defaultRatePercent"    NUMERIC(5, 2)  NOT NULL DEFAULT 0,
  ADD COLUMN "baseCurrency"          TEXT           NOT NULL DEFAULT 'LBP',
  ADD COLUMN "secondaryCurrency"     TEXT,
  ADD COLUMN "exchangeRate"          NUMERIC(18, 6),
  ADD COLUMN "exchangeRateUpdatedAt" TIMESTAMP(3);

-- A percentage outside 0–100 is not a rate, and a due term measured in negative
-- days is not a term. Enforced here as well as in the request schema because
-- this row outlives any one version of the application that writes it.
ALTER TABLE "system_settings"
  ADD CONSTRAINT "system_settings_defaultRatePercent_range"
    CHECK ("defaultRatePercent" >= 0 AND "defaultRatePercent" <= 100),
  ADD CONSTRAINT "system_settings_defaultDueDays_range"
    CHECK ("defaultDueDays" >= 0 AND "defaultDueDays" <= 365),
  ADD CONSTRAINT "system_settings_priceDisplay_values"
    CHECK ("priceDisplay" IN ('compact', 'exact')),
  -- Nullable, but never zero or negative: dividing by it is the whole point.
  ADD CONSTRAINT "system_settings_exchangeRate_positive"
    CHECK ("exchangeRate" IS NULL OR "exchangeRate" > 0),
  -- A secondary currency equal to the base one would make every conversion the
  -- identity and the rate meaningless.
  ADD CONSTRAINT "system_settings_secondaryCurrency_distinct"
    CHECK ("secondaryCurrency" IS NULL OR "secondaryCurrency" <> "baseCurrency");

-- ── Configuration held as documents ─────────────────────────────────────────
--
-- `numberingSequences` is JSON rather than a table because nothing allocates a
-- number from it yet. When an issuer exists this must become its own table with
-- a row per document type and SELECT … FOR UPDATE around the increment: a JSON
-- blob cannot hand two concurrent requests two different invoice numbers, and
-- issuing one reference twice is precisely what a numbering scheme exists to
-- prevent.
--
-- `backupSchedule` is read by nothing — this deployment has no scheduler
-- process. It records the intent so the eventual job has something to read.
ALTER TABLE "system_settings"
  ADD COLUMN "numberingSequences" JSONB,
  ADD COLUMN "backupSchedule"     JSONB;
