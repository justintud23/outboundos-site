-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "scoreBreakdown" JSONB;

-- CreateTable
CREATE TABLE "business_profiles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "preset" TEXT NOT NULL,
    "companySummary" TEXT NOT NULL DEFAULT '',
    "services" TEXT[],
    "yards" JSONB NOT NULL,
    "alwaysZips" TEXT[],
    "neverZips" TEXT[],
    "propertyTypes" JSONB NOT NULL,
    "decisionTitleKeywords" TEXT[],
    "downrankTitleKeywords" TEXT[],
    "bigSites" INTEGER NOT NULL DEFAULT 5,
    "bigAcres" DOUBLE PRECISION,
    "columnMapping" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_profiles_organizationId_key" ON "business_profiles"("organizationId");

-- AddForeignKey
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
