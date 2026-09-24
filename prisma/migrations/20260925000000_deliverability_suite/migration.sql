-- CreateEnum
CREATE TYPE "RampPreset" AS ENUM ('CONSERVATIVE', 'STANDARD', 'AGGRESSIVE');

-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('UNVERIFIED', 'HEALTHY', 'WARNING', 'FAILING');

-- AlterTable
ALTER TABLE "mailboxes" ADD COLUMN     "rampPreset" "RampPreset" NOT NULL DEFAULT 'CONSERVATIVE';

-- CreateTable
CREATE TABLE "domain_health" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" "DomainStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "checks" JSONB,
    "registeredAt" TIMESTAMP(3),
    "registeredAtSource" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastStatusChangeAt" TIMESTAMP(3),
    "lastError" TEXT,
    "alertedStatus" "DomainStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_health_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "domain_health_organizationId_idx" ON "domain_health"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "domain_health_organizationId_domain_key" ON "domain_health"("organizationId", "domain");

-- AddForeignKey
ALTER TABLE "domain_health" ADD CONSTRAINT "domain_health_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

