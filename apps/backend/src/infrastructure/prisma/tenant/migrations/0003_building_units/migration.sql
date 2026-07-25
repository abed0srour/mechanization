-- ─────────────────────────  building_units  ─────────────────────────
--
-- A citizen who owns a whole building registers one عقار — one رقم العقار, one
-- اسم المبنى — containing many units. That could not be expressed before: the
-- unit fields (نوع الوحدة, الطابق, الجهة, المساحة) lived directly on
-- property_entries, so "a building with six apartments" had to be filed as six
-- property_entries rows, and `property_entries_propertyNumber_key` rejects the
-- second one. Splitting the units into a child table keeps that uniqueness
-- constraint — which the cadastre lookup depends on — while letting one parcel
-- carry as many units as it really has.
--
-- HOUSE / LAND / TENT keep using the columns on property_entries; only BUILDING
-- reads its units from here.

CREATE TABLE "building_units" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "propertyEntryId" UUID NOT NULL,
    "unitType"        "UnitType" NOT NULL,
    "floor"           TEXT NOT NULL,
    "side"            TEXT,
    "unitArea"        DECIMAL(12,2) NOT NULL,
    "sharedRights"    TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "building_units_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "building_units_propertyEntryId_idx" ON "building_units"("propertyEntryId");

ALTER TABLE "building_units"
    ADD CONSTRAINT "building_units_propertyEntryId_fkey"
    FOREIGN KEY ("propertyEntryId") REFERENCES "property_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing BUILDING rows carry exactly one unit in their own columns. Move it
-- across so every building reads its units from one place, and no already-filed
-- registration silently loses its unit data.
INSERT INTO "building_units" ("propertyEntryId", "unitType", "floor", "side", "unitArea", "sharedRights", "updatedAt")
SELECT
    "id",
    "unitType",
    COALESCE("floor", ''),
    "side",
    COALESCE("unitArea", 0),
    COALESCE("sharedRights", ARRAY[]::TEXT[]),
    CURRENT_TIMESTAMP
FROM "property_entries"
WHERE "propertyType" = 'BUILDING' AND "unitType" IS NOT NULL;
