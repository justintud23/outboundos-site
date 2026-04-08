import { prisma } from '@/lib/db/prisma'
import { checkEnrollmentStop } from './check-enrollment-stop'
import type { StepResult } from '../types'

interface RunStepInput {
  enrollmentId: string
}

export async function runSequenceStep({ enrollmentId }: RunStepInput): Promise<StepResult> {
  // 1. Fetch enrollment with sequence, steps, and lead
  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { id: enrollmentId },
    include: {
      sequence: {
        include: {
          steps: { orderBy: { stepNumber: 'asc' } },
        },
      },
      lead: { select: { id: true, status: true } },
    },
  })

  if (!enrollment) {
    return 'ERROR'
  }

  // 2. Check stop conditions
  const stopCheck = await checkEnrollmentStop({
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
    // All steps completed
    await prisma.$transaction(async (tx) => {
      await tx.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'COMPLETED', nextDueAt: null },
      })
    })
    return 'COMPLETED'
  }

  // 4. Execute in transaction: idempotency check, create draft, advance enrollment
  const result = await prisma.$transaction(async (tx) => {
    // Idempotency: check if draft already exists for this step
    const existingDraft = await tx.draft.findFirst({
      where: {
        sequenceId: enrollment.sequenceId,
        leadId: enrollment.leadId,
        sequenceStepId: nextStep.id,
      },
      select: { id: true },
    })

    if (existingDraft) {
      // Advance enrollment past this step anyway
      const followingStep = enrollment.sequence.steps.find(
        (s) => s.stepNumber === nextStepNumber + 1
      )
      await tx.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: {
          currentStepNumber: nextStepNumber,
          nextDueAt: followingStep
            ? new Date(Date.now() + followingStep.delayDays * 24 * 60 * 60 * 1000)
            : null,
        },
      })
      return 'SKIPPED' as const
    }

    // Create draft
    await tx.draft.create({
      data: {
        organizationId: enrollment.organizationId,
        leadId: enrollment.leadId,
        campaignId: enrollment.sequence.campaignId,
        sequenceId: enrollment.sequenceId,
        sequenceStepId: nextStep.id,
        sequenceEnrollmentId: enrollment.id,
        subject: nextStep.subject,
        body: nextStep.body,
        status: 'PENDING_REVIEW',
      },
    })

    // Advance enrollment
    const followingStep = enrollment.sequence.steps.find(
      (s) => s.stepNumber === nextStepNumber + 1
    )
    await tx.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: {
        currentStepNumber: nextStepNumber,
        nextDueAt: followingStep
          ? new Date(Date.now() + followingStep.delayDays * 24 * 60 * 60 * 1000)
          : null,
      },
    })

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
        },
      },
    })

    return 'DRAFT_GENERATED' as const
  })

  return result
}
