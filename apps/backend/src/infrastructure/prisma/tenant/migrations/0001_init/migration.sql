-- Baseline tenant schema. Applied once per municipality, inside that
-- municipality's own Postgres schema, by `tenant-migrator.ts`.
--
-- Every statement here is deliberately schema-unqualified: the migrator sets
-- `search_path` to the target tenant schema before executing, which is what lets
-- one SQL file build fifty identical, isolated schemas.
--
-- To add a migration later, generate the delta rather than hand-writing it:
--   prisma migrate diff \
--     --from-schema-datamodel <previous schema.prisma> \
--     --to-schema-datamodel   src/infrastructure/prisma/tenant/schema.prisma \
--     --script > src/infrastructure/prisma/tenant/migrations/000N_<name>/migration.sql

-- ─────────────────────────────  Enums  ─────────────────────────────

CREATE TYPE "UserKind" AS ENUM ('STAFF', 'CITIZEN');
CREATE TYPE "StaffRole" AS ENUM ('SUPER_ADMIN', 'AUDITOR', 'FIELD_INSPECTOR');
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');
CREATE TYPE "ResidentStatus" AS ENUM ('REFUGEE', 'DISPLACED', 'VILLAGE_RESIDENT');
CREATE TYPE "IdentityDocType" AS ENUM ('NATIONAL_ID', 'FAMILY_RECORD', 'DRIVER_LICENSE', 'PASSPORT');
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'VERIFIED', 'APPROVED', 'REJECTED');
CREATE TYPE "OccupancyType" AS ENUM ('OWNER', 'TENANT');
CREATE TYPE "PropertyType" AS ENUM ('BUILDING', 'HOUSE', 'LAND', 'TENT');
CREATE TYPE "UnitType" AS ENUM ('APARTMENT', 'CLINIC', 'SHOP');
CREATE TYPE "LandType" AS ENUM ('AGRICULTURAL', 'INDUSTRIAL');
CREATE TYPE "DocumentType" AS ENUM ('IDENTITY', 'OWNERSHIP_PROOF', 'RENTAL_CONTRACT', 'RESIDENCY_PROOF', 'EXTRA_PHOTO');

-- ─────────────────────────────  users  ─────────────────────────────

CREATE TABLE "users" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind"              "UserKind" NOT NULL,
    "tenantSlug"        TEXT NOT NULL,
    "email"             TEXT,
    "passwordHash"      TEXT,
    "role"              "StaffRole",
    "totpSecret"        TEXT,
    "totpConfirmedAt"   TIMESTAMP(3),
    "phone"             TEXT,
    "whatsapp"          TEXT,
    "firstName"         TEXT NOT NULL,
    "middleName"        TEXT,
    "lastName"          TEXT NOT NULL,
    "gender"            "Gender",
    "nationality"       TEXT,
    "isLebanese"        BOOLEAN,
    "residencyNumber"   TEXT,
    "residentStatus"    "ResidentStatus",
    "identityDocType"   "IdentityDocType",
    "identityDocNumber" TEXT,
    "civilRecordNumber" TEXT,
    "familySize"        INTEGER,
    "referenceNumber"   TEXT,
    "isActive"          BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt"       TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_referenceNumber_key" ON "users"("referenceNumber");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_identityDocType_identityDocNumber_key"
    ON "users"("identityDocType", "identityDocNumber");
CREATE INDEX "users_kind_phone_idx" ON "users"("kind", "phone");
CREATE INDEX "users_kind_role_idx" ON "users"("kind", "role");

-- ──────────────────────────  otp_challenges  ──────────────────────────

