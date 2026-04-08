import { prisma } from '@/lib/db/prisma'
import type { SequenceDetailDTO, CreateSequenceInput } from '../types'

export async function createSequence(input: CreateSequenceInput): Promise<SequenceDetailDTO> {
  const { organizationId, campaignId, name, steps } = input

  // Validate campaign belongs to org
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: { id: true, name: true },
  })

  if (!campaign) {
    throw new Error('Campaign not found')
  }

  if (steps.length === 0) {
    throw new Error('Sequence must have at least one step')
  }

  // Create sequence + steps in transaction
  const sequence = await prisma.$transaction(async (tx) => {
    const seq = await tx.sequence.create({
      data: {
        organizationId,
        campaignId,
        name,
        steps: {
          create: steps.map((s) => ({
            stepNumber: s.stepNumber,
            subject: s.subject,
            body: s.body,
            delayDays: s.delayDays,
          })),
        },
      },
      include: {
        steps: {
          orderBy: { stepNumber: 'asc' },
        },
      },
    })

    await tx.auditLog.create({
      data: {
        organizationId,
        action: 'sequence.created',
        entityType: 'Sequence',
        entityId: seq.id,
        metadata: { name, stepCount: steps.length, campaignId },
      },
    })

    return seq
  })

  return {
    id: sequence.id,
    organizationId: sequence.organizationId,
    campaignId: sequence.campaignId,
    name: sequence.name,
    stepCount: sequence.steps.length,
    activeEnrollments: 0,
    completedEnrollments: 0,
    stoppedEnrollments: 0,
    createdAt: sequence.createdAt,
    steps: sequence.steps.map((s) => ({
      id: s.id,
      stepNumber: s.stepNumber,
      subject: s.subject,
      body: s.body,
      delayDays: s.delayDays,
    })),
    campaignName: campaign.name,
  }
}
