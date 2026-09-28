-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "mailboxes" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "org_members" ADD COLUMN     "email" TEXT,
ADD COLUMN     "escalationEmail" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "name" TEXT,
ADD COLUMN     "senderFirstName" TEXT,
ADD COLUMN     "senderLastName" TEXT;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "copyAdminOnReplies" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ownershipBannerDismissedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "campaigns_ownerId_idx" ON "campaigns"("ownerId");

-- CreateIndex
CREATE INDEX "leads_organizationId_ownerId_idx" ON "leads"("organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "mailboxes_ownerId_idx" ON "mailboxes"("ownerId");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "org_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "org_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "org_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