CREATE TABLE "otp_challenges" (
    "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone"      TEXT NOT NULL,
    "codeHash"   TEXT NOT NULL,
    "channel"    TEXT NOT NULL DEFAULT 'PRIMARY',
    "attempts"   INTEGER NOT NULL DEFAULT 0,
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "otp_challenges_phone_createdAt_idx" ON "otp_challenges"("phone", "createdAt");

-- ──────────────────────────  registrations  ──────────────────────────

CREATE TABLE "registrations" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "citizenId"       UUID NOT NULL,
    "status"          "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "referenceNumber" TEXT NOT NULL,
    "rejectionReason" TEXT,
    "reviewedById"    UUID,
    "reviewedAt"      TIMESTAMP(3),
    "submittedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "registrations_referenceNumber_key" ON "registrations"("referenceNumber");
CREATE INDEX "registrations_status_submittedAt_idx" ON "registrations"("status", "submittedAt");
CREATE INDEX "registrations_citizenId_idx" ON "registrations"("citizenId");

ALTER TABLE "registrations"
    ADD CONSTRAINT "registrations_citizenId_fkey"
    FOREIGN KEY ("citizenId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "registrations"
    ADD CONSTRAINT "registrations_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────  property_entries  ─────────────────────────

CREATE TABLE "property_entries" (
    "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
    "registrationId" UUID NOT NULL,
    "occupancyType"  "OccupancyType" NOT NULL,
    "landlordName"   TEXT,
    "landlordPhone"  TEXT,
    "propertyType"   "PropertyType" NOT NULL,
    "propertyNumber" TEXT NOT NULL,
    "unitType"       "UnitType",
    "landType"       "LandType",
    "buildingName"   TEXT,
    "floor"          TEXT,
    "side"           TEXT,
    "tentLocation"   TEXT,
    "unitArea"       DECIMAL(12,2),
    "sharedRights"   TEXT[] DEFAULT ARRAY[]::TEXT[],
    "latitude"       DOUBLE PRECISION,
    "longitude"      DOUBLE PRECISION,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_entries_pkey" PRIMARY KEY ("id")
);

-- Uniqueness is per municipality, which the schema boundary already gives us:
-- two municipalities may each legitimately hold a property numbered "123".
CREATE UNIQUE INDEX "property_entries_propertyNumber_key" ON "property_entries"("propertyNumber");
CREATE INDEX "property_entries_propertyType_idx" ON "property_entries"("propertyType");
CREATE INDEX "property_entries_latitude_longitude_idx" ON "property_entries"("latitude", "longitude");

ALTER TABLE "property_entries"
    ADD CONSTRAINT "property_entries_registrationId_fkey"
    FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ────────────────────────────  documents  ────────────────────────────

CREATE TABLE "documents" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "registrationId"  UUID NOT NULL,
    "propertyEntryId" UUID,
    "type"            "DocumentType" NOT NULL,
    "storagePath"     TEXT NOT NULL,
    "mimeType"        TEXT NOT NULL,
    "sizeBytes"       INTEGER NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "documents_registrationId_idx" ON "documents"("registrationId");

ALTER TABLE "documents"
    ADD CONSTRAINT "documents_registrationId_fkey"
    FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "documents"
    ADD CONSTRAINT "documents_propertyEntryId_fkey"
    FOREIGN KEY ("propertyEntryId") REFERENCES "property_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ────────────────────────  audit_log_entries  ────────────────────────

CREATE TABLE "audit_log_entries" (
    "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
    "actorId"    UUID,
    "actorType"  TEXT NOT NULL DEFAULT 'STAFF',
    "actorRole"  "StaffRole",
    "actorEmail" TEXT,
    "action"     TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId"   TEXT,
    "before"     JSONB,
    "after"      JSONB,
    "ipAddress"  TEXT,
    "userAgent"  TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_log_entries_createdAt_idx" ON "audit_log_entries"("createdAt");
CREATE INDEX "audit_log_entries_actorId_idx" ON "audit_log_entries"("actorId");
CREATE INDEX "audit_log_entries_entityType_entityId_idx"
    ON "audit_log_entries"("entityType", "entityId");

-- The audit trail is append-only at the database level, not merely by
-- convention. An audit log that a compromised admin account can rewrite proves
-- nothing after the fact, so UPDATE and DELETE are rejected outright — including
-- for the application's own role.
CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log_entries is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_entries_no_update
    BEFORE UPDATE ON "audit_log_entries"
    FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

CREATE TRIGGER audit_log_entries_no_delete
    BEFORE DELETE ON "audit_log_entries"
    FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
