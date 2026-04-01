import { prisma } from '@/lib/db/prisma'
import type { LeadDTO } from '../types'

interface GetLeadsInput {
  organizationId: string
  limit?: number
  offset?: number
}

export async function getLeads({
  organizationId,
  limit = 50,
  offset = 0,
}: GetLeadsInput): Promise<{ leads: LeadDTO[]; total: number }> {
  const cappedLimit = Math.min(limit, 200)

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where: { organizationId },
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      take: cappedLimit,
      skip: offset,
      select: {
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
      },
    }),
    prisma.lead.count({ where: { organizationId } }),
  ])

  return { leads, total }
}
