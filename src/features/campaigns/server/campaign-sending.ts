import { prisma } from '@/lib/db/prisma'
import { queueApprovedDraft } from '@/features/messages/server/queue-draft'

export class CampaignNotFoundError extends Error {
  constructor() {
    super('Campaign not found')
    this.name = 'CampaignNotFoundError'
    Object.setPrototypeOf(this, CampaignNotFoundError.prototype)
  }
}

export async function createCampaign(input: { organizationId: string; name: string; description?: string | null }) {
  return prisma.campaign.create({
    data: {
      organizationId: input.organizationId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      status: 'ACTIVE',
    },
    select: { id: true, name: true },
  })
}

export async function updateCampaignSending(input: {
  organizationId: string
  campaignId: string
  autoSend?: boolean
  sampleSize?: number
}) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: input.campaignId, organizationId: input.organizationId },
    select: { id: true },
  })
  if (!campaign) throw new CampaignNotFoundError()

  return prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      ...(input.autoSend !== undefined && { autoSend: input.autoSend }),
      ...(input.sampleSize !== undefined && { sampleSize: Math.min(50, Math.max(1, Math.round(input.sampleSize))) }),
    },
    select: { id: true, autoSend: true, sampleSize: true, sampleApprovedAt: true },
  })
}

/**
 * One click that turns the campaign loose: approve every pending sample draft,
 * queue every approved-but-unsent sample draft (including ones approved
 * individually earlier), and open the gate for all future drafts.
 */
export async function approveCampaignSample(input: {
  organizationId: string
  campaignId: string
  clerkUserId: string
}): Promise<{ queued: number }> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: input.campaignId, organizationId: input.organizationId },
    select: { id: true, autoSend: true },
  })
  if (!campaign) throw new CampaignNotFoundError()

  return prisma.$transaction(async (tx) => {
    const now = new Date()
    await tx.draft.updateMany({
      where: { campaignId: campaign.id, organizationId: input.organizationId, isSample: true, status: 'PENDING_REVIEW' },
      data: { status: 'APPROVED', approvedByClerkId: input.clerkUserId, approvedAt: now },
    })

    const toQueue = await tx.draft.findMany({
      where: {
        campaignId: campaign.id,
        organizationId: input.organizationId,
        isSample: true,
        status: 'APPROVED',
        outboundMessages: { none: {} },
      },
      include: {
        sequenceEnrollment: { select: { mailboxId: true } },
        sequenceStep: { select: { stepNumber: true } },
      },
    })

    let queued = 0
    for (const draft of toQueue) {
      const mailboxId = draft.sequenceEnrollment?.mailboxId
      if (!mailboxId) continue
      // Follow-ups only once the step before them has actually been sent —
      // otherwise steps 1 and 2 would be queued together. The sequence runner
      // generates and queues the rest in order.
      const stepNumber = draft.sequenceStep?.stepNumber ?? 1
      if (stepNumber > 1) {
        const previousSent = await tx.outboundMessage.count({
          where: {
            organizationId: input.organizationId,
            sentAt: { not: null },
            draft: { sequenceEnrollmentId: draft.sequenceEnrollmentId, sequenceStep: { stepNumber: stepNumber - 1 } },
          },
        })
        if (previousSent === 0) continue
      }
      await queueApprovedDraft(tx, draft, mailboxId, now)
      queued++
    }

    await tx.campaign.update({ where: { id: campaign.id }, data: { sampleApprovedAt: now } })
    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorClerkId: input.clerkUserId,
        action: 'campaign.sample_approved',
        entityType: 'Campaign',
        entityId: campaign.id,
        metadata: { queued },
      },
    })
    return { queued }
  })
}
