-- Subject-line A/B testing for the FIRST email of a sequence.
-- A SubjectVariant is one arm of a test, attached to a sequence STEP (only the
-- first step, stepNumber = 1, is tested; follow-ups thread as "Re: <root>" and
-- are excluded). Opens/replies attribute back to a variant via
-- OutboundMessage.subjectVariantId, reusing the existing MessageEvent <->
-- OutboundMessage event pipeline rather than a parallel tracking system.

-- One arm of a subject-line A/B test. Variants are ARCHIVED (isArchived), never
-- hard-deleted, so historical per-variant stats survive removal.
CREATE TABLE "subject_variants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sequenceStepId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subject_variants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "subject_variants_sequenceStepId_idx" ON "subject_variants"("sequenceStepId");
CREATE INDEX "subject_variants_organizationId_idx" ON "subject_variants"("organizationId");

-- Manual "pick winner" pointer on the step. Once set, only the winner is assigned
-- to NEW first-step drafts; existing queued/sent rows are untouched.
ALTER TABLE "sequence_steps" ADD COLUMN "winningVariantId" TEXT;

-- The variant ASSIGNED to a draft, plus a manual-edit flag. An edited subject is
-- "manual" and excluded from variant stats (subjectEdited = true).
ALTER TABLE "drafts" ADD COLUMN "subjectVariantId" TEXT;
ALTER TABLE "drafts" ADD COLUMN "subjectEdited" BOOLEAN NOT NULL DEFAULT false;

-- The variant ACTUALLY sent (first send, unedited) — the attribution key stats
-- join on. Null for follow-ups, edited subjects, and non-test sends.
ALTER TABLE "outbound_messages" ADD COLUMN "subjectVariantId" TEXT;
CREATE INDEX "outbound_messages_subjectVariantId_idx" ON "outbound_messages"("subjectVariantId");

-- Foreign keys. subject_variants -> sequence_steps cascades (delete a step,
-- delete its arms). The variant references (winner / draft / message) SET NULL so
-- removing/archiving a variant never orphans an in-flight send.
ALTER TABLE "subject_variants" ADD CONSTRAINT "subject_variants_sequenceStepId_fkey" FOREIGN KEY ("sequenceStepId") REFERENCES "sequence_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_winningVariantId_fkey" FOREIGN KEY ("winningVariantId") REFERENCES "subject_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_subjectVariantId_fkey" FOREIGN KEY ("subjectVariantId") REFERENCES "subject_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_subjectVariantId_fkey" FOREIGN KEY ("subjectVariantId") REFERENCES "subject_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
