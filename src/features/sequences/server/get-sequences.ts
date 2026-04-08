import { prisma } from '@/lib/db/prisma'
import type { SequenceDTO } from '../types'

interface GetSequencesInput {
  organizationId: string
  campaignId?: string
}

export async function getSequences({
  organizationId,
  campaignId,
}: GetSequencesInput): Promise<{ sequences: SequenceDTO[]; total: number }> {
  const where = {
    organizationId,
    ...(campaignId && { campaignId }),
  }

  const rows = await prisma.sequence.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { steps: true } },
      enrollments: {
        select: { status: true },
      },
    },
  })

  const sequences: SequenceDTO[] = rows.map((row) => {
    const active = row.enrollments.filter((e) => e.status === 'ACTIVE').length
    const completed = row.enrollments.filter((e) => e.status === 'COMPLETED').length
    const stopped = row.enrollments.filter((e) => e.status === 'STOPPED').length

    return {
      id: row.id,
      organizationId: row.organizationId,
      campaignId: row.campaignId,
      name: row.name,
      stepCount: row._count.steps,
      activeEnrollments: active,
      completedEnrollments: completed,
      stoppedEnrollments: stopped,
      createdAt: row.createdAt,
    }
  })

  return { sequences, total: sequences.length }
}
