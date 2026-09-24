-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "country" TEXT;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "allowCanadianRecipients" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "businessName" TEXT,
ADD COLUMN     "postalAddress" TEXT;

