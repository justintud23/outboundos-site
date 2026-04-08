import { prisma } from '@/lib/db/prisma'
import type { SequenceEnrollment } from '@prisma/client'
import { EnrollmentNotFoundError } from '../types'

interface UpdateEnrollmentInput {
  organizationId: string
  enrollmentId: string
  action: 'pause' | 'resume' | 'stop'
  actorClerkId: string
}

export async function updateEnrollment({
  organizationId,
  enrollmentId,
  action,
  actorClerkId,
}: UpdateEnrollmentInput): Promise<SequenceEnrollment> {
  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { id: enrollmentId, organizationId },
  })

  if (!enrollment) {
    throw new EnrollmentNotFoundError(enrollmentId)
  }

  const now = new Date()

  const data =
    action === 'pause'
      ? { status: 'PAUSED' as const, pausedAt: now }
      : action === 'resume'
        ? { status: 'ACTIVE' as const, pausedAt: null }
        : { status: 'STOPPED' as const, stoppedAt: now, stoppedReason: 'manual' }

  const updated = await prisma.sequenceEnrollment.update({
    where: { id: enrollmentId },
    data,
  })

  await prisma.auditLog.create({
    data: {
      organizationId,
      actorClerkId,
      action: `sequence.enrollment_${action}`,
      entityType: 'SequenceEnrollment',
      entityId: enrollmentId,
    },
  })

  return updated
}
