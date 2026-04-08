import { prisma } from '@/lib/db/prisma'
import type { LeadStatus } from '@prisma/client'
import type { LeadDTO, TransitionInput, TransitionResult } from '../types'
import { LeadNotFoundError, STATUS_ORDER, TERMINAL_STATUSES } from '../types'

function isTerminal(status: LeadStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

function statusRank(status: LeadStatus): number | undefined {
  return STATUS_ORDER[status]
}

const LEAD_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  company: true,
  title: true,
  source: true,
  status: true,
  score: true,
  scoreReason: true,
  scoredAt: true,
  createdAt: true,
} as const

export async function transitionLeadStatus(input: TransitionInput): Promise<TransitionResult> {
  const { organizationId, leadId, newStatus, trigger, actorClerkId, metadata } = input

  // 1. Fetch lead (org-scoped)
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId },
    select: { ...LEAD_SELECT },
  })

  if (!lead) {
    throw new LeadNotFoundError(leadId)
  }

  const fromStatus = lead.status

  // 2. No-op if already at target
  if (fromStatus === newStatus) {
    return { changed: false, lead: lead as LeadDTO, previousStatus: fromStatus }
  }

  // 3. Enforce rules for automatic transitions
  const isAuto = trigger.startsWith('auto:')

  if (isAuto) {
    // Auto transitions never move OUT of terminal states
    if (isTerminal(fromStatus)) {
      return { changed: false, lead: lead as LeadDTO, previousStatus: fromStatus }
    }

    // Auto transitions INTO terminal states always apply
    if (!isTerminal(newStatus)) {
      // Check STATUS_ORDER: no downgrades
      const fromRank = statusRank(fromStatus)
      const toRank = statusRank(newStatus)
      if (fromRank !== undefined && toRank !== undefined && fromRank >= toRank) {
        return { changed: false, lead: lead as LeadDTO, previousStatus: fromStatus }
      }
    }
  }

  // 4. Execute transition in transaction
  const updatedLead = await prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      where: { id: leadId },
      data: { status: newStatus },
      select: { ...LEAD_SELECT },
    })

    await tx.leadStatusChange.create({
      data: {
        organizationId,
        leadId,
        fromStatus,
        toStatus: newStatus,
        trigger,
        actorClerkId: actorClerkId ?? null,
        metadata: metadata ?? undefined,
      },
    })

    // If moving to terminal state, stop active sequence enrollments
    if (isTerminal(newStatus)) {
      await tx.sequenceEnrollment.updateMany({
        where: { leadId, status: 'ACTIVE' },
        data: {
          status: 'STOPPED',
          stoppedAt: new Date(),
          stoppedReason: `lead_${newStatus.toLowerCase()}`,
        },
      })
    }

    return updated
  })

  return {
    changed: true,
    lead: updatedLead as LeadDTO,
    previousStatus: fromStatus,
  }
}
