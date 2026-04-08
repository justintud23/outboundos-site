import { prisma } from '@/lib/db/prisma'
import type { LeadStatus } from '@prisma/client'
import { TERMINAL_STATUSES } from '@/features/leads/types'

interface CheckStopInput {
  enrollment: { startedAt: Date; leadId: string; organizationId: string }
  leadStatus: LeadStatus
}

interface CheckStopResult {
  shouldStop: boolean
  reason?: string
}

export async function checkEnrollmentStop({
  enrollment,
  leadStatus,
}: CheckStopInput): Promise<CheckStopResult> {
  // 1. Terminal state check
  if (TERMINAL_STATUSES.includes(leadStatus)) {
    return { shouldStop: true, reason: `lead_${leadStatus.toLowerCase()}` }
  }

  // 2. Reply received after enrollment started
  const replyAfterStart = await prisma.inboundReply.findFirst({
    where: {
      leadId: enrollment.leadId,
      organizationId: enrollment.organizationId,
      createdAt: { gt: enrollment.startedAt },
    },
    select: { id: true },
  })

  if (replyAfterStart) {
    return { shouldStop: true, reason: 'reply_received' }
  }

  return { shouldStop: false }
}
