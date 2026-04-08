import { prisma } from '@/lib/db/prisma'
import type { SequenceDetailDTO } from '../types'
import { SequenceNotFoundError } from '../types'

interface GetSequenceInput {
  organizationId: string
  sequenceId: string
}

export async function getSequence({
  organizationId,
  sequenceId,
}: GetSequenceInput): Promise<SequenceDetailDTO> {
  const sequence = await prisma.sequence.findFirst({
    where: { id: sequenceId, organizationId },
    include: {
      campaign: { select: { name: true } },
      steps: { orderBy: { stepNumber: 'asc' } },
      enrollments: { select: { status: true } },
    },
  })

  if (!sequence) {
    throw new SequenceNotFoundError(sequenceId)
  }

  const active = sequence.enrollments.filter((e) => e.status === 'ACTIVE').length
  const completed = sequence.enrollments.filter((e) => e.status === 'COMPLETED').length
  const stopped = sequence.enrollments.filter((e) => e.status === 'STOPPED').length

  return {
    id: sequence.id,
    organizationId: sequence.organizationId,
    campaignId: sequence.campaignId,
    name: sequence.name,
    stepCount: sequence.steps.length,
    activeEnrollments: active,
    completedEnrollments: completed,
    stoppedEnrollments: stopped,
    createdAt: sequence.createdAt,
    steps: sequence.steps.map((s) => ({
      id: s.id,
      stepNumber: s.stepNumber,
      subject: s.subject,
      body: s.body,
      delayDays: s.delayDays,
    })),
    campaignName: sequence.campaign.name,
  }
}
