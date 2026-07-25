-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "schemaName" TEXT NOT NULL,
    "adminPathSegment" TEXT NOT NULL,
    "referencePrefix" TEXT NOT NULL,
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "provisionedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_schemaName_key" ON "tenants"("schemaName");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_adminPathSegment_key" ON "tenants"("adminPathSegment");

