import { prisma } from '@/lib/db/prisma'
import type { LeadSequenceDTO } from '../types'

interface GetLeadSequenceInput {
  organizationId: string
  leadId: string
}

export async function getLeadSequence({
  organizationId,
  leadId,
}: GetLeadSequenceInput): Promise<LeadSequenceDTO | null> {
  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { leadId, organizationId },
    orderBy: { startedAt: 'desc' },
    select: {
      id: true,
      currentStepNumber: true,
      status: true,
      nextDueAt: true,
      startedAt: true,
      stoppedAt: true,
      stoppedReason: true,
      sequence: {
        select: {
          id: true,
          name: true,
          steps: {
            select: { stepNumber: true, subject: true, delayDays: true },
            orderBy: { stepNumber: 'asc' },
          },
        },
      },
    },
  })

  if (!enrollment) return null

  const totalSteps = enrollment.sequence.steps.length
  const currentStep = enrollment.sequence.steps.find(
    (s) => s.stepNumber === enrollment.currentStepNumber,
  )
  const nextStep = enrollment.sequence.steps.find(
    (s) => s.stepNumber === enrollment.currentStepNumber + 1,
  )

  return {
    enrollmentId: enrollment.id,
    sequenceId: enrollment.sequence.id,
    sequenceName: enrollment.sequence.name,
    currentStepNumber: enrollment.currentStepNumber,
    totalSteps,
    status: enrollment.status,
    nextDueAt: enrollment.nextDueAt,
    startedAt: enrollment.startedAt,
    stoppedAt: enrollment.stoppedAt,
    stoppedReason: enrollment.stoppedReason,
    currentStepSubject: currentStep?.subject ?? null,
    nextStepSubject: nextStep?.subject ?? null,
  }
}
