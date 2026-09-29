-- CreateEnum
CREATE TYPE "SalesforceConnectionStatus" AS ENUM ('CONNECTED', 'NEEDS_RECONNECT', 'RATE_LIMITED');

-- CreateEnum
CREATE TYPE "SalesforceObject" AS ENUM ('LEAD', 'CONTACT');

-- CreateEnum
CREATE TYPE "SfCheckStatus" AS ENUM ('CLEAR', 'CUSTOMER', 'OPEN_OPPORTUNITY', 'OPTED_OUT', 'CONVERTED', 'NOT_FOUND');

-- CreateEnum
CREATE TYPE "SalesforceJobType" AS ENUM ('LOG_SEND', 'LOG_REPLY', 'CREATE_LEAD');

-- CreateEnum
CREATE TYPE "SalesforceJobStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "salesforceAccountId" TEXT,
ADD COLUMN     "salesforceId" TEXT,
ADD COLUMN     "salesforceType" "SalesforceObject",
ADD COLUMN     "sfBlockOverride" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sfCheckDetail" TEXT,
ADD COLUMN     "sfCheckStatus" "SfCheckStatus",
ADD COLUMN     "sfCheckedAt" TIMESTAMP(3),
ADD COLUMN     "sfHeldSince" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "lastSalesforceOrgId" TEXT;

-- CreateTable
CREATE TABLE "salesforce_connections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "instanceUrl" TEXT NOT NULL,
    "loginHost" TEXT NOT NULL,
    "sfOrgId" TEXT NOT NULL,
    "sfUserId" TEXT NOT NULL,
    "sfUsername" TEXT NOT NULL,
    "sfUserEmail" TEXT,
    "refreshTokenEnc" TEXT NOT NULL,
    "status" "SalesforceConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "lastError" TEXT,
    "rateLimitedUntil" TIMESTAMP(3),
    "heldAlertedAt" TIMESTAMP(3),
    "customerAccountTypes" TEXT[] DEFAULT ARRAY['Customer']::TEXT[],
    "blockOpenOpportunities" BOOLEAN NOT NULL DEFAULT true,
    "logActivity" BOOLEAN NOT NULL DEFAULT true,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connectedByMemberId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salesforce_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salesforce_sync_jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "SalesforceJobType" NOT NULL,
    "outboundMessageId" TEXT,
    "inboundReplyId" TEXT,
    "status" "SalesforceJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "sfTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salesforce_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "salesforce_connections_organizationId_key" ON "salesforce_connections"("organizationId");

-- CreateIndex
CREATE INDEX "salesforce_sync_jobs_status_nextAttemptAt_idx" ON "salesforce_sync_jobs"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "salesforce_sync_jobs_organizationId_status_idx" ON "salesforce_sync_jobs"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "salesforce_sync_jobs_type_outboundMessageId_key" ON "salesforce_sync_jobs"("type", "outboundMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "salesforce_sync_jobs_type_inboundReplyId_key" ON "salesforce_sync_jobs"("type", "inboundReplyId");

-- CreateIndex
CREATE INDEX "leads_organizationId_salesforceId_idx" ON "leads"("organizationId", "salesforceId");

-- AddForeignKey
ALTER TABLE "salesforce_connections" ADD CONSTRAINT "salesforce_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salesforce_connections" ADD CONSTRAINT "salesforce_connections_connectedByMemberId_fkey" FOREIGN KEY ("connectedByMemberId") REFERENCES "org_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salesforce_sync_jobs" ADD CONSTRAINT "salesforce_sync_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salesforce_sync_jobs" ADD CONSTRAINT "salesforce_sync_jobs_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salesforce_sync_jobs" ADD CONSTRAINT "salesforce_sync_jobs_outboundMessageId_fkey" FOREIGN KEY ("outboundMessageId") REFERENCES "outbound_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salesforce_sync_jobs" ADD CONSTRAINT "salesforce_sync_jobs_inboundReplyId_fkey" FOREIGN KEY ("inboundReplyId") REFERENCES "inbound_replies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
