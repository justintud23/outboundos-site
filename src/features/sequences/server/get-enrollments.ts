import { prisma } from '@/lib/db/prisma'
import type { EnrollmentStatus } from '@prisma/client'
import type { EnrollmentDTO } from '../types'

interface GetEnrollmentsInput {
  organizationId: string
  sequenceId: string
  status?: EnrollmentStatus
}

export async function getEnrollments({
  organizationId,
  sequenceId,
  status,
}: GetEnrollmentsInput): Promise<{ enrollments: EnrollmentDTO[]; total: number }> {
  const sequence = await prisma.sequence.findFirst({
    where: { id: sequenceId, organizationId },
    select: { id: true, _count: { select: { steps: true } } },
  })

  if (!sequence) {
    return { enrollments: [], total: 0 }
  }

  const totalSteps = sequence._count.steps

  const rows = await prisma.sequenceEnrollment.findMany({
    where: {
      sequenceId,
      organizationId,
      ...(status && { status }),
    },
    include: {
      lead: {
        select: { email: true, firstName: true, lastName: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const enrollments: EnrollmentDTO[] = rows.map((row) => ({
    id: row.id,
    leadId: row.leadId,
    leadEmail: row.lead.email,
    leadName: [row.lead.firstName, row.lead.lastName].filter(Boolean).join(' ') || row.lead.email,
    currentStepNumber: row.currentStepNumber,
    totalSteps,
    status: row.status,
    nextDueAt: row.nextDueAt,
    startedAt: row.startedAt,
    stoppedReason: row.stoppedReason,
  }))

  return { enrollments, total: enrollments.length }
}
