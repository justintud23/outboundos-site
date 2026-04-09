import { prisma } from '@/lib/db/prisma'
import type { ClassificationBreakdownDTO } from '../types'

interface GetClassificationBreakdownInput {
  organizationId: string
  days?: number
}

export async function getClassificationBreakdown({
  organizationId,
  days,
}: GetClassificationBreakdownInput): Promise<ClassificationBreakdownDTO[]> {
  const since = days ? (() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - days)
    d.setUTCHours(0, 0, 0, 0)
    return d
  })() : undefined

  const rows = await prisma.inboundReply.groupBy({
    by: ['classification'],
    where: {
      organizationId,
      ...(since && { receivedAt: { gte: since } }),
    },
    _count: { _all: true },
  })

  return rows
    .map((r) => ({ classification: r.classification, count: r._count._all }))
    .sort((a, b) => b.count - a.count)
}
