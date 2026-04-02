-- AlterTable
ALTER TABLE "message_events" ADD COLUMN "sgEventId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "message_events_sgEventId_key" ON "message_events"("sgEventId");
