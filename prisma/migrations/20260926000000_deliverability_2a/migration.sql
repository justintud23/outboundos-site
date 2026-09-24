-- CreateEnum
CREATE TYPE "EmailCheck" AS ENUM ('UNCHECKED', 'PENDING', 'OK', 'RISKY', 'INVALID');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "emailCheck" "EmailCheck" NOT NULL DEFAULT 'UNCHECKED',
ADD COLUMN     "emailCheckAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "emailCheckResult" TEXT,
ADD COLUMN     "emailCheckedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "blockRiskyEmails" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verificationAlertedAt" TIMESTAMP(3),
ADD COLUMN     "verificationPausedReason" TEXT;

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "contentOverrideAt" TIMESTAMP(3),
ADD COLUMN     "contentOverrideBy" TEXT,
ADD COLUMN     "contentOverrideHash" TEXT,
ADD COLUMN     "contentOverrideReason" TEXT;

-- CreateIndex
CREATE INDEX "leads_emailCheck_idx" ON "leads"("emailCheck");
