-- Mailbox warmup: ramp new mailboxes' daily volume up gradually.
-- New mailboxes warm up by default (column default true). Existing mailboxes are
-- backfilled to false below so already-established inboxes are NOT suddenly
-- throttled by the ramp.
ALTER TABLE "mailboxes" ADD COLUMN "warmupEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "mailboxes" ADD COLUMN "warmupStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: every mailbox that exists at migration time predates warmup and
-- must not be throttled. Future inserts keep the column default (true).
UPDATE "mailboxes" SET "warmupEnabled" = false;
