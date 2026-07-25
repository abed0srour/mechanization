-- The municipality's official parcel registry (رقم العقار), imported from the
-- survey office's KMZ by `cadastre:import`.
--
-- Schema-unqualified on purpose: the migrator sets `search_path` to the target
-- tenant schema, so this one file builds the table inside every municipality.
--
-- Left empty for a municipality whose cadastre has not been imported yet, which
-- the application reads as "accept any well-formed number" rather than as
-- "reject everything".

CREATE TABLE "parcels" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "parcelNumber" TEXT         NOT NULL,
    "latitude"     DOUBLE PRECISION NOT NULL,
    "longitude"    DOUBLE PRECISION NOT NULL,
    "pointCount"   INTEGER      NOT NULL DEFAULT 1,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parcels_pkey" PRIMARY KEY ("id")
);

-- The lookup the citizen form performs on every keystroke-settled parcel number.
CREATE UNIQUE INDEX "parcels_parcelNumber_key" ON "parcels"("parcelNumber");

CREATE INDEX "parcels_latitude_longitude_idx" ON "parcels"("latitude", "longitude");
