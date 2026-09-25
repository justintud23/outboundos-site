import { prisma } from '@/lib/db/prisma'
import { TERMINAL_STATUSES } from '@/features/leads/types'
import { LeadInTerminalStateError, LeadExcludedCanadaError } from '@/features/leads/types'
import { canadaExclusionReason } from '@/features/leads/canada'
import type { EnrollLeadInput } from '../types'
import { SequenceHasNoStepsError, AlreadyEnrolledError } from '../types'
import type { SequenceEnrollment } from '@prisma/client'
import { isFreshResult } from '@/features/verification/gate'
import { isVerificationConfigured } from '@/features/verification/server/get-verifier'
import { queueLeadForVerification } from '@/features/verification/server/queue-verification'

export async function enrollLead(input: EnrollLeadInput): Promise<SequenceEnrollment> {
  const { organizationId, sequenceId, leadId, actorClerkId } = input

  // 1. Validate lead exists and check terminal state
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId },
    select: {
      id: true, status: true, email: true, phone: true, country: true, customFields: true,
      emailCheck: true, emailCheckResult: true, emailCheckedAt: true,
      organization: { select: { allowCanadianRecipients: true } },
    },
  })

  if (!lead) {
    throw new Error('Lead not found')
  }

  // CASL: refuse to enrol Canadian recipients unless explicitly allowed.
  if (!lead.organization.allowCanadianRecipients) {
    const canadaReason = canadaExclusionReason(lead)
    if (canadaReason) throw new LeadExcludedCanadaError(leadId, canadaReason)
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

    // Deliverability 2A: verify the address before the first email, unless a
    // result from the last 90 days already exists. Only when verification is
    // configured — otherwise the lead would show "Verifying" forever.
    if (isVerificationConfigured() && !isFreshResult(lead, now)) {
      await queueLeadForVerification(tx, leadId)
    }

    return created
  })

  return enrollment
}
