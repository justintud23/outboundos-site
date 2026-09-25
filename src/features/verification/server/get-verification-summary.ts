import { prisma } from '@/lib/db/prisma'
import { isVerificationConfigured } from './get-verifier'
import type { VerificationSummaryDTO } from '../types'

/** Verification counts among leads enrolled in any sequence. */
export async function getVerificationSummary(organizationId: string): Promise<VerificationSummaryDTO> {
  const enrolled = { organizationId, sequenceEnrollments: { some: {} } }
  const [pending, risky, invalid, org] = await Promise.all([
    prisma.lead.count({ where: { ...enrolled, emailCheck: 'PENDING' } }),
    prisma.lead.count({ where: { ...enrolled, emailCheck: 'RISKY' } }),
    prisma.lead.count({ where: { ...enrolled, emailCheck: 'INVALID' } }),
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { verificationPausedReason: true } }),
  ])
  return { configured: isVerificationConfigured(), pending, risky, invalid, pausedReason: org.verificationPausedReason }
}
