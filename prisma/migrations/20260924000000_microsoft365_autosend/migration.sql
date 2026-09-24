-- CreateEnum
CREATE TYPE "MailboxProvider" AS ENUM ('SENDGRID', 'MICROSOFT_GRAPH');

-- AlterEnum
ALTER TYPE "DraftStatus" ADD VALUE 'BLOCKED';

-- AlterEnum
ALTER TYPE "MessageStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "businessHoursEnd" INTEGER NOT NULL DEFAULT 17,
ADD COLUMN     "businessHoursStart" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "escalationEmail" TEXT,
ADD COLUMN     "guardrailAllowedWords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "guardrailBlockedPhrases" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "msTenantId" TEXT,
ADD COLUMN     "pausedReason" TEXT,
ADD COLUMN     "sendDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
ADD COLUMN     "sendingPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'America/New_York';

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "autoSend" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sampleApprovedAt" TIMESTAMP(3),
ADD COLUMN     "sampleSize" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "sequence_steps" ADD COLUMN     "personalizationPrompt" TEXT;

-- AlterTable
ALTER TABLE "sequence_enrollments" ADD COLUMN     "failedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mailboxId" TEXT;

-- AlterTable
ALTER TABLE "mailboxes" ADD COLUMN     "graphUserId" TEXT,
ADD COLUMN     "inboxDeltaLink" TEXT,
ADD COLUMN     "lastPolledAt" TIMESTAMP(3),
ADD COLUMN     "nextSendAt" TIMESTAMP(3),
ADD COLUMN     "provider" "MailboxProvider" NOT NULL DEFAULT 'SENDGRID',
ADD COLUMN     "sentDeltaLink" TEXT;

-- AlterTable
ALTER TABLE "drafts" ADD COLUMN     "guardrailFlags" JSONB,
ADD COLUMN     "isSample" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "outbound_messages" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "graphMessageId" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "processing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "processingStartedAt" TIMESTAMP(3),
ADD COLUMN     "scheduledFor" TIMESTAMP(3),
ADD COLUMN     "sendAttempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "inbound_replies" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "fromEmail" TEXT,
ADD COLUMN     "graphMessageId" TEXT,
ADD COLUMN     "handledAt" TIMESTAMP(3),
ADD COLUMN     "mailboxId" TEXT,
ADD COLUMN     "notifiedAt" TIMESTAMP(3),
ADD COLUMN     "subject" TEXT;

-- CreateTable
CREATE TABLE "unmatched_replies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "graphMessageId" TEXT NOT NULL,
    "conversationId" TEXT,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyPreview" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unmatched_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_heartbeats" (
    "job" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "lastResult" JSONB,

    CONSTRAINT "cron_heartbeats_pkey" PRIMARY KEY ("job")
);

-- CreateIndex
CREATE UNIQUE INDEX "unmatched_replies_graphMessageId_key" ON "unmatched_replies"("graphMessageId");

-- CreateIndex
CREATE INDEX "unmatched_replies_organizationId_idx" ON "unmatched_replies"("organizationId");

-- CreateIndex
CREATE INDEX "unmatched_replies_conversationId_idx" ON "unmatched_replies"("conversationId");

-- CreateIndex
CREATE INDEX "sequence_enrollments_mailboxId_idx" ON "sequence_enrollments"("mailboxId");

-- CreateIndex
CREATE INDEX "drafts_campaignId_isSample_idx" ON "drafts"("campaignId", "isSample");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_messages_graphMessageId_key" ON "outbound_messages"("graphMessageId");

-- CreateIndex
CREATE INDEX "outbound_messages_status_scheduledFor_idx" ON "outbound_messages"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "outbound_messages_conversationId_idx" ON "outbound_messages"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_replies_graphMessageId_key" ON "inbound_replies"("graphMessageId");

-- CreateIndex
CREATE INDEX "inbound_replies_conversationId_idx" ON "inbound_replies"("conversationId");

-- AddForeignKey
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_replies" ADD CONSTRAINT "inbound_replies_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unmatched_replies" ADD CONSTRAINT "unmatched_replies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unmatched_replies" ADD CONSTRAINT "unmatched_replies_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

