import { prisma } from '@/lib/db/prisma'
import type { SequenceDetailDTO } from '../types'
import { SequenceNotFoundError, SequenceHasActiveEnrollmentsError } from '../types'
import { getSequence } from './get-sequence'

interface UpdateSequenceInput {
  organizationId: string
  sequenceId: string
  name?: string
  newSteps?: { stepNumber: number; subject: string; body: string; delayDays: number }[]
}

export async function updateSequence({
  organizationId,
  sequenceId,
  name,
  newSteps,
}: UpdateSequenceInput): Promise<SequenceDetailDTO> {
  const sequence = await prisma.sequence.findFirst({
    where: { id: sequenceId, organizationId },
    include: {
      _count: { select: { steps: true } },
      enrollments: { where: { status: 'ACTIVE' }, select: { id: true } },
    },
  })

  if (!sequence) {
    throw new SequenceNotFoundError(sequenceId)
  }

  const hasActiveEnrollments = sequence.enrollments.length > 0

  if (hasActiveEnrollments && newSteps && newSteps.length > 0) {
    throw new SequenceHasActiveEnrollmentsError(sequenceId)
  }

  await prisma.$transaction(async (tx) => {
    if (name) {
      await tx.sequence.update({
        where: { id: sequenceId },
        data: { name },
      })
    }

    if (newSteps && newSteps.length > 0 && !hasActiveEnrollments) {
      await tx.sequenceStep.deleteMany({ where: { sequenceId } })
      await tx.sequenceStep.createMany({
        data: newSteps.map((s) => ({
          sequenceId,
          stepNumber: s.stepNumber,
          subject: s.subject,
          body: s.body,
          delayDays: s.delayDays,
        })),
      })
    }
  })

  return getSequence({ organizationId, sequenceId })
}
