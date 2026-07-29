-- Administrative sectors (قطاع) the municipality draws over its own cadastre.
--
-- Schema-unqualified on purpose: the migrator sets `search_path` to the target
-- tenant schema, so this one file builds the table inside every municipality.
--
-- Membership lives in a text array of parcel numbers rather than a join table
-- onto "parcels". A cadastre re-import rebuilds that table wholesale, and a
-- foreign key would cascade every zone empty on a routine survey correction;
-- the deed's printed number survives the re-import, so it is what is stored.

CREATE TABLE "zones" (
    "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
    "name"          TEXT         NOT NULL,
    "code"          TEXT         NOT NULL,
    "color"         TEXT         NOT NULL DEFAULT '#3B82F6',
    "description"   TEXT,
    "parcelNumbers" TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "zones_code_key" ON "zones"("code");

CREATE INDEX "zones_name_idx" ON "zones"("name");

-- Answers "which zone owns this parcel number", which the editor asks for every
-- parcel it paints and the service asks again to reject a double assignment.
-- GIN over the array is what makes that a lookup rather than a scan of every zone.
CREATE INDEX "zones_parcelNumbers_idx" ON "zones" USING GIN ("parcelNumbers");
