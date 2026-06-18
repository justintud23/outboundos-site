-- Mailbox circuit breaker: auto-pause a mailbox when its recent bounce or
-- spam-complaint rate breaches safe thresholds (see features/mailboxes/breaker.ts).
-- These columns are distinct from isActive (the user's manual on/off) so we can
-- show *why* a mailbox stopped and never auto-resume one a human disabled.
ALTER TABLE "mailboxes" ADD COLUMN "autoPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "mailboxes" ADD COLUMN "pausedAt" TIMESTAMP(3);
ALTER TABLE "mailboxes" ADD COLUMN "pauseReason" TEXT;

-- Floor for the breaker's rolling window. Existing mailboxes get now() at
-- migration time (they carry no prior breaker history); on resume it is bumped
-- to now() so stale bounces don't immediately re-trip a freshly-resumed mailbox.
ALTER TABLE "mailboxes" ADD COLUMN "breakerResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
