import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { getAIProvider } from '@/lib/ai'
import { checkEnrollmentStop } from './check-enrollment-stop'
import { canadaExclusionReason } from '@/features/leads/canada'
import { selectSubjectVariant } from './select-subject-variant'
import { assignEnrollmentMailbox } from './assign-mailbox'
import { renderTemplate, insertPersonalization, PERSONALIZATION_TOKEN } from '../render-template'
import { checkGuardrails, type GuardrailFlag } from '@/features/drafts/guardrails'
import { queueApprovedDraft } from '@/features/messages/server/queue-draft'
import type { StepResult } from '../types'

interface RunStepInput {
  enrollmentId: string
}

export const MAX_AI_FAILURES = 3
const DEFER_MS = 60 * 60 * 1000 // gate not open yet (sample pending, paused, no mailbox)
const AI_RETRY_MS = 15 * 60 * 1000

async function defer(enrollmentId: string, ms = DEFER_MS): Promise<'DEFERRED'> {
  // Pushing nextDueAt keeps deferred enrollments from starving the runner's
  // oldest-first batch.
  await prisma.sequenceEnrollment.update({
    where: { id: enrollmentId },
    data: { nextDueAt: new Date(Date.now() + ms) },
  })
  return 'DEFERRED'
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Auto-send ordering gate for step N > 1: a follow-up may only be generated
 * once step N-1 has actually been SENT and step N's delay has elapsed since
 * then. Returns how long to wait (0 = go ahead).
 *  - step N-1 REJECTED (a human skipped it) → go ahead (step N starts a thread)
 *  - step N-1 sent at T → wait until T + delayDays
 *  - step N-1 BLOCKED / pending / approved-unsent / QUEUED / FAILED → wait
 */
async function followUpWaitMs(
  enrollment: { sequenceId: string; leadId: string },
  previousStepId: string,
  delayDays: number,
): Promise<number> {
  const previous = await prisma.draft.findFirst({
    where: { sequenceId: enrollment.sequenceId, leadId: enrollment.leadId, sequenceStepId: previousStepId },
    select: { status: true, outboundMessages: { select: { sentAt: true }, take: 1 } },
  })
  // No draft for the previous step (e.g. the step was added later): nothing to follow.
  if (!previous || previous.status === 'REJECTED') return 0
  const sentAt = previous.outboundMessages[0]?.sentAt
  if (!sentAt) return DEFER_MS
  return Math.max(0, sentAt.getTime() + delayDays * DAY_MS - Date.now())
}

export async function runSequenceStep({ enrollmentId }: RunStepInput): Promise<StepResult> {
  // 1. Fetch enrollment with sequence, steps, campaign, lead and org settings
  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { id: enrollmentId },
    include: {
      sequence: {
        include: {
          steps: { orderBy: { stepNumber: 'asc' } },
          campaign: { select: { id: true, autoSend: true, sampleSize: true, sampleApprovedAt: true } },
        },
      },
      lead: {
        select: { id: true, status: true, email: true, phone: true, country: true, firstName: true, lastName: true, company: true, title: true, customFields: true },
      },
      organization: {
        select: { sendingPaused: true, guardrailBlockedPhrases: true, guardrailAllowedWords: true, allowCanadianRecipients: true },
      },
    },
  })

  if (!enrollment) {
    return 'ERROR'
  }

  // 2. Check stop conditions — CASL first: Canadian recipients are never
  //    emailed unless the organization explicitly allows them.
  const canadaReason = enrollment.organization.allowCanadianRecipients ? null : canadaExclusionReason(enrollment.lead)
  const stopCheck = canadaReason
    ? { shouldStop: true, reason: `excluded_canada: ${canadaReason}` }
    : await checkEnrollmentStop({
        enrollment: {
          startedAt: enrollment.startedAt,
          leadId: enrollment.leadId,
          organizationId: enrollment.organizationId,
        },
        leadStatus: enrollment.lead.status,
      })

  if (stopCheck.shouldStop) {
    await prisma.$transaction(async (tx) => {
      await tx.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: {
          status: 'STOPPED',
          stoppedAt: new Date(),
          stoppedReason: stopCheck.reason,
          processing: false,
        },
      })
    })
    return 'STOPPED'
  }

  // 3. Determine next step
  const nextStepNumber = enrollment.currentStepNumber + 1
  const nextStep = enrollment.sequence.steps.find((s) => s.stepNumber === nextStepNumber)

  if (!nextStep) {
    await prisma.$transaction(async (tx) => {
      await tx.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'COMPLETED', nextDueAt: null },
      })
    })
    return 'COMPLETED'
  }

  const campaign = enrollment.sequence.campaign
  const org = enrollment.organization
  const lead = enrollment.lead

  // 4. Auto-send gates — checked BEFORE any AI spend.
  let mailboxId = enrollment.mailboxId
  if (campaign.autoSend) {
    if (org.sendingPaused) return defer(enrollmentId)
    const previousStep = enrollment.sequence.steps.find((s) => s.stepNumber === nextStepNumber - 1)
    if (previousStep) {
      const waitMs = await followUpWaitMs(enrollment, previousStep.id, nextStep.delayDays)
      if (waitMs > 0) return defer(enrollmentId, Math.max(DEFER_MS, waitMs))
    }
    if (!campaign.sampleApprovedAt) {
      const samples = await prisma.draft.count({ where: { campaignId: campaign.id, isSample: true } })
      if (samples >= campaign.sampleSize) return defer(enrollmentId)
    }
    if (!mailboxId) {
      mailboxId = await assignEnrollmentMailbox(enrollment.organizationId, enrollmentId)
      if (!mailboxId) return defer(enrollmentId)
    }
  }

  // 5. AI personalization — outside any transaction.
  let personalization: string | null = null
  let aiFailed = false
  if (nextStep.personalizationPrompt && nextStep.body.includes(PERSONALIZATION_TOKEN)) {
    try {
      personalization = await getAIProvider().personalize(
        { firstName: lead.firstName, lastName: lead.lastName, company: lead.company, title: lead.title, customFields: lead.customFields },
        nextStep.personalizationPrompt,
      )
    } catch (err) {
      const failures = enrollment.failedAttempts + 1
      console.error(`[runSequenceStep] personalization failed for ${enrollmentId} (attempt ${failures})`, err)
      if (failures < MAX_AI_FAILURES) {
        await prisma.sequenceEnrollment.update({
          where: { id: enrollmentId },
          data: { failedAttempts: failures, nextDueAt: new Date(Date.now() + AI_RETRY_MS) },
        })
        return 'DEFERRED'
      }
      aiFailed = true
    }
  }

  // 6. Create the draft (and queue it if auto-approved) atomically.
  const result = await prisma.$transaction(async (tx) => {
    const followingStep = enrollment.sequence.steps.find((s) => s.stepNumber === nextStepNumber + 1)
    const advance = {
      currentStepNumber: nextStepNumber,
      failedAttempts: 0,
      nextDueAt: followingStep ? new Date(Date.now() + followingStep.delayDays * 24 * 60 * 60 * 1000) : null,
    }

    // Idempotency: check if draft already exists for this step
    const existingDraft = await tx.draft.findFirst({
      where: { sequenceId: enrollment.sequenceId, leadId: enrollment.leadId, sequenceStepId: nextStep.id },
      select: { id: true },
    })
    if (existingDraft) {
      await tx.sequenceEnrollment.update({ where: { id: enrollmentId }, data: advance })
      return 'SKIPPED' as const
    }

    // Subject-line A/B test: ONLY the first step is tested (follow-ups thread as
    // "Re: <root>").
    let subjectTemplate = nextStep.subject
    let subjectVariantId: string | null = null
    if (nextStep.stepNumber === 1) {
      const variant = await selectSubjectVariant(tx, nextStep.id)
      if (variant) {
        subjectTemplate = variant.subject
        subjectVariantId = variant.variantId
      }
    }

    const subject = renderTemplate(subjectTemplate, lead)
    const body = renderTemplate(insertPersonalization(nextStep.body, personalization), lead)
    const flags: GuardrailFlag[] = checkGuardrails({
      subject,
      body,
      personalization,
      templateText: `${subjectTemplate}\n${nextStep.body}`,
      blockedPhrases: org.guardrailBlockedPhrases,
      allowedWords: org.guardrailAllowedWords,
    })
    if (aiFailed) flags.unshift({ rule: 'AI_FAILED', match: `personalization failed ${MAX_AI_FAILURES} times` })

    const blocked = flags.length > 0
    const autoApprove = campaign.autoSend && !!campaign.sampleApprovedAt && !blocked
    const isSample = campaign.autoSend && !campaign.sampleApprovedAt && !blocked
    const status = blocked ? 'BLOCKED' : autoApprove ? 'APPROVED' : 'PENDING_REVIEW'

    const draft = await tx.draft.create({
      data: {
        organizationId: enrollment.organizationId,
        leadId: enrollment.leadId,
        campaignId: enrollment.sequence.campaignId,
        sequenceId: enrollment.sequenceId,
        sequenceStepId: nextStep.id,
        sequenceEnrollmentId: enrollment.id,
        subject,
        body,
        status,
        isSample,
        ...(blocked && { guardrailFlags: flags as unknown as Prisma.InputJsonValue }),
        ...(autoApprove && { approvedAt: new Date() }),
        ...(subjectVariantId && { subjectVariantId }),
      },
    })

    if (autoApprove && mailboxId) {
      await queueApprovedDraft(
        tx,
        { ...draft, campaignId: draft.campaignId ?? null, subjectVariantId: draft.subjectVariantId ?? null, subjectEdited: false },
        mailboxId,
      )
    }

    await tx.sequenceEnrollment.update({ where: { id: enrollmentId }, data: advance })

    await tx.auditLog.create({
      data: {
        organizationId: enrollment.organizationId,
        action: 'sequence.step_executed',
        entityType: 'SequenceEnrollment',
        entityId: enrollmentId,
        metadata: {
          sequenceId: enrollment.sequenceId,
          leadId: enrollment.leadId,
          stepNumber: nextStepNumber,
          stepId: nextStep.id,
          draftStatus: status,
        },
      },
    })

    return autoApprove ? ('QUEUED' as const) : ('DRAFT_GENERATED' as const)
  })

  return result
}
