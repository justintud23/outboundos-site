import { prisma } from '@/lib/db/prisma'
import { TERMINAL_STATUSES } from '@/features/leads/types'
import { LeadInTerminalStateError } from '@/features/leads/types'
import type { EnrollLeadInput } from '../types'
import { SequenceHasNoStepsError, AlreadyEnrolledError } from '../types'
import type { SequenceEnrollment } from '@prisma/client'

export async function enrollLead(input: EnrollLeadInput): Promise<SequenceEnrollment> {
  const { organizationId, sequenceId, leadId, actorClerkId } = input

  // 1. Validate lead exists and check terminal state
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId },
    select: { id: true, status: true },
  })

  if (!lead) {
    throw new Error('Lead not found')
  }

  if (TERMINAL_STATUSES.includes(lead.status)) {
    throw new LeadInTerminalStateError(leadId, lead.status)
  }

  // 2. Fetch sequence with steps
  const sequence = await prisma.sequence.findFirst({
    where: { id: sequenceId, organizationId },
    include: {
      steps: { orderBy: { stepNumber: 'asc' }, select: { stepNumber: true, delayDays: true } },
    },
  })

  if (!sequence) {
    throw new Error('Sequence not found')
  }

  if (sequence.steps.length === 0) {
    throw new SequenceHasNoStepsError(sequenceId)
  }

  // 3. Check for existing enrollment
  const existing = await prisma.sequenceEnrollment.findFirst({
    where: { sequenceId, leadId },
    select: { id: true },
  })

  if (existing) {
    throw new AlreadyEnrolledError(sequenceId, leadId)
  }

  // 4. Calculate nextDueAt from step 1's delayDays
  const step1 = sequence.steps[0]!
  const now = new Date()
  const nextDueAt = new Date(now.getTime() + step1.delayDays * 24 * 60 * 60 * 1000)

  // 5. Create enrollment in transaction with audit log
  const enrollment = await prisma.$transaction(async (tx) => {
    const created = await tx.sequenceEnrollment.create({
      data: {
        organizationId,
        sequenceId,
        leadId,
        currentStepNumber: 0,
        status: 'ACTIVE',
        startedAt: now,
        nextDueAt,
      },
    })

    await tx.auditLog.create({
      data: {
        organizationId,
        actorClerkId,
        action: 'sequence.lead_enrolled',
        entityType: 'SequenceEnrollment',
        entityId: created.id,
        metadata: { sequenceId, leadId },
      },
    })

    return created
  })

  return enrollment
}
